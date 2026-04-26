import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  // Set ticker = NULL for any row whose ticker is actually an asset-type code.
  console.log("Finding bad-ticker rows…");
  const before = await db.execute(sql`
    SELECT id, asset_description, ticker, asset_type
    FROM stock_transactions
    WHERE ticker IN ('CT','OI','BA','DB','OT','FU','PD','FA','HE')
       OR asset_description ~* '\\[(CT|OI|BA|DB|OT|FU|PD|FA|HE)\\]'
       AND ticker = REGEXP_REPLACE(asset_description, '.*\\[([A-Z]{2})\\].*', '\\1')
  `);
  for (const r of before.rows) console.log("  bad:", JSON.stringify(r));

  const fixed = await db.execute(sql`
    UPDATE stock_transactions
    SET ticker = NULL,
        asset_type = CASE
          WHEN asset_description ~ '\\[CT\\]' THEN 'Cryptocurrency'
          WHEN asset_description ~ '\\[PS\\]' THEN 'Stock'
          WHEN asset_description ~ '\\[OI\\]' THEN 'Other'
          WHEN asset_description ~ '\\[RE\\]' THEN 'Other'
          ELSE asset_type
        END
    WHERE ticker IN ('CT','OI','BA','DB','OT','FU','PD','FA','HE')
  `);
  console.log("Fixed:", fixed.rowCount);

  // Also sweep up rows where description mentions [CT] but asset_type wasn't set right.
  const cryptoFixed = await db.execute(sql`
    UPDATE stock_transactions
    SET asset_type = 'Cryptocurrency'
    WHERE asset_description ~ '\\[CT\\]' AND asset_type != 'Cryptocurrency'
  `);
  console.log("Crypto reclassified:", cryptoFixed.rowCount);

  process.exit(0);
}
main();
