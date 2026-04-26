import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const status = await db.execute(sql`
    SELECT parse_status, COUNT(*)::int AS n
    FROM disclosure_filings
    GROUP BY parse_status
    ORDER BY parse_status
  `);
  console.log("Filing status:", status.rows);

  const tx = await db.execute(sql`SELECT COUNT(*)::int AS n FROM stock_transactions`);
  console.log("Total tx:", tx.rows);

  const stuck = await db.execute(sql`
    SELECT df.id, df.doc_id, df.bioguide_id, df.parse_status, df.parse_confidence, df.page_count, m.last_name, m.state_code, m.district
    FROM disclosure_filings df
    LEFT JOIN members m ON m.bioguide_id = df.bioguide_id
    WHERE df.parse_status NOT IN ('parsed')
    ORDER BY df.id
  `);
  console.log("\nStuck filings (" + stuck.rows.length + "):");
  for (const r of stuck.rows) {
    console.log(`  id=${r.id} doc=${r.doc_id} ${r.last_name} ${r.state_code}-${r.district} status=${r.parse_status} pages=${r.page_count}`);
  }

  const members = await db.execute(sql`
    SELECT COUNT(DISTINCT bioguide_id)::int AS n FROM stock_transactions
  `);
  console.log("\nDistinct members with trades:", members.rows);

  process.exit(0);
}
main();
