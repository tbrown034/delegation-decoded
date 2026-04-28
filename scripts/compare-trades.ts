import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // Top traders in our window — these will be the comparison candidates
  const top = await sql`
    SELECT m.bioguide_id, m.full_name, m.chamber, m.state_code,
           COUNT(*)::int AS trades,
           MIN(t.tx_date) AS first_tx,
           MAX(t.tx_date) AS last_tx,
           COUNT(DISTINCT t.filing_id)::int AS filings
    FROM stock_transactions t
    JOIN members m ON m.bioguide_id = t.bioguide_id
    WHERE t.tx_date >= '2025-12-01' AND t.tx_date <= '2026-04-30'
    GROUP BY m.bioguide_id, m.full_name, m.chamber, m.state_code
    ORDER BY trades DESC
    LIMIT 15
  `;
  console.log("\n=== Our top 15 traders, Dec 2025 – Apr 2026 ===");
  console.table(top);

  // Coverage: how many active members have ANY trade in our window
  const window = await sql`
    SELECT m.chamber,
           COUNT(DISTINCT m.bioguide_id) FILTER (WHERE m.in_office) AS in_office,
           COUNT(DISTINCT t.bioguide_id) FILTER (WHERE m.in_office) AS traders_in_window
    FROM members m
    LEFT JOIN stock_transactions t
      ON t.bioguide_id = m.bioguide_id
     AND t.tx_date >= '2025-12-01' AND t.tx_date <= '2026-04-30'
    GROUP BY m.chamber
  `;
  console.log("\n=== Window coverage (Dec 2025 – Apr 2026) ===");
  console.table(window);

  // What share of trades fall in the active window
  const total = await sql`SELECT COUNT(*)::int AS n FROM stock_transactions`;
  const inWindow = await sql`
    SELECT COUNT(*)::int AS n FROM stock_transactions
    WHERE tx_date >= '2025-12-01' AND tx_date <= '2026-04-30'
  `;
  console.log(`\nIn-window trades: ${inWindow[0].n} / ${total[0].n} (${((inWindow[0].n / total[0].n) * 100).toFixed(1)}%)`);
}
main().catch(e => { console.error(e); process.exit(1); });
