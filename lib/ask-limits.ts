import { createHmac } from "crypto";
import { sql } from "drizzle-orm";
import { ASK_PROMPT_VERSION, type AskProvider } from "./ask-engine";
import type { Citation } from "./ask-citations";
import type { AskScope } from "./ask-tools";
import { db } from "./db";

const IP_HOURLY_LIMIT = 20;
const LOCATE_IP_HOURLY_LIMIT = 30;
const SEARCH_IP_HOURLY_LIMIT = 60;
const GLOBAL_DAILY_PROVIDER_ATTEMPT_LIMIT = 500;
const PROVIDER_DAILY_ATTEMPT_LIMIT = 350;
const CACHE_TTL_HOURS = 24;

function privacySecret() {
  return (
    process.env.ASK_RATE_LIMIT_SECRET ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    "delegation-decoded-local-development"
  );
}

function keyedHash(value: string, length = 32): string {
  return createHmac("sha256", privacySecret()).update(value).digest("hex").slice(0, length);
}

function hashIp(ip: string): string {
  return keyedHash(`dd-ask-ip:${ip}`, 24);
}

export function createSafetyIdentifier(ip: string): string {
  return keyedHash(`dd-openai-safety:${ip}`, 32);
}

export interface RateDecision {
  allowed: boolean;
  reason?: string;
  retryAfterSeconds?: number;
  budgetScope?: "global" | "provider";
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

export async function checkIpLimit(
  ip: string,
  kind: "ask" | "locate" | "search" = "ask"
): Promise<RateDecision> {
  const prefix = kind === "locate" ? "loc" : kind === "search" ? "search" : "ip";
  const limit =
    kind === "locate"
      ? LOCATE_IP_HOURLY_LIMIT
      : kind === "search"
        ? SEARCH_IP_HOURLY_LIMIT
        : IP_HOURLY_LIMIT;
  const count = await bumpCounter(`${prefix}:${hashIp(ip)}`, "hour");
  if (count > limit) {
    return {
      allowed: false,
      reason:
        kind === "locate"
          ? "Too many location lookups from your connection this hour."
          : kind === "search"
            ? "Too many searches from your connection this hour."
          : `That is ${limit} questions in an hour — the limit that keeps this public.`,
      retryAfterSeconds: secondsToNextHour(),
    };
  }
  return { allowed: true };
}

export async function countProviderAttempt(
  provider: AskProvider
): Promise<RateDecision> {
  const [globalCount, providerCount] = await Promise.all([
    bumpCounter("global-provider-attempts", "day"),
    bumpCounter(`provider:${provider}`, "day"),
  ]);
  if (globalCount > GLOBAL_DAILY_PROVIDER_ATTEMPT_LIMIT) {
    return {
      allowed: false,
      reason:
        "The assistant has hit its daily provider budget. It resets at midnight UTC; every records page remains available.",
      retryAfterSeconds: secondsToUtcMidnight(),
      budgetScope: "global",
    };
  }
  if (providerCount > PROVIDER_DAILY_ATTEMPT_LIMIT) {
    return {
      allowed: false,
      reason: `${provider} has reached its daily attempt limit.`,
      retryAfterSeconds: secondsToUtcMidnight(),
      budgetScope: "provider",
    };
  }
  return { allowed: true };
}

function normalizedQuestion(question: string) {
  return question.toLowerCase().replace(/\s+/g, " ").trim();
}

function cacheIdentity(question: string, scope: AskScope) {
  const scopeKey =
    scope.type === "member"
      ? `member:${scope.bioguideId}:seat:${scope.seat.office === "H" ? `H${scope.seat.district}` : `S${scope.seat.senateClass}`}`
      : scope.type === "state"
        ? `state:${scope.stateCode}:district:${scope.district ?? "all"}`
        : "national";
  return keyedHash(
    `dd-ask-cache:${ASK_PROMPT_VERSION}|${scopeKey}|${normalizedQuestion(question)}`,
    64
  );
}

export interface CachedAnswer {
  answer: string;
  citations: Citation[];
  trace: unknown[];
  provider?: AskProvider;
  model?: string;
  fallbackUsed?: boolean;
}

function cacheDistrict(scope: AskScope) {
  return scope.type === "state" ? scope.district ?? -1 : -1;
}

function parseCachePayload(answer: string, value: unknown): CachedAnswer {
  if (Array.isArray(value)) return { answer, citations: [], trace: value };
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      answer,
      citations: Array.isArray(record.citations)
        ? (record.citations as Citation[])
        : [],
      trace: Array.isArray(record.trace) ? record.trace : [],
      provider:
        record.provider === "anthropic" || record.provider === "openai"
          ? record.provider
          : undefined,
      model: typeof record.model === "string" ? record.model : undefined,
      fallbackUsed: record.fallbackUsed === true,
    };
  }
  return { answer, citations: [], trace: [] };
}

export async function getCachedAnswer(
  question: string,
  scope: AskScope
): Promise<CachedAnswer | null> {
  // National answers vary too much to share and the cache row is keyed by a
  // concrete state_code; skip the cache entirely, as follow-ups already do.
  if (scope.type === "national") return null;
  const rows = (await db.execute(sql`
    SELECT answer, trace FROM ask_cache
    WHERE question_norm = ${cacheIdentity(question, scope)}
      AND state_code = ${scope.stateCode}
      AND district = ${cacheDistrict(scope)}
      AND created_at > now() - interval '${sql.raw(String(CACHE_TTL_HOURS))} hours'
    LIMIT 1
  `)) as unknown as { rows: { answer: string; trace: unknown }[] };
  const row = rows.rows?.[0];
  return row ? parseCachePayload(row.answer, row.trace) : null;
}

export async function setCachedAnswer(
  question: string,
  scope: AskScope,
  answer: string,
  trace: unknown,
  provider: AskProvider,
  model: string,
  fallbackUsed: boolean,
  citations: Citation[] = []
): Promise<void> {
  if (scope.type === "national") return;
  const payload = JSON.stringify({ trace, provider, model, fallbackUsed, citations });
  await db.execute(sql`
    INSERT INTO ask_cache (question_norm, state_code, district, answer, trace, created_at)
    VALUES (${cacheIdentity(question, scope)}, ${scope.stateCode}, ${cacheDistrict(scope)}, ${answer}, ${payload}, now())
    ON CONFLICT (question_norm, state_code, district)
    DO UPDATE SET answer = EXCLUDED.answer, trace = EXCLUDED.trace, created_at = now()
  `);
}

let lastCleanupAt = 0;

export function scheduleAskDataCleanup() {
  const now = Date.now();
  if (now - lastCleanupAt < 60 * 60 * 1000) return;
  lastCleanupAt = now;
  Promise.allSettled([
    db.execute(sql`DELETE FROM ask_rate_limits WHERE window_start < now() - interval '2 days'`),
    db.execute(sql`DELETE FROM ask_cache WHERE created_at < now() - interval '7 days'`),
  ]).catch(() => {});
}
