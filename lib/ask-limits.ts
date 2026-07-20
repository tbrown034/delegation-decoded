import { createHash } from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";

// Postgres-backed rate limiting and answer caching for /api/ask.
// Neon is already the only stateful dependency, so counters and the answer
// cache live there instead of adding Redis. Fixed windows are accurate
// enough at this traffic level; the global daily cap is the spend backstop.

const IP_HOURLY_LIMIT = 15;
const GLOBAL_DAILY_LIMIT = 400;
const CACHE_TTL_HOURS = 24;

// IPs are hashed before storage — the site promises addresses and identities
// never persist, so rate buckets must not contain raw IPs.
function hashIp(ip: string): string {
  return createHash("sha256")
    .update(`dd-ask:${ip}`)
    .digest("hex")
    .slice(0, 24);
}

export interface RateDecision {
  allowed: boolean;
  reason?: string;
}

export async function checkAndCountRequest(ip: string): Promise<RateDecision> {
  const ipBucket = `ip:${hashIp(ip)}`;

  // Opportunistic cleanup: stale windows and expired cache rows go on ~2% of
  // requests, so no cron is needed for these two small tables.
  if (Math.random() < 0.02) {
    db.execute(
      sql`DELETE FROM ask_rate_limits WHERE window_start < now() - interval '2 days'`
    ).catch(() => {});
    db.execute(
      sql`DELETE FROM ask_cache WHERE created_at < now() - interval '7 days'`
    ).catch(() => {});
  }

  const rows = (await db.execute(sql`
    WITH ip_hit AS (
      INSERT INTO ask_rate_limits (bucket, window_start, count)
      VALUES (${ipBucket}, date_trunc('hour', now()), 1)
      ON CONFLICT (bucket, window_start)
      DO UPDATE SET count = ask_rate_limits.count + 1
      RETURNING count
    ),
    global_hit AS (
      INSERT INTO ask_rate_limits (bucket, window_start, count)
      VALUES ('global', date_trunc('day', now()), 1)
      ON CONFLICT (bucket, window_start)
      DO UPDATE SET count = ask_rate_limits.count + 1
      RETURNING count
    )
    SELECT (SELECT count FROM ip_hit) AS ip_count,
           (SELECT count FROM global_hit) AS global_count
  `)) as unknown as { rows: { ip_count: number; global_count: number }[] };

  const row = rows.rows?.[0];
  if (!row) return { allowed: true };

  if (Number(row.global_count) > GLOBAL_DAILY_LIMIT) {
    return {
      allowed: false,
      reason:
        "The assistant has hit its daily budget. It resets at midnight UTC — the rest of the site is unaffected.",
    };
  }
  if (Number(row.ip_count) > IP_HOURLY_LIMIT) {
    return {
      allowed: false,
      reason: `That's ${IP_HOURLY_LIMIT} questions in an hour — the limit that keeps this free. Try again in a bit.`,
    };
  }
  return { allowed: true };
}

function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface CachedAnswer {
  answer: string;
  trace: unknown;
}

export async function getCachedAnswer(
  question: string,
  stateCode: string,
  district: number | null
): Promise<CachedAnswer | null> {
  const rows = (await db.execute(sql`
    SELECT answer, trace FROM ask_cache
    WHERE question_norm = ${normalizeQuestion(question)}
      AND state_code = ${stateCode}
      AND district = ${district ?? -1}
      AND created_at > now() - interval '${sql.raw(String(CACHE_TTL_HOURS))} hours'
    LIMIT 1
  `)) as unknown as { rows: { answer: string; trace: unknown }[] };
  return rows.rows?.[0] ?? null;
}

export async function setCachedAnswer(
  question: string,
  stateCode: string,
  district: number | null,
  answer: string,
  trace: unknown
): Promise<void> {
  await db.execute(sql`
    INSERT INTO ask_cache (question_norm, state_code, district, answer, trace, created_at)
    VALUES (${normalizeQuestion(question)}, ${stateCode}, ${district ?? -1}, ${answer}, ${JSON.stringify(trace)}, now())
    ON CONFLICT (question_norm, state_code, district)
    DO UPDATE SET answer = EXCLUDED.answer, trace = EXCLUDED.trace, created_at = now()
  `);
}
