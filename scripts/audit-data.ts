import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // GS ticker rows — look at full context
  console.log("\n=== GS TICKER ROWS ===");
  const gs = await db.execute(sql`
    SELECT st.id, st.asset_description, st.ticker, st.asset_type, st.tx_date, st.bioguide_id, df.doc_id
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    WHERE st.ticker = 'GS'
  `);
  console.log(gs.rows ?? gs);

  // Sony future date
  console.log("\n=== SONY FUTURE DATE ===");
  const sony = await db.execute(sql`
    SELECT st.id, st.asset_description, st.ticker, st.tx_date, st.notified_date, st.bioguide_id, df.doc_id
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    WHERE st.id = 122
  `);
  console.log(sony.rows ?? sony);

  // Example Mega Corp row
  console.log("\n=== EXAMPLE MEGA CORP ===");
  const example = await db.execute(sql`
    SELECT st.id, st.asset_description, st.tx_date, st.bioguide_id, df.doc_id, df.id AS filing_id
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    WHERE st.asset_description LIKE 'Example%' OR st.asset_description LIKE '%Mega Corp%'
  `);
  console.log(example.rows ?? example);

  // Newell Brands 2023-10-31 — check if filing date supports a 2-year-old trade
  console.log("\n=== NEWELL BRANDS PRE-2024 ===");
  const newell = await db.execute(sql`
    SELECT st.id, st.asset_description, st.tx_date, st.bioguide_id, df.doc_id, df.filed_date
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    WHERE st.id = 443
  `);
  console.log(newell.rows ?? newell);

  // CADE$A weird ticker
  console.log("\n=== CADE\$A WEIRD TICKER ===");
  const cade = await db.execute(sql`
    SELECT st.id, st.asset_description, st.ticker, st.tx_date, df.doc_id
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    WHERE st.ticker = 'CADE$A'
  `);
  console.log(cade.rows ?? cade);

  // Cavall and FluxAI
  console.log("\n=== TRUNCATED DESCRIPTIONS ===");
  const trunc = await db.execute(sql`
    SELECT st.id, st.asset_description, st.tx_date, df.doc_id
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    WHERE st.id IN (637, 638)
  `);
  console.log(trunc.rows ?? trunc);

  // Lowest-confidence row
  console.log("\n=== LOW-CONFIDENCE ROWS ===");
  const lowConf = await db.execute(sql`
    SELECT st.id, st.confidence, st.asset_description, st.ticker, st.tx_date, st.amount_range
    FROM stock_transactions st
    WHERE st.confidence < 90
    ORDER BY st.confidence ASC
  `);
  console.log(lowConf.rows ?? lowConf);

  process.exit(0);
}
main();
