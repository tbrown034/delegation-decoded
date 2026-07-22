import "./lib/env";
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  const [limits, cache] = await Promise.all([
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
  ]);
  const limitCount = Number(
    (limits.rows[0] as { count?: number } | undefined)?.count ?? 0
  );
  const cacheCount = Number(
    (cache.rows[0] as { count?: number } | undefined)?.count ?? 0
  );
  console.log(
    `Deleted ${limitCount} expired rate windows and ${cacheCount} expired answer-cache rows.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
