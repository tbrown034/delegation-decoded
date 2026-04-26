import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const docs = ["20033789", "20033762", "8221326"];
  for (const doc of docs) {
    const filing = await db.execute(sql`
      SELECT df.id, df.doc_id, df.parse_status, m.last_name,
             (SELECT COUNT(*)::int FROM stock_transactions WHERE filing_id = df.id) AS tx_count
      FROM disclosure_filings df
      LEFT JOIN members m ON m.bioguide_id = df.bioguide_id
      WHERE df.doc_id = ${doc} AND df.chamber = 'house'
    `);
    console.log(JSON.stringify(filing.rows[0] || { doc, found: false }));
  }
  process.exit(0);
}
main();
