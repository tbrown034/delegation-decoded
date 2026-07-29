// Per-question audit log for /ask. One row per request that reached the
// engine, written fire-and-forget: a logging failure must never delay or
// suppress a reader's answer. The row makes any served answer reproducible —
// question, scope, tool trace, provider, cost, and how the request ended —
// which is the accountability layer the citations UI stands on.

import { sql } from "drizzle-orm";
import { db } from "./db";
import type { AskProvider, AskStatus } from "./ask-engine";
import type { AskScope, ToolTraceEntry } from "./ask-tools";

export type AskOutcome = AskStatus | "error";

export type AskErrorClass =
  | "rate_limited"
  | "budget_exhausted"
  | "provider_unavailable"
  | "refusal"
  | "flagged_input"
  | "invalid_answer"
  | "timeout"
  | "cancelled"
  | "scope_unavailable"
  | "internal";

export interface AskLogEntry {
  ipHash: string | null;
  question: string;
  scope: AskScope;
  historyTurns: number;
  outcome: AskOutcome;
  errorClass?: AskErrorClass;
  httpStatus?: number;
  cacheHit?: boolean;
  provider?: AskProvider;
  model?: string;
  fallbackUsed?: boolean;
  refusalCategory?: string;
  latencyMs: number;
  usage?: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens: number;
    outputTokens: number;
  };
  trace?: ToolTraceEntry[];
  citationCount?: number;
  citationCoverage?: number | null;
  answer?: string;
  promptVersion?: string;
}

// AskError HTTP statuses → a stable class the /health panel can group by.
export function classifyAskError(status: number): AskErrorClass {
  switch (status) {
    case 429:
      return "rate_limited";
    case 422:
      return "refusal";
    case 499:
      return "cancelled";
    case 502:
      return "invalid_answer";
    case 503:
      return "provider_unavailable";
    case 504:
      return "timeout";
    case 404:
      return "scope_unavailable";
    default:
      return "internal";
  }
}

export interface AskLogRow {
  id: number;
  createdAt: Date;
  outcome: string;
  errorClass: string | null;
  cacheHit: boolean;
  provider: string | null;
  latencyMs: number | null;
  outputTokens: number | null;
  citationCount: number | null;
  citationCoverage: number | null;
  scopeType: string;
  stateCode: string | null;
  question: string;
  answer: string | null;
  toolNames: string[];
}

// Newest-first browse feed for the private /admin/ask-log page.
export async function recentAskLog(limit = 100): Promise<AskLogRow[]> {
  const result = (await db.execute(sql`
    SELECT id, created_at, outcome, error_class, cache_hit, provider,
           latency_ms, output_tokens, citation_count, citation_coverage,
           scope_type, state_code, question, answer, trace
    FROM ask_log
    ORDER BY id DESC
    LIMIT ${limit}
  `)) as unknown as { rows: Record<string, unknown>[] };
  return result.rows.map((r) => ({
    id: Number(r.id),
    createdAt: new Date(r.created_at as string),
    outcome: String(r.outcome),
    errorClass: (r.error_class as string) ?? null,
    cacheHit: r.cache_hit === true,
    provider: (r.provider as string) ?? null,
    latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
    outputTokens: r.output_tokens == null ? null : Number(r.output_tokens),
    citationCount: r.citation_count == null ? null : Number(r.citation_count),
    citationCoverage:
      r.citation_coverage == null ? null : Number(r.citation_coverage),
    scopeType: String(r.scope_type),
    stateCode: (r.state_code as string) ?? null,
    question: String(r.question),
    answer: (r.answer as string) ?? null,
    toolNames: Array.isArray(r.trace)
      ? [
          ...new Set(
            (r.trace as { tool?: unknown }[]).map((t) => String(t.tool ?? ""))
          ),
        ].filter(Boolean)
      : [],
  }));
}

export function logAsk(entry: AskLogEntry): void {
  const scope = entry.scope;
  const stateCode = scope.type === "national" ? null : scope.stateCode;
  const district =
    scope.type === "state" ? scope.district : scope.type === "member" ? null : null;
  const bioguideId = scope.type === "member" ? scope.bioguideId : null;

  db.execute(sql`
    INSERT INTO ask_log (
      ip_hash, question, scope_type, state_code, district, bioguide_id,
      history_turns, outcome, error_class, http_status, cache_hit,
      provider, model, fallback_used, refusal_category, latency_ms,
      input_tokens, cached_input_tokens, cache_write_input_tokens,
      output_tokens, tool_calls, trace, citation_count, citation_coverage,
      answer, prompt_version
    ) VALUES (
      ${entry.ipHash}, ${entry.question}, ${scope.type}, ${stateCode},
      ${district ?? null}, ${bioguideId}, ${entry.historyTurns},
      ${entry.outcome}, ${entry.errorClass ?? null}, ${entry.httpStatus ?? null},
      ${entry.cacheHit ?? false}, ${entry.provider ?? null}, ${entry.model ?? null},
      ${entry.fallbackUsed ?? false}, ${entry.refusalCategory ?? null},
      ${entry.latencyMs}, ${entry.usage?.inputTokens ?? null},
      ${entry.usage?.cachedInputTokens ?? null},
      ${entry.usage?.cacheWriteInputTokens ?? null},
      ${entry.usage?.outputTokens ?? null},
      ${entry.trace ? entry.trace.length : null},
      ${entry.trace ? JSON.stringify(entry.trace) : null},
      ${entry.citationCount ?? null}, ${entry.citationCoverage ?? null},
      ${entry.answer ?? null}, ${entry.promptVersion ?? null}
    )
  `).catch((error) => {
    console.error("ask_log write failed", error);
  });
}
