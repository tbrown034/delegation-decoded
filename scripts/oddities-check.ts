import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== Truncated descriptions (Cavall, FluxAI etc) ===");
  const trunc = await db.execute(sql`
    SELECT st.id, st.asset_description, st.ticker, st.tx_date, df.doc_id, m.last_name
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    JOIN members m ON m.bioguide_id = st.bioguide_id
    WHERE LENGTH(st.asset_description) < 12
       OR st.asset_description ILIKE '%Cavall%'
       OR st.asset_description ILIKE '%FluxAI%'
    ORDER BY st.id
  `);
  for (const r of trunc.rows) console.log(JSON.stringify(r));

  console.log("\n=== CADE$A weird ticker ===");
  const cade = await db.execute(sql`
    SELECT st.id, st.asset_description, st.ticker, st.tx_date, df.doc_id, m.last_name
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    JOIN members m ON m.bioguide_id = st.bioguide_id
    WHERE st.ticker LIKE '%$%' OR st.ticker LIKE '%/%' OR st.ticker LIKE '%-%'
  `);
  for (const r of cade.rows) console.log(JSON.stringify(r));

  console.log("\n=== Future-dated trades ===");
  const fut = await db.execute(sql`
    SELECT st.id, st.asset_description, st.ticker, st.tx_date, df.doc_id, df.filed_date, m.last_name
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    JOIN members m ON m.bioguide_id = st.bioguide_id
    WHERE st.tx_date > df.filed_date
    ORDER BY st.tx_date DESC
  `);
  for (const r of fut.rows) console.log(JSON.stringify(r));

  console.log("\n=== Confidence distribution ===");
  const conf = await db.execute(sql`
    SELECT
      CASE
        WHEN confidence >= 95 THEN '95-100'
        WHEN confidence >= 90 THEN '90-94'
        WHEN confidence >= 85 THEN '85-89'
        WHEN confidence >= 80 THEN '80-84'
        ELSE 'below 80'
      END AS band,
      COUNT(*)::int AS n
    FROM stock_transactions
    GROUP BY 1
    ORDER BY 1 DESC
  `);
  for (const r of conf.rows) console.log(JSON.stringify(r));

  console.log("\n=== Tx by amount range ===");
  const am = await db.execute(sql`
    SELECT amount_range, COUNT(*)::int AS n
    FROM stock_transactions
    GROUP BY amount_range
    ORDER BY MIN(amount_min)
  `);
  for (const r of am.rows) console.log(JSON.stringify(r));

  console.log("\n=== Late-filed count ===");
  const late = await db.execute(sql`
    SELECT
      filed_late, COUNT(*)::int AS n
    FROM stock_transactions
    GROUP BY filed_late
  `);
  for (const r of late.rows) console.log(JSON.stringify(r));

  process.exit(0);
}
main();
