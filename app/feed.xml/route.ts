import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://delegation-decoded.vercel.app";

const SITE_TITLE = "Delegation Decoded — Stock disclosure preview";
const SITE_DESCRIPTION =
  "Preview rows from a coming congressional stock disclosure feature; coverage is still under validation.";

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(d: Date): string {
  return d.toUTCString();
}

export async function GET() {
  const result = await db.execute(sql`
    SELECT
      st.id,
      st.bioguide_id,
      m.full_name,
      m.state_code,
      m.district,
      m.party,
      m.chamber,
      st.tx_type,
      st.ticker,
      st.asset_description,
      st.amount_range,
      to_char(st.tx_date, 'YYYY-MM-DD')   AS tx_date,
      to_char(df.filed_date, 'YYYY-MM-DD') AS filed_date,
      df.filed_date AS filed_at,
      df.pdf_url
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    JOIN members m             ON m.bioguide_id = st.bioguide_id
    WHERE df.filed_date IS NOT NULL
    ORDER BY df.filed_date DESC, st.id DESC
    LIMIT 50
  `);

  const items = (result.rows as Array<Record<string, unknown>>).map((r) => {
    const district = r.district ? `-${r.district}` : "";
    const ticker = ((r.ticker as string) ?? "").trim();
    // 1,198 of the parsed transactions are notes, funds and bonds with no
    // ticker. Falling back to the raw asset_description put a multi-line
    // prospectus name in the RSS title, so cap it at a headline length.
    const asset = (r.asset_description as string) ?? "asset";
    const label = ticker || (asset.length > 60 ? `${asset.slice(0, 57)}...` : asset);
    const action = (r.tx_type as string).startsWith("P") ? "bought" : "sold";
    const title = `${r.full_name} ${action} ${label} (${r.amount_range})`;
    const description = [
      `${r.party} ${r.chamber === "senate" ? "Senator" : "Representative"} from ${r.state_code}${district}.`,
      `Transaction date: ${r.tx_date}. Filed: ${r.filed_date}.`,
      `Asset: ${r.asset_description}. Amount: ${r.amount_range}.`,
    ].join(" ");
    // A tickerless asset has no company page, and "unknown" resolved to an
    // empty one. Send those readers to the filer's own trade list instead.
    const link = ticker
      ? `${BASE_URL}/trades/companies/${encodeURIComponent(ticker)}`
      : `${BASE_URL}/trades/${r.bioguide_id}`;
    const guid = `${BASE_URL}/trades#${r.id}`;
    const pubDate = rfc822(new Date(r.filed_at as string));
    return [
      "<item>",
      `<title>${escape(title)}</title>`,
      `<link>${escape(link)}</link>`,
      `<guid isPermaLink="false">${escape(guid)}</guid>`,
      `<pubDate>${pubDate}</pubDate>`,
      `<description>${escape(description)}</description>`,
      `<source url="${escape(r.pdf_url as string)}">Source PDF</source>`,
      "</item>",
    ].join("");
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    `<title>${escape(SITE_TITLE)}</title>`,
    `<link>${BASE_URL}</link>`,
    `<description>${escape(SITE_DESCRIPTION)}</description>`,
    "<language>en-us</language>",
    `<lastBuildDate>${rfc822(new Date())}</lastBuildDate>`,
    items.join(""),
    "</channel>",
    "</rss>",
  ].join("");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=900, s-maxage=900",
      "X-Robots-Tag": "noindex, follow",
    },
  });
}
