// Input screening for /ask via OpenAI's free moderation endpoint, per their
// production guidance to moderate user input before generation. Fail-open by
// design: moderation is defense-in-depth on top of a tool loop that is
// already scope-locked and grounded, so an error, timeout, or missing key
// lets the question proceed rather than taking the feature down.

import OpenAI from "openai";

const MODERATION_TIMEOUT_MS = 3_000;

export async function moderateQuestion(
  question: string
): Promise<{ flagged: boolean }> {
  if (!process.env.OPENAI_API_KEY) return { flagged: false };
  try {
    const client = new OpenAI({ timeout: MODERATION_TIMEOUT_MS, maxRetries: 0 });
    const result = await client.moderations.create({
      model: "omni-moderation-latest",
      input: question,
    });
    return { flagged: result.results?.[0]?.flagged === true };
  } catch {
    return { flagged: false };
  }
}
