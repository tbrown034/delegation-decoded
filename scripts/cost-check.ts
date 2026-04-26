import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { disclosureFilings, stockTransactions } from "../lib/schema";
import { sql } from "drizzle-orm";

async function main() {
  const [filings] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      parsed: sql<number>`COUNT(*) FILTER (WHERE parse_status = 'parsed')::int`,
      review: sql<number>`COUNT(*) FILTER (WHERE parse_status = 'review')::int`,
    })
    .from(disclosureFilings);
  const [tx] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(stockTransactions);
  const [memberCount] = await db
    .select({
      members: sql<number>`COUNT(DISTINCT bioguide_id)::int`,
    })
    .from(stockTransactions);
  console.log({
    filings,
    transactions: tx.total,
    distinctMembersWithTrades: memberCount.members,
  });
  // Reset filing 134 (Rogers "nothing to report" amendment with placeholder row).
  const updated = await db.execute(sql`
    UPDATE disclosure_filings SET parse_status = 'parsed' WHERE id = 134
  `);
  console.log("updated:", updated.rowCount ?? updated);
  process.exit(0);
}
main();
