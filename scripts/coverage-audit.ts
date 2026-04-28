// One-off coverage audit. Prints chamber-level coverage across every data source.
// Used to inform what the unified health-check should track.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

type Row = Record<string, unknown>;

async function countDistinctMembers(table: string, alias: string) {
  const rows = (await sql`
    SELECT m.chamber, COUNT(DISTINCT t.bioguide_id)::int AS n
    FROM members m
    JOIN ${sql.unsafe(table)} t ON t.bioguide_id = m.bioguide_id
    WHERE m.in_office = true
    GROUP BY m.chamber
    ORDER BY m.chamber
  `) as { chamber: string; n: number }[];
  const out: Record<string, number> = { source: alias as unknown as number };
  for (const r of rows) out[r.chamber] = r.n;
  return out;
}

async function main() {
  const chambers = (await sql`
    SELECT chamber, COUNT(*)::int AS n
    FROM members
    WHERE in_office = true
    GROUP BY chamber
    ORDER BY chamber
  `) as { chamber: string; n: number }[];

  console.log("\n=== Active members by chamber ===");
  console.table(chambers);

  const sources = [
    ["bill_sponsorships", "bills"],
    ["vote_positions", "votes"],
    ["campaign_finance", "finance"],
    ["press_releases", "press"],
    ["disclosure_filings", "filings"],
    ["stock_transactions", "trades"],
    ["committee_assignments", "committees"],
  ] as const;

  const matrix: Row[] = [];
  for (const [table, alias] of sources) {
    matrix.push(await countDistinctMembers(table, alias));
  }
  console.log("\n=== Members covered per source, by chamber ===");
  console.table(matrix);

  const recent = (await sql`
    SELECT source, entity_type, status, started_at, completed_at, records_count, error_message
    FROM sync_log
    WHERE id IN (
      SELECT MAX(id) FROM sync_log GROUP BY source, entity_type
    )
    ORDER BY started_at DESC
  `) as Row[];
  console.log("\n=== Latest sync_log per (source, entity_type) ===");
  console.table(recent);

  const failed = (await sql`
    SELECT source, entity_type, status, started_at, error_message
    FROM sync_log
    WHERE status = 'failed' AND started_at > now() - interval '14 days'
    ORDER BY started_at DESC
    LIMIT 25
  `) as Row[];
  console.log("\n=== Recent failed runs (last 14 days) ===");
  console.table(failed);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
