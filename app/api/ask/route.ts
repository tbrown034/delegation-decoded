import { NextRequest } from "next/server";
import {
  AskError,
  AskProviderUnavailableError,
  runAsk,
  type AskHistoryEntry,
  type AskResult,
} from "@/lib/ask-engine";
import {
  checkIpLimit,
  countProviderAttempt,
  createSafetyIdentifier,
  getCachedAnswer,
  scheduleAskDataCleanup,
  setCachedAnswer,
} from "@/lib/ask-limits";
import type { AskScope } from "@/lib/ask-tools";
import { getMemberByBioguideId, getMemberTerms } from "@/lib/queries";
import { resolveMemberSeat } from "@/lib/elections/member-seat";
import {
  clientIp,
  readLimitedJson,
  rejectCrossSite,
} from "@/lib/request-guards";
import { STATE_BY_CODE } from "@/lib/states";

export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
// Raised from 2,048 when follow-up history (up to two truncated prior
// exchanges) joined the request body.
const MAX_BODY_BYTES = 8_192;
const MAX_HISTORY_ENTRIES = 2;
const MAX_HISTORY_QUESTION_CHARS = 400;
const MAX_HISTORY_ANSWER_CHARS = 1_200;

function jsonError(message: string, status: number, retryAfterSeconds?: number) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        ...NO_STORE,
        ...(retryAfterSeconds
          ? { "Retry-After": String(retryAfterSeconds) }
          : {}),
      },
    }
  );
}

async function parseScope(raw: Record<string, unknown>): Promise<AskScope | null> {
  const requested =
    raw.scope && typeof raw.scope === "object"
      ? (raw.scope as Record<string, unknown>)
      : raw;

  if (requested.type === "member") {
    const bioguideId =
      typeof requested.bioguideId === "string"
        ? requested.bioguideId.trim().toUpperCase()
        : "";
    if (!/^[A-Z][0-9]{6}$/.test(bioguideId)) return null;
    const member = await getMemberByBioguideId(bioguideId);
    if (!member) return null;
    const seat = resolveMemberSeat(member, await getMemberTerms(bioguideId));
    return seat
      ? { type: "member", stateCode: member.stateCode, bioguideId, seat }
      : null;
  }

  const stateCode =
    typeof requested.stateCode === "string"
      ? requested.stateCode.trim().toUpperCase()
      : "";
  const state = STATE_BY_CODE[stateCode];
  if (!state) return null;
  let district: number | null = null;
  if (requested.district != null) {
    if (
      typeof requested.district !== "number" ||
      !Number.isInteger(requested.district) ||
      requested.district < 0 ||
      requested.district > state.numDistricts
    ) {
      return null;
    }
    district = requested.district;
  }
  return { type: "state", stateCode, district };
}

const stripControl = (s: string) =>
  s.replace(/[\u0000-\u001f\u007f]/g, " ");

// Prior exchanges are untrusted client input: bound the count, truncate hard,
// and strip control characters. Anything malformed is dropped, not rejected —
// a follow-up should degrade to a fresh question, never to an error.
function parseHistory(value: unknown): AskHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: AskHistoryEntry[] = [];
  for (const item of value.slice(-MAX_HISTORY_ENTRIES)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.question !== "string" || typeof record.answer !== "string") {
      continue;
    }
    const question = stripControl(record.question)
      .trim()
      .slice(0, MAX_HISTORY_QUESTION_CHARS);
    const answer = stripControl(record.answer)
      .trim()
      .slice(0, MAX_HISTORY_ANSWER_CHARS);
    if (question && answer) entries.push({ question, answer });
  }
  return entries;
}

function resultPayload(result: AskResult) {
  return {
    answer: result.answer,
    citations: result.citations,
    trace: result.trace,
    provider: result.provider,
    model: result.model,
    fallbackUsed: result.fallbackUsed,
  };
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;

  const parsed = await readLimitedJson(request, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return jsonError(
      parsed.reason === "too_large" ? "Request body is too large." : "Invalid JSON body.",
      parsed.reason === "too_large" ? 413 : 400
    );
  }
  const body = parsed.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError("Invalid JSON body.", 400);
  }
  const raw = body as Record<string, unknown>;
  const question =
    typeof raw.question === "string" ? stripControl(raw.question).trim() : "";
  if (question.length < 3 || question.length > 400) {
    return jsonError("Question must be between 3 and 400 characters.", 400);
  }

  const scope = await parseScope(raw);
  if (!scope) {
    return jsonError("Choose a valid state or lawmaker page scope first.", 400);
  }
  const history = parseHistory(raw.history);

  const ip = clientIp(request);
  const rate = await checkIpLimit(ip, "ask");
  if (!rate.allowed) {
    return jsonError(rate.reason ?? "Question limit reached.", 429, rate.retryAfterSeconds);
  }
  scheduleAskDataCleanup();

  // Follow-ups are context-dependent, so they bypass the shared answer cache
  // in both directions: a history-shaped answer must not be served to (or
  // written for) someone who asked the same words fresh.
  const cached = history.length === 0 ? await getCachedAnswer(question, scope) : null;

  const wantsStream =
    request.headers.get("accept")?.includes("text/event-stream") === true;

  const runOptions = {
    signal: request.signal,
    safetyIdentifier: createSafetyIdentifier(ip),
    history,
    beforeProvider: async (provider: "anthropic" | "openai") => {
      const budget = await countProviderAttempt(provider);
      if (!budget.allowed) {
        if (budget.budgetScope === "provider") {
          throw new AskProviderUnavailableError(provider);
        }
        throw new AskError(budget.reason ?? "Daily provider budget reached.", 429);
      }
    },
  };

  const cacheResult = async (result: AskResult) => {
    if (history.length > 0) return;
    try {
      await setCachedAnswer(
        question,
        scope,
        result.answer,
        result.trace,
        result.provider,
        result.model,
        result.fallbackUsed,
        result.citations
      );
    } catch {
      // A cache write must never suppress a verified answer.
    }
  };

  if (wantsStream) {
    // SSE: verified progress events while the tool loop runs, then the exact
    // JSON payload the non-streaming path returns, as a terminal event.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch {
            // Reader hung up; the engine's abort signal handles the rest.
          }
        };
        try {
          if (cached) {
            send("result", { ...cached, cached: true });
            return;
          }
          const result = await runAsk(question, scope, {
            ...runOptions,
            onEvent: (event) => send("progress", event),
          });
          await cacheResult(result);
          send("result", resultPayload(result));
        } catch (error) {
          if (error instanceof AskError) {
            send("error", { error: error.message, status: error.status });
          } else {
            console.error("Unhandled ask stream failure", error);
            send("error", {
              error: "The lookup failed safely. The records pages still work.",
              status: 500,
            });
          }
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed by a client disconnect.
          }
        }
      },
    });
    return new Response(stream, {
      headers: {
        ...NO_STORE,
        "Content-Type": "text/event-stream",
        "X-Accel-Buffering": "no",
      },
    });
  }

  if (cached) {
    return Response.json({ ...cached, cached: true }, { headers: NO_STORE });
  }

  try {
    const result = await runAsk(question, scope, runOptions);
    await cacheResult(result);
    return Response.json(resultPayload(result), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AskError) {
      return jsonError(error.message, error.status);
    }
    console.error("Unhandled ask route failure", error);
    return jsonError("The lookup failed safely. The records pages still work.", 500);
  }
}
