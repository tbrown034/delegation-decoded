/**
 * House Clerk PTR ingester.
 *
 * Pulls the annual financial-disclosure manifest from disclosures-clerk.house.gov,
 * resolves filers to bioguide IDs, downloads any new PTR PDFs, parses them with
 * Claude, and inserts disclosure_filings + stock_transactions rows.
 *
 * Run: npx tsx scripts/ingest/disclosures-house.ts [--year 2025] [--limit 5] [--dry]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFile, readFile, mkdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import crypto from "crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and } from "drizzle-orm";
import {
  members,
  disclosureFilings,
  stockTransactions,
  syncLog,
} from "../../lib/schema";
import { parsePtr, quickValidate, rangeToBounds } from "../lib/parse-ptr";

const MANIFEST_BASE = "https://disclosures-clerk.house.gov/public_disc/financial-pdfs";
const PTR_BASE = "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs";
const CACHE_DIR = path.join(process.cwd(), "data", "house-ptrs");

const connectionString =
  process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) {
  console.error("DATABASE_URL must be set in .env.local");
  process.exit(1);
}
const db = drizzle(neon(connectionString));

// ── ARGS ──

const args = process.argv.slice(2);
const year = Number(argValue("--year")) || new Date().getFullYear();
const limit = Number(argValue("--limit")) || Infinity;
const dry = args.includes("--dry");

function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// ── MANIFEST ──

interface ManifestEntry {
  docId: string;
  filingType: string; // "P" = PTR
  year: number;
  filingDate: string | null; // YYYY-MM-DD
  last: string;
  first: string;
  suffix: string;
  stateDst: string; // e.g. "CA11" or "TX" for senators
}

async function fetchManifest(year: number): Promise<ManifestEntry[]> {
  await mkdir(CACHE_DIR, { recursive: true });
  const zipPath = path.join(CACHE_DIR, `${year}FD.zip`);

  if (!existsSync(zipPath) || (await stat(zipPath)).size < 1024) {
    const url = `${MANIFEST_BASE}/${year}FD.zip`;
    console.log(`Downloading manifest: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
    await writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
  }

  // Extract the XML to stdout — relies on system `unzip` (default on macOS/Linux)
  const xml = execFileSync("unzip", ["-p", zipPath, `${year}FD.xml`], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });

  return parseManifestXml(xml);
}

function parseManifestXml(xml: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  for (const m of xml.matchAll(/<Member>([\s\S]*?)<\/Member>/g)) {
    const inner = m[1];
    const tag = (t: string) =>
      (inner.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? "").trim();
    entries.push({
      docId: tag("DocID"),
      filingType: tag("FilingType"),
      year: Number(tag("Year")) || 0,
      filingDate: normalizeDate(tag("FilingDate")),
      last: tag("Last"),
      first: tag("First"),
      suffix: tag("Suffix"),
      stateDst: tag("StateDst"),
    });
  }
  return entries;
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  // House manifest dates are M/D/YYYY
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// ── BIOGUIDE RESOLUTION ──

async function resolveBioguide(
  entry: ManifestEntry
): Promise<string | null> {
  const stateCode = entry.stateDst.slice(0, 2).toUpperCase();
  const districtMatch = entry.stateDst.slice(2).match(/^\d+$/);
  const district = districtMatch ? Number(districtMatch[0]) : null;

  // Match on state + last name. Multiple matches → require district match too.
  const candidates = await db
    .select({
      bioguideId: members.bioguideId,
      lastName: members.lastName,
      district: members.district,
      chamber: members.chamber,
    })
    .from(members)
    .where(eq(members.stateCode, stateCode));

  // Strip diacritics ("Sánchez" → "sanchez") so accent-less manifest entries still match.
  const fold = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const lastLower = fold(entry.last);
  // Exact match first; if none, try compound last names (e.g. manifest "Delaney" → DB "McClain Delaney").
  let byLast = candidates.filter((c) => fold(c.lastName) === lastLower);
  if (byLast.length === 0) {
    byLast = candidates.filter((c) => {
      const tokens = fold(c.lastName).split(/[\s-]+/);
      return tokens.includes(lastLower);
    });
  }
  if (byLast.length === 1) return byLast[0].bioguideId;

  if (district !== null) {
    const byDistrict = byLast.filter((c) => c.district === district);
    if (byDistrict.length === 1) return byDistrict[0].bioguideId;
  } else {
    // No district → senator
    const senators = byLast.filter((c) => c.chamber === "senate");
    if (senators.length === 1) return senators[0].bioguideId;
  }

  return null;
}

// ── PIPELINE ──

async function downloadPdf(year: number, docId: string): Promise<string> {
  const dir = path.join(CACHE_DIR, "pdfs", String(year));
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${docId}.pdf`);
  if (existsSync(dest) && (await stat(dest)).size > 1024) return dest;

  const url = `${PTR_BASE}/${year}/${docId}.pdf`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PDF fetch failed (${res.status}): ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isLate(txDate: string | null, filedDate: string | null): boolean {
  if (!txDate || !filedDate) return false;
  const tx = new Date(txDate).getTime();
  const filed = new Date(filedDate).getTime();
  if (isNaN(tx) || isNaN(filed)) return false;
  const days = (filed - tx) / (1000 * 60 * 60 * 24);
  return days > 45;
}

async function alreadyIngested(docId: string): Promise<boolean> {
  const existing = await db
    .select({ id: disclosureFilings.id })
    .from(disclosureFilings)
    .where(
      and(
        eq(disclosureFilings.chamber, "house"),
        eq(disclosureFilings.docId, docId)
      )
    )
    .limit(1);
  return existing.length > 0;
}

async function processFiling(
  entry: ManifestEntry,
  runId: number
): Promise<{ ok: boolean; reason?: string; transactions?: number }> {
  if (entry.filingType !== "P") {
    return { ok: false, reason: "not a PTR" };
  }
  if (await alreadyIngested(entry.docId)) {
    return { ok: false, reason: "already ingested" };
  }

  const bioguideId = await resolveBioguide(entry);
  if (!bioguideId) {
    return {
      ok: false,
      reason: `unresolved: ${entry.last} (${entry.stateDst})`,
    };
  }

  const pdfPath = await downloadPdf(entry.year, entry.docId);
  const pdfBuf = await readFile(pdfPath);
  const pdfHash = sha256(pdfBuf);
  const pdfUrl = `${PTR_BASE}/${entry.year}/${entry.docId}.pdf`;

  if (dry) {
    console.log(`  [dry] would parse ${entry.docId} for ${bioguideId}`);
    return { ok: true, transactions: 0 };
  }

  const parseResult = await parsePtr(pdfPath);
  const validationErrors = parseResult.transactions.flatMap((tx, i) =>
    quickValidate(tx, i)
  );
  const avgConfidence =
    parseResult.transactions.reduce((s, t) => s + t.confidence, 0) /
    Math.max(1, parseResult.transactions.length);
  const parseStatus = validationErrors.length > 0 ? "review" : "parsed";

  const [filingRow] = await db
    .insert(disclosureFilings)
    .values({
      bioguideId,
      chamber: "house",
      filingType: "PTR",
      docId: entry.docId,
      filedDate: entry.filingDate,
      pdfUrl,
      pdfHash,
      parseStatus,
      parseConfidence: Math.round(avgConfidence * 100),
      pipelineRunId: runId,
    })
    .returning({ id: disclosureFilings.id });

  if (parseResult.transactions.length > 0) {
    await db.insert(stockTransactions).values(
      parseResult.transactions.map((tx) => {
        const bounds = rangeToBounds(tx.amountRange);
        return {
          filingId: filingRow.id,
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
          amountMin: bounds.min,
          amountMax: bounds.max,
          capGainsOver200: tx.capGainsOver200,
          filedLate: isLate(tx.txDate, entry.filingDate),
          needsReview: tx.confidence < 0.8,
          confidence: Math.round(tx.confidence * 100),
        };
      })
    );
  }

  return { ok: true, transactions: parseResult.transactions.length };
}

// ── MAIN ──

async function main() {
  console.log(`House PTR ingester | year=${year} limit=${limit === Infinity ? "all" : limit} dry=${dry}`);

  const [run] = await db
    .insert(syncLog)
    .values({
      source: "disclosures-clerk.house.gov",
      entityType: "ptr",
      status: "running",
    })
    .returning({ id: syncLog.id });
  const runId = run.id;

  let processed = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  try {
    const manifest = await fetchManifest(year);
    const ptrs = manifest.filter((e) => e.filingType === "P");
    console.log(`Manifest: ${manifest.length} entries, ${ptrs.length} PTRs`);

    for (const entry of ptrs) {
      if (processed >= limit) break;
      processed++;
      try {
        const result = await processFiling(entry, runId);
        if (result.ok) {
          succeeded++;
          console.log(
            `  OK ${entry.docId} ${entry.last} (${entry.stateDst}) — ${result.transactions} tx`
          );
        } else {
          skipped++;
          if (result.reason !== "already ingested") {
            console.log(`  -- ${entry.docId} ${entry.last}: ${result.reason}`);
          }
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${entry.docId}: ${msg}`);
        console.error(`  !! ${entry.docId} ${entry.last}: ${msg}`);
      }
    }

    await db
      .update(syncLog)
      .set({
        completedAt: new Date(),
        status: failed > 0 ? "failed" : "success",
        recordsCount: succeeded,
        errorMessage: failures.length ? failures.slice(0, 20).join("\n") : null,
      })
      .where(eq(syncLog.id, runId));

    console.log(
      `Done | processed=${processed} ok=${succeeded} skipped=${skipped} failed=${failed}`
    );
  } catch (err) {
    await db
      .update(syncLog)
      .set({
        completedAt: new Date(),
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(syncLog.id, runId));
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
