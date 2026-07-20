import { createHash } from "crypto";
import { db } from "./db";
import { sql } from "drizzle-orm";

// Postgres-backed rate limiting and answer caching for /api/ask.
// Neon is already the only stateful dependency, so counters and the answer
// cache live there instead of adding Redis. Fixed windows are accurate
// enough at this traffic level; the global daily cap is the spend backstop.

const IP_HOURLY_LIMIT = 20;
const LOCATE_IP_HOURLY_LIMIT = 30;
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
  // Seconds until the window resets, for a Retry-After header and concrete
  // "try again in N minutes" copy instead of "in a bit".
  retryAfterSeconds?: number;
}

function secondsToNextHour(): number {
  const now = new Date();
  return 3600 - (now.getMinutes() * 60 + now.getSeconds());
}

function secondsToUtcMidnight(): number {
  const now = new Date();
  return (
    86400 -
    (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds())
  );
}

// Per-IP limits and the global model budget are separate on purpose: an IP
// that is already blocked (or a request that fails validation upstream) must
// never advance the global counter, or a single hostile IP could burn the
// day's budget for everyone without spending a model token.

async function bumpCounter(
  bucket: string,
  window: "hour" | "day"
): Promise<number> {
  const rows = (await db.execute(sql`
    INSERT INTO ask_rate_limits (bucket, window_start, count)
    VALUES (${bucket}, date_trunc(${window}, now()), 1)
    ON CONFLICT (bucket, window_start)
    DO UPDATE SET count = ask_rate_limits.count + 1
    RETURNING count
  `)) as unknown as { rows: { count: number }[] };
  return Number(rows.rows?.[0]?.count ?? 0);
}

// First gate, hit on every request before any other work.
export async function checkIpLimit(
  ip: string,
  kind: "ask" | "locate" = "ask"
): Promise<RateDecision> {
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

  const prefix = kind === "locate" ? "loc" : "ip";
  const limit = kind === "locate" ? LOCATE_IP_HOURLY_LIMIT : IP_HOURLY_LIMIT;
  const count = await bumpCounter(`${prefix}:${hashIp(ip)}`, "hour");
  if (count > limit) {
    return {
      allowed: false,
      reason:
        kind === "locate"
          ? "Too many location lookups from your connection this hour."
          : `That's ${limit} questions in an hour — the limit that keeps this free.`,
      retryAfterSeconds: secondsToNextHour(),
    };
  }
  return { allowed: true };
}

// Second gate, hit only when a request is actually about to spend model
// tokens — after validation, the IP check, and a cache miss.
export async function countModelCall(): Promise<RateDecision> {
  const count = await bumpCounter("global", "day");
  if (count > GLOBAL_DAILY_LIMIT) {
    return {
      allowed: false,
      reason:
        "The assistant has hit its daily budget. It resets at midnight UTC — the rest of the site is unaffected.",
      retryAfterSeconds: secondsToUtcMidnight(),
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
