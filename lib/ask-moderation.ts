// Input and output screening for /ask.
//
// Two mechanisms, cheapest first:
// 1. Attack signatures — free regex checks for known injection patterns,
//    run before any paid call. A match is a certainty, not a score.
// 2. OpenAI's free moderation endpoint, per their production guidance to
//    moderate user input before generation and output before serving.
//    Fail-open by design: moderation is defense-in-depth on top of a tool
//    loop that is already scope-locked and grounded, so an error, timeout,
//    or missing key lets the text proceed rather than taking the feature
//    down. Only an explicit flag blocks.

import OpenAI from "openai";

const MODERATION_TIMEOUT_MS = 3_000;

// Known-attack fingerprints. Kept deliberately tight: questions are capped at
// 400 chars and are about congressional records, so none of these patterns
// appear in legitimate traffic. Blocked questions land in ask_log with the
// signature id as refusal_category — new patterns caught downstream by the
// moderation classifier or found in the log get added here.
const ATTACK_SIGNATURES: { id: string; pattern: RegExp }[] = [
  {
    // "forget" is deliberately absent and "rules committee" is carved out:
    // "Forget the House, what about the Rules Committee?" is a real question.
    id: "instruction_override",
    pattern:
      /\b(ignore|disregard|override)\b[^.?!]{0,40}\b(previous|prior|above|earlier|your|all|the)\b[^.?!]{0,20}\b(instructions?|rules?(?!\s+committee)|prompts?|guidelines?)\b/i,
  },
  {
    id: "instruction_replace",
    pattern: /\byour new (instructions?|rules?|task|role) (is|are)\b/i,
  },
  {
    id: "jailbreak_persona",
    pattern: /\byou are now (dan|aim|jailbroken)\b|\b(developer|god) mode\b/i,
  },
  {
    id: "prompt_extraction",
    pattern:
      /\b(reveal|repeat|print|show|output|display)\b[^.?!]{0,30}\b(system prompt|your (prompt|instructions))\b/i,
  },
  {
    id: "delimiter_escape",
    pattern: /<\/?(system|assistant|question|prior_question|prior_answer)>|\[\/?INST\]/i,
  },
];

// Returns the matched signature id, or null. Free and sub-millisecond.
export function matchesAttackSignature(text: string): string | null {
  for (const { id, pattern } of ATTACK_SIGNATURES) {
    if (pattern.test(text)) return id;
  }
  return null;
}

export async function moderateText(
  text: string
): Promise<{ flagged: boolean }> {
  if (!process.env.OPENAI_API_KEY) return { flagged: false };
  try {
    const client = new OpenAI({ timeout: MODERATION_TIMEOUT_MS, maxRetries: 0 });
    const result = await client.moderations.create({
      model: "omni-moderation-latest",
      input: text,
    });
    return { flagged: result.results?.[0]?.flagged === true };
  } catch {
    return { flagged: false };
  }
}
