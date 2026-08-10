// One-off audit: find rows where amount_min > amount_max (McCaul inversion bug)
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../../lib/db");
  const { sql } = await import("drizzle-orm");

  const bad = await db.execute(sql`
    SELECT id, bioguide_id, tx_date, asset_description, tx_type, amount_min, amount_max, filing_id
    FROM stock_transactions
    WHERE amount_min > amount_max
    ORDER BY amount_min DESC
    LIMIT 25`);
  console.log("rows with min > max (all members):");
  console.log(JSON.stringify((bad as any).rows ?? bad, null, 1));

  const tot = await db.execute(sql`
    SELECT COUNT(*) AS c, SUM(amount_min) AS mn, SUM(amount_max) AS mx
    FROM stock_transactions WHERE bioguide_id = 'M001157'`);
  console.log("mccaul totals:", JSON.stringify((tot as any).rows ?? tot));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
