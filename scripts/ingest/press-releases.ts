import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { members, pressReleases, syncLog } from "../../lib/schema";
import { sql, eq } from "drizzle-orm";

const DELAY_MS = 300;

// ─── RSS feed URL patterns to try per member site ────────────────────────────

const RSS_PATTERNS = [
  "/rss.xml",
  "/feed/",
  "/rss/feeds/?type=press",
  "/news/rss.xml",
  "/media/press-releases.rss",
  "/feed",
];

interface RSSItem {
  title: string;
  link: string;
  pubDate: string | null;
  description: string | null;
}

// ─── RSS parsing (simple, no dependency) ─────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.trim() || "";
}

function extractCDATA(content: string): string {
  const cdataMatch = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return cdataMatch ? cdataMatch[1].trim() : content.replace(/<[^>]+>/g, "").trim();
}

function parseRSSItems(xml: string): RSSItem[] {
  const items: RSSItem[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const m of itemMatches) {
    const itemXml = m[1];
    const rawTitle = extractTag(itemXml, "title");
    const title = extractCDATA(rawTitle);
    if (!title) continue;

    const link =
      extractTag(itemXml, "link") ||
      extractTag(itemXml, "guid");
    if (!link || !link.startsWith("http")) continue;

    const pubDateStr = extractTag(itemXml, "pubDate") ||
      extractTag(itemXml, "dc:date") ||
      extractTag(itemXml, "published");

    const rawDesc = extractTag(itemXml, "description") ||
      extractTag(itemXml, "content:encoded");
    const description = rawDesc
      ? extractCDATA(rawDesc).slice(0, 500)
      : null;

    items.push({
      title,
      link: link.trim(),
      pubDate: pubDateStr || null,
      description,
    });
  }

  // Also try Atom format
  if (items.length === 0) {
    const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
    for (const m of entryMatches) {
      const entryXml = m[1];
      const rawTitle = extractTag(entryXml, "title");
      const title = extractCDATA(rawTitle);
      if (!title) continue;

      const linkMatch = entryXml.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/) ||
        entryXml.match(/<link[^>]*>([^<]*)<\/link>/);
      const link = linkMatch?.[1] || "";
      if (!link.startsWith("http")) continue;

      const pubDateStr = extractTag(entryXml, "published") ||
        extractTag(entryXml, "updated");

      const rawDesc = extractTag(entryXml, "summary") ||
        extractTag(entryXml, "content");
      const description = rawDesc
        ? extractCDATA(rawDesc).slice(0, 500)
        : null;

      items.push({
        title,
        link: link.trim(),
        pubDate: pubDateStr || null,
        description,
      });
    }
  }

  return items;
}

function parsePubDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

// ─── RSS discovery ───────────────────────────────────────────────────────────

async function discoverRSS(
  websiteUrl: string
): Promise<{ url: string; items: RSSItem[] } | null> {
  const base = websiteUrl.replace(/\/$/, "");

  for (const pattern of RSS_PATTERNS) {
    const url = base + pattern;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);

      if (!res.ok) continue;

      const text = await res.text();
      if (!text.includes("<rss") && !text.includes("<feed") && !text.includes("<item>")) {
        continue;
      }

      const items = parseRSSItems(text);
      if (items.length > 0) {
        return { url, items };
      }
    } catch {
      continue;
    }
  }

  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");

  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  const [syncEntry] = await db
    .insert(syncLog)
    .values({
      source: "rss",
      entityType: "press_releases",
      status: "running",
    })
    .returning();

  try {
    const allMembers = await db
      .select({
        bioguideId: members.bioguideId,
        fullName: members.fullName,
        websiteUrl: members.websiteUrl,
        chamber: members.chamber,
      })
      .from(members)
      .where(eq(members.inOffice, true))
      .orderBy(members.lastName);

    const withSites = allMembers.filter((m) => m.websiteUrl);
    console.log(
      `Scanning RSS feeds for ${withSites.length} members with websites...`
    );

    let membersWithRSS = 0;
    let totalReleases = 0;
    let errors = 0;

    for (let i = 0; i < withSites.length; i++) {
      const member = withSites[i];

      try {
        const result = await discoverRSS(member.websiteUrl!);

        if (result && result.items.length > 0) {
          membersWithRSS++;

          for (const item of result.items) {
            const pubDate = parsePubDate(item.pubDate);

            try {
              await db
                .insert(pressReleases)
                .values({
                  bioguideId: member.bioguideId,
                  title: item.title.slice(0, 1000),
                  url: item.link.slice(0, 2000),
                  publishedAt: pubDate,
                  description: item.description,
                  source: "rss",
                })
                .onConflictDoNothing();
              totalReleases++;
            } catch {
              // Duplicate URL or other constraint — skip
            }
          }
        }
      } catch {
        errors++;
      }

      if ((i + 1) % 50 === 0) {
        console.log(
          `  ${i + 1}/${withSites.length} scanned — ${membersWithRSS} with RSS, ${totalReleases} releases, ${errors} errors`
        );
      }

      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsCount: totalReleases,
      })
      .where(sql`id = ${syncEntry.id}`);

    console.log(
      `Done. ${membersWithRSS}/${withSites.length} members have RSS. ${totalReleases} press releases ingested (${errors} errors).`
    );
  } catch (err) {
    await db
      .update(syncLog)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(sql`id = ${syncEntry.id}`);
    throw err;
  }
}

main().catch((err) => {
  console.error("Failed to ingest press releases:", err);
  process.exit(1);
});
