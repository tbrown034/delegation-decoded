import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { runAsk, AskError, DEFAULT_ASK_MODEL } from "@/lib/ask-engine";
import {
  checkIpLimit,
  countModelCall,
  getCachedAnswer,
  setCachedAnswer,
} from "@/lib/ask-limits";
import { clientIp, rejectCrossSite } from "@/lib/request-guards";
import { STATE_BY_CODE } from "@/lib/states";

export const maxDuration = 60;

// Order of gates matters: validation and the per-IP limit run before any
// database or model work, and the global model budget is only touched once a
// request has passed everything else and missed the cache. A flood of junk
// can therefore never exhaust the day's budget or hammer Neon's cache table.

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSite(request);
  if (crossSite) return crossSite;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  // Strip control characters; the model gets this text verbatim.
  const question =
    typeof raw.question === "string"
      ? raw.question.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
      : "";
  const stateCode =
    typeof raw.stateCode === "string" ? raw.stateCode.trim().toUpperCase() : "";

  if (question.length < 3 || question.length > 400) {
    return Response.json(
      { error: "Question must be between 3 and 400 characters." },
      { status: 400 }
    );
  }

  const state = STATE_BY_CODE[stateCode];
  if (!state) {
    return Response.json(
      { error: "Set a location first so answers stay grounded." },
      { status: 400 }
    );
  }

  // District must be a real district of the chosen state, or absent. The -1
  // sentinel is reserved for "state only" cache rows and never client-visible.
  let district: number | null = null;
  if (raw.district != null) {
    if (
      typeof raw.district !== "number" ||
      !Number.isInteger(raw.district) ||
      raw.district < 0 ||
      raw.district > state.numDistricts
    ) {
      return Response.json(
        { error: `That district does not exist in ${state.name}.` },
        { status: 400 }
      );
    }
    district = raw.district;
  }

  const rate = await checkIpLimit(clientIp(request), "ask");
  if (!rate.allowed) {
    return Response.json({ error: rate.reason }, { status: 429 });
  }

  // Cache: repeat questions (suggestion chips especially) cost nothing and
  // do not count against the global model budget.
  const cached = await getCachedAnswer(question, stateCode, district);
  if (cached) {
    return Response.json({
      answer: cached.answer,
      trace: cached.trace,
      cached: true,
    });
  }

  const budget = await countModelCall();
  if (!budget.allowed) {
    return Response.json({ error: budget.reason }, { status: 429 });
  }

  try {
    const result = await runAsk(question, stateCode, district, DEFAULT_ASK_MODEL);
    // Cache failures must not fail the answer.
    try {
      await setCachedAnswer(
        question,
        stateCode,
        district,
        result.answer,
        result.trace
      );
    } catch {
      // Answer still returns; the miss just costs one extra model call later.
    }
    return Response.json({ answer: result.answer, trace: result.trace });
  } catch (err) {
    if (err instanceof AskError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof Anthropic.APIError) {
      const friendly =
        err instanceof Anthropic.RateLimitError || err.status === 529
          ? "The assistant is briefly over capacity. Try again in a moment."
          : "The assistant hit an upstream error. Try again.";
      return Response.json({ error: friendly }, { status: 502 });
    }
    throw err;
  }
}
