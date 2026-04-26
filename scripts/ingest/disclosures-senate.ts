/**
 * Senate eFD PTR ingester.
 *
 * Senate filings are HTML web-form pages (not PDFs like House), so we parse
 * the rendered transaction table directly — no vision API call needed. Much
 * faster, cheaper, and more deterministic than the House pipeline.
 *
 * Run: npx tsx scripts/ingest/disclosures-senate.ts [--year 2026] [--limit 5] [--dry]
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import {
  members,
  disclosureFilings,
  stockTransactions,
  syncLog,
} from "../../lib/schema";

const BASE = "https://efdsearch.senate.gov";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 delegation-decoded";

const connectionString =
  process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) {
  console.error("DATABASE_URL must be set in .env.local");
  process.exit(1);
}
const db = drizzle(neon(connectionString));

const args = process.argv.slice(2);
const year = Number(argValue("--year")) || new Date().getFullYear();
const limit = Number(argValue("--limit")) || Infinity;
const dry = args.includes("--dry");
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// ── Cookie jar helpers ──

interface JarEntry { name: string; value: string }
function parseSetCookie(headers: string[]): JarEntry[] {
  const out: JarEntry[] = [];
  for (const raw of headers) {
    const first = raw.split(";")[0];
    const eq = first.indexOf("=");
    if (eq >= 0) out.push({ name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() });
  }
  return out;
}
function jarHeader(jar: JarEntry[]): string {
  return jar.map((c) => `${c.name}=${c.value}`).join("; ");
}
function mergeJar(jar: JarEntry[], next: JarEntry[]): JarEntry[] {
  const map = new Map(jar.map((c) => [c.name, c.value]));
  for (const c of next) map.set(c.name, c.value);
  return Array.from(map, ([name, value]) => ({ name, value }));
}
function csrfFrom(html: string): string | null {
  return html.match(/name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)["']/)?.[1] ?? null;
}

async function acceptTos(): Promise<{ jar: JarEntry[]; csrf: string }> {
  let jar: JarEntry[] = [];
  const home = await fetch(`${BASE}/search/home/`, { headers: { "User-Agent": UA } });
  jar = mergeJar(jar, parseSetCookie(home.headers.getSetCookie()));
  const csrf = csrfFrom(await home.text());
  if (!csrf) throw new Error("no csrf on /search/home/");
  const tos = await fetch(`${BASE}/search/home/`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jarHeader(jar),
      Referer: `${BASE}/search/home/`,
    },
    body: new URLSearchParams({ csrfmiddlewaretoken: csrf, prohibition_agreement: "1" }).toString(),
  });
  jar = mergeJar(jar, parseSetCookie(tos.headers.getSetCookie()));
  // Refresh CSRF for the search API
  const search = await fetch(`${BASE}/search/`, {
    headers: { "User-Agent": UA, Cookie: jarHeader(jar) },
  });
  jar = mergeJar(jar, parseSetCookie(search.headers.getSetCookie()));
  const csrf2 = csrfFrom(await search.text()) ?? csrf;
  return { jar, csrf: csrf2 };
}

// ── List all Senate PTRs in year ──

interface SenateListing {
  firstName: string;
  lastName: string;
  fullLabel: string;
  detailUrl: string;
  filedDate: string; // YYYY-MM-DD
  reportId: string; // UUID from URL
}

async function listPtrs(jar: JarEntry[], csrf: string, year: number): Promise<SenateListing[]> {
  const all: SenateListing[] = [];
  const PAGE = 100;
  let start = 0;
  while (true) {
    const body = new URLSearchParams({
      csrfmiddlewaretoken: csrf,
      report_types: "[11]",
      filer_types: "[1]",
      submitted_start_date: `01/01/${year} 00:00:00`,
      submitted_end_date: `12/31/${year} 23:59:59`,
      candidate_state: "",
      senator_state: "",
      office_id: "",
      first_name: "",
      last_name: "",
      start: String(start),
      length: String(PAGE),
    });
    const r = await fetch(`${BASE}/search/report/data/`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: jarHeader(jar),
        Referer: `${BASE}/search/`,
        "X-CSRFToken": csrf,
      },
      body: body.toString(),
    });
    if (!r.ok) throw new Error(`list fetch failed: ${r.status}`);
    const json = (await r.json()) as { recordsTotal: number; data: string[][] };
    for (const row of json.data) {
      const [firstName, lastName, fullLabel, linkHtml, filedDateUs] = row;
      const idMatch = linkHtml.match(/\/search\/view\/ptr\/([0-9a-f-]+)/);
      const id = idMatch?.[1] ?? "";
      // Skip if not a real PTR link (paper amendments sometimes link elsewhere)
      if (!id) continue;
      const dateMatch = filedDateUs.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      const filedDate = dateMatch
        ? `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`
        : "";
      all.push({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        fullLabel,
        detailUrl: `${BASE}/search/view/ptr/${id}/`,
        filedDate,
        reportId: id,
      });
    }
    if (start + json.data.length >= json.recordsTotal) break;
    start += PAGE;
  }
  return all;
}

// ── HTML PTR parser ──

const AMOUNT_BUCKETS: { re: RegExp; label: string; min: number; max: number }[] = [
  { re: /\$1,001\s*-\s*\$15,000/i, label: "$1,001 - $15,000", min: 1001, max: 15000 },
  { re: /\$15,001\s*-\s*\$50,000/i, label: "$15,001 - $50,000", min: 15001, max: 50000 },
  { re: /\$50,001\s*-\s*\$100,000/i, label: "$50,001 - $100,000", min: 50001, max: 100000 },
  { re: /\$100,001\s*-\s*\$250,000/i, label: "$100,001 - $250,000", min: 100001, max: 250000 },
  { re: /\$250,001\s*-\s*\$500,000/i, label: "$250,001 - $500,000", min: 250001, max: 500000 },
  { re: /\$500,001\s*-\s*\$1,000,000/i, label: "$500,001 - $1,000,000", min: 500001, max: 1000000 },
  { re: /\$1,000,001\s*-\s*\$5,000,000/i, label: "$1,000,001 - $5,000,000", min: 1000001, max: 5000000 },
  { re: /\$5,000,001\s*-\s*\$25,000,000/i, label: "$5,000,001 - $25,000,000", min: 5000001, max: 25000000 },
  { re: /\$25,000,001\s*-\s*\$50,000,000/i, label: "$25,000,001 - $50,000,000", min: 25000001, max: 50000000 },
  { re: /Over\s*\$50,000,000/i, label: "Over $50,000,000", min: 50000001, max: 999999999 },
];

function bucketAmount(text: string): { label: string; min: number; max: number } {
  for (const b of AMOUNT_BUCKETS) if (b.re.test(text)) return { label: b.label, min: b.min, max: b.max };
  return { label: "$1,001 - $15,000", min: 1001, max: 15000 };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#35;/g, "#")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseUsDate(us: string): string | null {
  const m = us.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const fullYear = yyyy.length === 2 ? `20${yyyy}` : yyyy;
  return `${fullYear}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function mapOwner(s: string): "SP" | "DC" | "JT" | null {
  const t = s.toLowerCase();
  if (t.includes("spouse")) return "SP";
  if (t.includes("dependent") || t.includes("child")) return "DC";
  if (t.includes("joint")) return "JT";
  return null; // "Self" or empty
}

function mapTxType(s: string): "P" | "S" | "S (partial)" | "E" {
  const t = s.toLowerCase();
  if (t.includes("partial")) return "S (partial)";
  if (t.startsWith("p") || t.includes("purchase") || t.includes("buy")) return "P";
  if (t.includes("exchange")) return "E";
  return "S";
}

function mapAssetType(s: string): string | null {
  const t = s.toLowerCase();
  if (t.includes("stock") || t.includes("equity")) return "Stock";
  if (t.includes("bond") || t.includes("note") || t.includes("muni")) return "Bond";
  if (t.includes("option")) return "Option";
  if (t.includes("fund") || t.includes("etf") || t.includes("mutual")) return "Fund";
  if (t.includes("crypto")) return "Cryptocurrency";
  return s.trim() || null;
}

interface ParsedSenateTx {
  rowIndex: number;
  ownerCode: "SP" | "DC" | "JT" | null;
  ticker: string | null;
  assetDescription: string;
  assetType: string | null;
  txType: "P" | "S" | "S (partial)" | "E";
  txDate: string | null;
  notifiedDate: null;
  amountRange: string;
  amountMin: number;
  amountMax: number;
  capGainsOver200: boolean;
  confidence: number;
}

function parseSenateHtml(html: string): ParsedSenateTx[] {
  const tableMatch = html.match(/<table[^>]*class=["'][^"']*table[^"']*["'][\s\S]*?<\/table>/i);
  if (!tableMatch) return [];
  const tbodyMatch = tableMatch[0].match(/<tbody[\s\S]*?<\/tbody>/i);
  const body = tbodyMatch ? tbodyMatch[0] : tableMatch[0];
  const rows = body.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const out: ParsedSenateTx[] = [];
  let idx = 0;
  for (const row of rows) {
    if (/<th\b/i.test(row)) continue; // header
    const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (cells.length < 8) continue;
    const cleaned = cells.map(stripTags);
    // Columns: #, Tx Date, Owner, Ticker, Asset Name, Asset Type, Type, Amount, Comment
    const [, txDateRaw, ownerRaw, tickerRaw, assetNameRaw, assetTypeRaw, typeRaw, amountRaw, commentRaw] = cleaned;
    const txDate = parseUsDate(txDateRaw);
    const ticker = tickerRaw && /^[A-Z][A-Z0-9.\-]{0,7}$/.test(tickerRaw) ? tickerRaw : null;
    const amount = bucketAmount(amountRaw);
    const desc = (assetNameRaw || "").trim();
    if (!desc) continue;
    out.push({
      rowIndex: idx++,
      ownerCode: mapOwner(ownerRaw),
      ticker,
      assetDescription: desc,
      assetType: mapAssetType(assetTypeRaw),
      txType: mapTxType(typeRaw),
      txDate,
      notifiedDate: null,
      amountRange: amount.label,
      amountMin: amount.min,
      amountMax: amount.max,
      capGainsOver200: /capital gains/i.test(commentRaw || ""),
      confidence: ticker ? 95 : 85, // structured HTML — high confidence
    });
  }
  return out;
}

// ── Bioguide resolver ──

const fold = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function stripSuffix(name: string): string {
  // Drop ", Jr." / ", Sr." / ", II" / ", III" / ", IV" — eFD ships them inside last_name.
  return name.replace(/,\s*(jr|sr|i{1,3}|iv|v)\.?$/i, "").trim();
}

async function resolveBioguide(firstName: string, lastName: string): Promise<string | null> {
  const candidates = await db
    .select({
      bioguideId: members.bioguideId,
      lastName: members.lastName,
      firstName: members.firstName,
    })
    .from(members)
    .where(eq(members.chamber, "senate"));
  const last = fold(stripSuffix(lastName));
  let byLast = candidates.filter((c) => fold(c.lastName) === last);
  if (byLast.length === 0) {
    byLast = candidates.filter((c) => {
      const tokens = fold(c.lastName).split(/[\s-]+/);
      return tokens.includes(last);
    });
  }
  if (byLast.length === 1) return byLast[0].bioguideId;
  if (byLast.length > 1) {
    // Disambiguate using the first ~3 chars of first name (eFD often has "Angus S" while DB has "Angus").
    const first = fold(firstName).split(/\s+/)[0].slice(0, 3);
    const m = byLast.find((c) => fold(c.firstName).startsWith(first));
    if (m) return m.bioguideId;
  }
  return null;
}

// ── Validation ──

function isLate(txDate: string | null, filedDate: string | null): boolean {
  if (!txDate || !filedDate) return false;
  const tx = new Date(txDate).getTime();
  const filed = new Date(filedDate).getTime();
  if (isNaN(tx) || isNaN(filed)) return false;
  return (filed - tx) / (1000 * 60 * 60 * 24) > 45;
}

// ── Main ──

async function main() {
  const t0 = Date.now();
  console.log(`Senate eFD ingest — year=${year} limit=${limit === Infinity ? "all" : limit} dry=${dry}`);
  const { jar, csrf } = await acceptTos();
  console.log("✓ TOS accepted");
  const listings = await listPtrs(jar, csrf, year);
  console.log(`✓ ${listings.length} PTRs listed`);

  let inserted = 0, skipped = 0, failed = 0, txTotal = 0;
  for (const item of listings.slice(0, limit)) {
    const docId = item.reportId;
    // Skip if already in DB
    const existing = await db
      .select({ id: disclosureFilings.id })
      .from(disclosureFilings)
      .where(and(eq(disclosureFilings.chamber, "senate"), eq(disclosureFilings.docId, docId)))
      .limit(1);
    if (existing.length) {
      skipped++;
      continue;
    }

    const bioguideId = await resolveBioguide(item.firstName, item.lastName);
    if (!bioguideId) {
      console.log(`-- ${docId} unresolved: ${item.firstName} ${item.lastName}`);
      failed++;
      continue;
    }

    // Fetch the detail HTML
    const r = await fetch(item.detailUrl, {
      headers: { "User-Agent": UA, Cookie: jarHeader(jar), Referer: `${BASE}/search/` },
    });
    if (!r.ok) {
      console.log(`!! ${docId} HTTP ${r.status}`);
      failed++;
      continue;
    }
    const html = await r.text();
    const txs = parseSenateHtml(html);
    const htmlHash = crypto.createHash("sha256").update(html).digest("hex");
    const avgConfidence = txs.length
      ? txs.reduce((s, t) => s + t.confidence, 0) / txs.length
      : 0;
    const status = txs.length === 0 ? "review" : "parsed";

    if (dry) {
      console.log(`DRY ${docId} ${item.lastName}: ${txs.length} tx, conf=${avgConfidence.toFixed(0)}`);
      continue;
    }

    const [filing] = await db
      .insert(disclosureFilings)
      .values({
        bioguideId,
        chamber: "senate",
        filingType: "PTR",
        docId,
        filedDate: item.filedDate || null,
        pdfUrl: item.detailUrl,
        pdfHash: htmlHash,
        parseStatus: status,
        parseConfidence: Math.round(avgConfidence),
      })
      .returning({ id: disclosureFilings.id });

    if (txs.length > 0) {
      await db.insert(stockTransactions).values(
        txs.map((tx) => ({
          filingId: filing.id,
          bioguideId,
          rowIndex: tx.rowIndex,
          ownerCode: tx.ownerCode,
          assetDescription: tx.assetDescription,
          ticker: tx.ticker,
          assetType: tx.assetType,
          txType: tx.txType,
          txDate: tx.txDate,
          notifiedDate: tx.notifiedDate,
          amountRange: tx.amountRange,
          amountMin: tx.amountMin,
          amountMax: tx.amountMax,
          capGainsOver200: tx.capGainsOver200,
          filedLate: isLate(tx.txDate, item.filedDate),
          needsReview: tx.confidence < 80,
          confidence: tx.confidence,
        }))
      );
    }
    inserted++;
    txTotal += txs.length;
    console.log(`✓ ${docId} ${item.lastName}: ${txs.length} tx, conf=${avgConfidence.toFixed(0)}`);
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${dt}s — inserted=${inserted}, skipped=${skipped}, failed=${failed}, txs=${txTotal}`);

  if (!dry) {
    await db.insert(syncLog).values({
      source: "senate_efd",
      entityType: "disclosures",
      status: "ok",
      recordsCount: inserted,
      completedAt: new Date(),
    });
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
