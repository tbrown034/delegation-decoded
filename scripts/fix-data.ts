import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== Searching for phantom 'Example' rows ===");
  const examples = await db.execute(sql`
    SELECT id, asset_description, tx_date, bioguide_id
    FROM stock_transactions
    WHERE asset_description ILIKE '%example%'
       OR asset_description ILIKE '%mega corp%'
       OR asset_description ILIKE '%sample%'
  `);
  console.log("Found:", examples.rows ?? examples);

  console.log("\n=== Deleting confirmed template/example rows ===");
  const deleted = await db.execute(sql`
    DELETE FROM stock_transactions
    WHERE asset_description ILIKE '%example mega corp%'
  `);
  console.log("Deleted rows:", deleted.rowCount);

  console.log("\n=== Smart ticker fix: null asset-type-code tickers on non-stock rows ===");
  const fixedTickers = await db.execute(sql`
    UPDATE stock_transactions
    SET ticker = NULL
    WHERE ticker IN ('ST','GS','CS','BD','OP','MF','ET','PS','OL','OM','RE','PE')
      AND asset_type != 'Stock'
  `);
  console.log("Tickers nulled:", fixedTickers.rowCount);

  console.log("\n=== Verify Goldman Sachs rows preserved ===");
  const gs = await db.execute(sql`
    SELECT id, asset_description, ticker, asset_type
    FROM stock_transactions
    WHERE ticker = 'GS'
  `);
  console.log("Remaining ticker='GS':", gs.rows ?? gs);

  console.log("\n=== Final totals ===");
  const final = await db.execute(sql`
    SELECT COUNT(*) AS tx,
           COUNT(DISTINCT bioguide_id) AS members,
           COUNT(DISTINCT filing_id) AS filings
    FROM stock_transactions
  `);
  console.log(final.rows ?? final);

  process.exit(0);
}
main();
