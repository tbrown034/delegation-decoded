// Marks sync_log rows still in 'running' status after 6 hours as 'failed'.
// Crashed jobs (OOM, network drops, runner timeouts) leave these rows behind
// and they make the health report look worse than reality.
//
// Read-only by default. Pass --apply to actually write.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const apply = process.argv.includes("--apply");

  const stale = await db.execute(sql`
    SELECT id, source, entity_type, started_at,
      EXTRACT(EPOCH FROM (now() - started_at)) / 3600.0 AS age_hours
    FROM sync_log
    WHERE status = 'running' AND started_at < now() - interval '6 hours'
    ORDER BY started_at
  `);

  if (stale.rows.length === 0) {
    console.log("No stuck runs.");
    return;
  }

  console.log(`Found ${stale.rows.length} stuck runs:`);
  for (const r of stale.rows as Array<Record<string, unknown>>) {
    const age = Number(r.age_hours).toFixed(0);
    console.log(`  id=${r.id} ${r.source}/${r.entity_type} stuck ${age}h (started ${r.started_at})`);
  }

  if (!apply) {
    console.log("\n(read-only — pass --apply to mark these as failed)");
    return;
  }

  await db.execute(sql`
    UPDATE sync_log
    SET status = 'failed',
        completed_at = now(),
        error_message = COALESCE(error_message, 'marked failed by cleanup-stuck-runs: never completed')
    WHERE status = 'running' AND started_at < now() - interval '6 hours'
  `);
  console.log(`\nMarked ${stale.rows.length} rows as failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
