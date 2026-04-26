import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    SELECT st.id, st.row_index, st.asset_description, st.ticker,
           st.tx_type, st.tx_date, st.amount_range, st.confidence,
           df.doc_id, m.last_name, m.state_code, m.district
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    JOIN members m ON m.bioguide_id = st.bioguide_id
    WHERE st.confidence < 90
    ORDER BY st.confidence ASC
  `);
  console.log(`Low-confidence rows (${r.rows.length}):`);
  for (const row of r.rows) {
    console.log(JSON.stringify(row));
  }
  process.exit(0);
}
main();
