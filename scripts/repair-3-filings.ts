/**
 * Repair the 3 filings whose disclosureFilings row inserted but whose
 * stockTransactions bulk insert failed during the parallel paged retry.
 * Re-parses each PDF (paged) serially and inserts the transactions.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import {
  disclosureFilings,
  stockTransactions,
} from "../lib/schema";
import { eq, and } from "drizzle-orm";
import { quickValidate, rangeToBounds } from "./lib/parse-ptr";
import { parsePtrPaged } from "./lib/parse-ptr-paged";
import path from "path";

const TARGETS = ["20033789", "20033762", "8221326"];
const PDF_BASE =
  "/Users/home/Desktop/dev/active/delegation-decoded/data/house-ptrs/pdfs/2026";

function isLate(txDate: string | null, filedDate: string | null): boolean {
  if (!txDate || !filedDate) return false;
  const tx = new Date(txDate).getTime();
  const filed = new Date(filedDate).getTime();
  if (isNaN(tx) || isNaN(filed)) return false;
  return (filed - tx) / (1000 * 60 * 60 * 24) > 45;
}

async function main() {
  for (const docId of TARGETS) {
    const [filing] = await db
      .select()
      .from(disclosureFilings)
      .where(
        and(
          eq(disclosureFilings.chamber, "house"),
          eq(disclosureFilings.docId, docId)
        )
      );
    if (!filing) {
      console.log(`!! ${docId} not found in DB`);
      continue;
    }
    const existingTx = await db
      .select({ id: stockTransactions.id })
      .from(stockTransactions)
      .where(eq(stockTransactions.filingId, filing.id));
    if (existingTx.length > 0) {
      console.log(`-- ${docId} already has ${existingTx.length} tx, skipping`);
      continue;
    }

    const pdfPath = path.join(PDF_BASE, `${docId}.pdf`);
    console.log(`→ ${docId} re-parsing…`);
    const t0 = Date.now();
    const parseResult = await parsePtrPaged(pdfPath, { concurrency: 4 });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `✓ ${docId} parsed in ${dt}s — ${parseResult.transactions.length} tx`
    );

    if (parseResult.transactions.length === 0) {
      console.log(`-- ${docId} parsed 0 tx, nothing to insert`);
      continue;
    }

    const validationErrors = parseResult.transactions.flatMap((tx, i) =>
      quickValidate(tx, i)
    );
    const avgConfidence =
      parseResult.transactions.reduce((s, t) => s + t.confidence, 0) /
      Math.max(1, parseResult.transactions.length);
    const newStatus = validationErrors.length > 0 ? "review" : "parsed";

    // Insert in chunks of 100 to avoid the param-count limit that may have caused failure.
    const CHUNK = 100;
    let inserted = 0;
    for (let i = 0; i < parseResult.transactions.length; i += CHUNK) {
      const slice = parseResult.transactions.slice(i, i + CHUNK);
      try {
        await db.insert(stockTransactions).values(
          slice.map((tx) => {
            const bounds = rangeToBounds(tx.amountRange);
            return {
              filingId: filing.id,
              bioguideId: filing.bioguideId,
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
              filedLate: isLate(tx.txDate, filing.filedDate),
              needsReview: tx.confidence < 0.8,
              confidence: Math.round(tx.confidence * 100),
            };
          })
        );
        inserted += slice.length;
      } catch (err: any) {
        console.error(
          `   chunk ${i}-${i + slice.length} failed: ${err?.message?.slice(0, 200)}`
        );
        // Try one-by-one to find the bad row.
        for (let j = 0; j < slice.length; j++) {
          const tx = slice[j];
          try {
            const bounds = rangeToBounds(tx.amountRange);
            await db.insert(stockTransactions).values({
              filingId: filing.id,
              bioguideId: filing.bioguideId,
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
              filedLate: isLate(tx.txDate, filing.filedDate),
              needsReview: tx.confidence < 0.8,
              confidence: Math.round(tx.confidence * 100),
            });
            inserted++;
          } catch (innerErr: any) {
            console.error(
              `   row ${i + j} (rowIndex=${tx.rowIndex}) FAILED: ${innerErr?.message?.slice(0, 250)}`
            );
            console.error(`   data: ${JSON.stringify(tx).slice(0, 300)}`);
          }
        }
      }
    }
    console.log(`   inserted ${inserted}/${parseResult.transactions.length}`);

    await db
      .update(disclosureFilings)
      .set({
        parseStatus: newStatus,
        parseConfidence: Math.round(avgConfidence * 100),
      })
      .where(eq(disclosureFilings.id, filing.id));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
