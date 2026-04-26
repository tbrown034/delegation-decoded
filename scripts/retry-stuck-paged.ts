/**
 * Retry the 12 stuck PDFs using page-split parsing. Single-page payloads
 * sail through the API where full-document calls were timing out.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { disclosureFilings, stockTransactions, members } from "../lib/schema";
import { sql, and, eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import { quickValidate, rangeToBounds } from "./lib/parse-ptr";
import { parsePtrPaged } from "./lib/parse-ptr-paged";
import path from "path";

const STUCK_DOCS = [
  "20030977",
  "20033762",
  "20033789",
  "20033983",
  "20034144",
  "20034285",
  "8221322",
  "8221326",
  "8221358",
  "8221359",
  "9115726",
  "9115728",
];

const PDF_BASE =
  "/Users/home/Desktop/dev/active/delegation-decoded/data/house-ptrs/pdfs/2026";

async function fetchManifest() {
  const zipPath =
    "/Users/home/Desktop/dev/active/delegation-decoded/data/house-ptrs/2026FD.zip";
  const xml = execFileSync("unzip", ["-p", zipPath, "2026FD.xml"], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const map = new Map<
    string,
    { last: string; stateDst: string; filingDate: string }
  >();
  const re = /<Member>([\s\S]*?)<\/Member>/g;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[1];
    const get = (tag: string) =>
      (body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] ?? "";
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

async function resolveBioguide(
  last: string,
  stateDst: string
): Promise<string | null> {
  const stateCode = stateDst.slice(0, 2);
  const districtMatch = stateDst.match(/(\d+)$/);
  const district = districtMatch ? parseInt(districtMatch[1], 10) : null;
  const fold = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
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

  const exists = await db
    .select({ id: disclosureFilings.id })
    .from(disclosureFilings)
    .where(
      and(
        eq(disclosureFilings.chamber, "house"),
        eq(disclosureFilings.docId, docId)
      )
    )
    .limit(1);
  if (exists.length) return { docId, ok: false, reason: "already in DB" };

  const bioguideId = await resolveBioguide(meta.last, meta.stateDst);
  if (!bioguideId)
    return {
      docId,
      ok: false,
      reason: `unresolved: ${meta.last} (${meta.stateDst})`,
    };

  const pdfPath = path.join(PDF_BASE, `${docId}.pdf`);
  const pdfBuf = await readFile(pdfPath);
  const pdfHash = createHash("sha256").update(pdfBuf).digest("hex");
  const filedDate = parseDate(meta.filingDate);

  console.log(
    `  → ${docId} ${meta.last} (${meta.stateDst}, ${(pdfBuf.length / 1024).toFixed(0)}KB) starting paged parse…`
  );
  const t0 = Date.now();
  const parseResult = await parsePtrPaged(pdfPath, { concurrency: 4 });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `  ✓ ${docId} parsed in ${dt}s — ${parseResult.transactions.length} tx, $${parseResult.tokenUsage.estimatedCostUsd}`
  );

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
  console.log("Retrying 12 stuck PDFs via page-split parser…");
  const manifest = await fetchManifest();
  console.log(`Manifest: ${manifest.size} entries`);

  // Process 3 PDFs at a time so we have ~12 in-flight page calls (3 PDFs * 4 pages each).
  const PDF_CONCURRENCY = 3;
  const queue = [...STUCK_DOCS];
  const results: any[] = [];
  async function worker() {
    while (queue.length) {
      const docId = queue.shift()!;
      try {
        const r = await processOne(docId, manifest);
        results.push(r);
      } catch (err: any) {
        results.push({ docId, ok: false, reason: err?.message ?? String(err) });
        console.error(`!! ${docId}: ${err?.message ?? err}`);
      }
    }
  }
  await Promise.all(Array.from({ length: PDF_CONCURRENCY }, worker));

  let ok = 0,
    fail = 0,
    skip = 0;
  for (const r of results) {
    if (r.ok) {
      ok++;
      console.log(`OK  ${r.docId} — ${r.transactions} tx`);
    } else {
      skip++;
      console.log(`--  ${r.docId}: ${r.reason}`);
    }
  }
  console.log(`\nSummary: ok=${ok} skip=${skip} fail=${fail}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
