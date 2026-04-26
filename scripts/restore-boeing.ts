import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // Boeing's ticker IS BA — restore it for any rows where asset_description has "(BA)".
  const restored = await db.execute(sql`
    UPDATE stock_transactions
    SET ticker = 'BA'
    WHERE asset_description ~* '\\(BA\\)'
      AND ticker IS NULL
  `);
  console.log("Boeing restored:", restored.rowCount);

  // Show remaining null-ticker rows that originally had a parens ticker that is also an asset-type code.
  const verify = await db.execute(sql`
    SELECT id, asset_description, ticker FROM stock_transactions WHERE asset_description LIKE '%Boeing%'
  `);
  for (const r of verify.rows) console.log("  ", JSON.stringify(r));

  process.exit(0);
}
main();
