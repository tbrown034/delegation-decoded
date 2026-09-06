import "./lib/env";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  const [limits, cache, log] = await Promise.all([
    db.execute(sql`
      WITH deleted AS (
        DELETE FROM ask_rate_limits
        WHERE window_start < now() - interval '2 days'
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted
    `),
    db.execute(sql`
      WITH deleted AS (
        DELETE FROM ask_cache
        WHERE created_at < now() - interval '7 days'
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted
    `),
    // The 90-day audit retention stated on /about must not depend on request
    // traffic reaching the in-process scheduler.
    db.execute(sql`
      WITH deleted AS (
        DELETE FROM ask_log
        WHERE created_at < now() - interval '90 days'
        RETURNING 1
      )
      SELECT count(*)::int AS count FROM deleted
    `),
  ]);
  const limitCount = Number(
    (limits.rows[0] as { count?: number } | undefined)?.count ?? 0
  );
  const cacheCount = Number(
    (cache.rows[0] as { count?: number } | undefined)?.count ?? 0
  );
  const logCount = Number(
    (log.rows[0] as { count?: number } | undefined)?.count ?? 0
  );
  console.log(
    `Deleted ${limitCount} expired rate windows, ${cacheCount} expired answer-cache rows and ${logCount} audit rows older than 90 days.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
