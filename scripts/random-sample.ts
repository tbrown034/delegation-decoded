import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const sample = await db.execute(sql`
    SELECT st.id, st.row_index, st.asset_description, st.ticker, st.asset_type,
           st.tx_type, st.tx_date, st.amount_range, st.confidence,
           df.doc_id, m.last_name, m.state_code, m.district
    FROM stock_transactions st
    JOIN disclosure_filings df ON df.id = st.filing_id
    JOIN members m ON m.bioguide_id = st.bioguide_id
    ORDER BY RANDOM()
    LIMIT 20
  `);
  console.log(JSON.stringify(sample.rows, null, 2));
  process.exit(0);
}
main();
