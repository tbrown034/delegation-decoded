/**
 * Retry the 12 stuck PDFs in parallel with verbose progress logging.
 * Skips any that already exist in DB.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { disclosureFilings, stockTransactions, members } from "../lib/schema";
import { sql, and, eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { parsePtr, quickValidate, rangeToBounds } from "./lib/parse-ptr";
import path from "path";

const STUCK_DOCS = [
  "20030977", // Letlow LA-05
  "20033762", // Cisneros CA-31
  "20033789", // Johnson
  "20033983", // Cisneros
  "20034144", // Cisneros
  "20034285", // Cisneros
  "8221322",  // Khanna
  "8221326",  // McCaul
  "8221358",  // Khanna
  "8221359",  // McCaul
  "9115726",  // Khanna
  "9115728",  // McCaul
];

const PDF_BASE = "/Users/home/Desktop/dev/active/delegation-decoded/data/house-ptrs/pdfs/2026";

// Manifest is already cached at data/house-ptrs/2026FD.zip from prior runs.
async function fetchManifest(): Promise<Map<string, { last: string; stateDst: string; filingDate: string }>> {
  const zipPath = "/Users/home/Desktop/dev/active/delegation-decoded/data/house-ptrs/2026FD.zip";
  const xml = execFileSync("unzip", ["-p", zipPath, "2026FD.xml"], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const map = new Map();
  const re = /<Member>([\s\S]*?)<\/Member>/g;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[1];
    const get = (tag: string) => (body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] ?? "";
    const docId = get("DocID");
    if (!docId) continue;
    map.set(docId, {
      last: get("Last"),
      stateDst: get("StateDst"),
      filingDate: get("FilingDate"),
    });
  }
  return map;
}

function parseDate(usFormat: string): string | null {
  const m = usFormat.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function isLate(txDate: string | null, filedDate: string | null): boolean {
  if (!txDate || !filedDate) return false;
  const tx = new Date(txDate).getTime();
  const filed = new Date(filedDate).getTime();
  if (isNaN(tx) || isNaN(filed)) return false;
  return (filed - tx) / (1000 * 60 * 60 * 24) > 45;
}

async function resolveBioguide(last: string, stateDst: string): Promise<string | null> {
  const stateCode = stateDst.slice(0, 2);
  const districtMatch = stateDst.match(/(\d+)$/);
  const district = districtMatch ? parseInt(districtMatch[1], 10) : null;

  const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const lastLower = fold(last);

  const candidates = await db
    .select({
      bioguideId: members.bioguideId,
      lastName: members.lastName,
      district: members.district,
    })
    .from(members)
    .where(eq(members.stateCode, stateCode));

  let byLast = candidates.filter((c) => fold(c.lastName) === lastLower);
  if (byLast.length === 0) {
    byLast = candidates.filter((c) => {
      const tokens = fold(c.lastName).split(/[\s-]+/);
      return tokens.includes(lastLower);
    });
  }
  if (byLast.length === 1) return byLast[0].bioguideId;
  if (byLast.length > 1 && district !== null) {
    const m = byLast.find((c) => c.district === district);
    if (m) return m.bioguideId;
  }
  return null;
}

async function processOne(docId: string, manifest: Map<string, any>) {
  const meta = manifest.get(docId);
  if (!meta) return { docId, ok: false, reason: "not in manifest" };

  // Already in DB?
  const exists = await db
    .select({ id: disclosureFilings.id })
    .from(disclosureFilings)
    .where(and(eq(disclosureFilings.chamber, "house"), eq(disclosureFilings.docId, docId)))
    .limit(1);
  if (exists.length) return { docId, ok: false, reason: "already in DB" };

  const bioguideId = await resolveBioguide(meta.last, meta.stateDst);
  if (!bioguideId) return { docId, ok: false, reason: `unresolved: ${meta.last} (${meta.stateDst})` };

  const pdfPath = path.join(PDF_BASE, `${docId}.pdf`);
  const pdfBuf = await readFile(pdfPath);
  const pdfHash = createHash("sha256").update(pdfBuf).digest("hex");
  const filedDate = parseDate(meta.filingDate);

  console.log(`  → parsing ${docId} ${meta.last} (${meta.stateDst}, ${(pdfBuf.length / 1024).toFixed(0)}KB)…`);
  const t0 = Date.now();
  const parseResult = await parsePtr(pdfPath);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ✓ ${docId} parsed in ${dt}s — ${parseResult.transactions.length} tx, $${parseResult.tokenUsage.estimatedCostUsd}`);

  const validationErrors = parseResult.transactions.flatMap((tx, i) => quickValidate(tx, i));
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
      docId,
      filedDate,
      pdfUrl: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/${docId}.pdf`,
      pdfHash,
      parseStatus,
      parseConfidence: Math.round(avgConfidence * 100),
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
          filedLate: isLate(tx.txDate, filedDate),
          needsReview: tx.confidence < 0.8,
          confidence: Math.round(tx.confidence * 100),
        };
      })
    );
  }
  return { docId, ok: true, transactions: parseResult.transactions.length };
}

async function main() {
  console.log("Retrying 12 stuck PDFs in parallel…");
  const manifest = await fetchManifest();
  console.log(`Manifest loaded: ${manifest.size} entries`);

  // Process in parallel — Anthropic SDK handles concurrency well.
  const results = await Promise.allSettled(STUCK_DOCS.map((d) => processOne(d, manifest)));

  let ok = 0, fail = 0, skip = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const docId = STUCK_DOCS[i];
    if (r.status === "fulfilled") {
      const v = r.value;
      if (v.ok) {
        ok++;
        console.log(`OK  ${v.docId} — ${v.transactions} tx`);
      } else {
        skip++;
        console.log(`--  ${v.docId}: ${v.reason}`);
      }
    } else {
      fail++;
      console.error(`!!  ${docId}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    }
  }
  console.log(`\nSummary: ok=${ok} skip=${skip} fail=${fail}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
