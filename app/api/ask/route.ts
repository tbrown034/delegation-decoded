import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { runAsk, AskError, DEFAULT_ASK_MODEL } from "@/lib/ask-engine";
import {
  checkAndCountRequest,
  getCachedAnswer,
  setCachedAnswer,
} from "@/lib/ask-limits";

export const maxDuration = 60;

interface AskRequest {
  question?: string;
  stateCode?: string;
  district?: number | null;
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

export async function POST(request: NextRequest) {
  let body: AskRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = body.question?.trim() ?? "";
  const stateCode = body.stateCode?.trim().toUpperCase() ?? "";
  const district =
    typeof body.district === "number" && Number.isFinite(body.district)
      ? body.district
      : null;

  if (!question || question.length > 400) {
    return Response.json(
      { error: "Question must be between 1 and 400 characters." },
      { status: 400 }
    );
  }
  if (!/^[A-Z]{2}$/.test(stateCode)) {
    return Response.json(
      { error: "Set a location first so answers stay grounded." },
      { status: 400 }
    );
  }

  // Cache first: repeat questions (suggestion chips especially) cost nothing.
  const cached = await getCachedAnswer(question, stateCode, district);
  if (cached) {
    return Response.json({
      answer: cached.answer,
      trace: cached.trace,
      cached: true,
    });
  }

  const rate = await checkAndCountRequest(clientIp(request));
  if (!rate.allowed) {
    return Response.json({ error: rate.reason }, { status: 429 });
  }

  try {
    const result = await runAsk(question, stateCode, district, DEFAULT_ASK_MODEL);
    // Cache asynchronously-ish; a cache failure must not fail the answer.
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
