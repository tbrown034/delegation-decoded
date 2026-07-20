/**
 * Eval harness for the /ask assistant.
 *
 * Runs a fixed question set against one or more models and reports latency,
 * token spend, and grounding checks (links present, refusals where expected).
 * Use it whenever the model, system prompt, or tool surface changes.
 *
 * Run: npx tsx scripts/eval-ask.ts [model ...]
 *      npx tsx scripts/eval-ask.ts claude-haiku-4-5 claude-sonnet-4-6
 */
import "./lib/env";
import { runAsk } from "../lib/ask-engine";

interface EvalCase {
  label: string;
  question: string;
  stateCode: string;
  district: number | null;
  // Substrings that must appear (case-insensitive) for the answer to pass.
  mustInclude?: string[];
  // If true, the answer must decline rather than invent.
  expectRefusal?: boolean;
}

const CASES: EvalCase[] = [
  {
    label: "roster",
    question: "Who represents me in Congress?",
    stateCode: "IN",
    district: 9,
    mustInclude: ["banks", "young", "houchin"],
  },
  {
    label: "seat-up",
    question: "Is Jim Banks up for election in 2026?",
    stateCode: "IN",
    district: null,
    mustInclude: ["2031"],
  },
  {
    label: "cross-state",
    question: "Who are North Dakota's senators?",
    stateCode: "IN",
    district: null,
    mustInclude: ["/member/"],
  },
  {
    label: "finance",
    question: "How much has Todd Young raised, and from where?",
    stateCode: "IN",
    district: null,
    mustInclude: ["fec"],
  },
  {
    label: "out-of-scope",
    question: "Who is the governor of Indiana?",
    stateCode: "IN",
    district: null,
    expectRefusal: true,
  },
  {
    label: "no-fabrication",
    question: "Who is running against Andre Carson in the 2026 primary?",
    stateCode: "IN",
    district: 7,
    expectRefusal: true,
  },
];

const REFUSAL_MARKERS = [
  "only covers",
  "don't have",
  "do not have",
  "not in our data",
  "can't tell you",
  "cannot tell you",
  "no candidate",
  "doesn't track",
  "does not track",
  "doesn't carry",
  "does not carry",
  "outside what",
  "can't say who",
  "cannot say who",
];

async function evalModel(model: string) {
  console.log(`\n=== ${model} ===`);
  let passed = 0;
  let totalMs = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const c of CASES) {
    const t0 = performance.now();
    try {
      const r = await runAsk(c.question, c.stateCode, c.district, model);
      const ms = Math.round(performance.now() - t0);
      totalMs += ms;
      totalIn += r.usage.inputTokens;
      totalOut += r.usage.outputTokens;

      const lower = r.answer.toLowerCase();
      const missing = (c.mustInclude ?? []).filter(
        (s) => !lower.includes(s.toLowerCase())
      );
      const refused = REFUSAL_MARKERS.some((m) => lower.includes(m));
      const ok = c.expectRefusal ? refused : missing.length === 0;
      if (ok) passed++;

      console.log(
        `${ok ? "PASS" : "FAIL"}  ${c.label.padEnd(14)} ${ms}ms  in=${r.usage.inputTokens} out=${r.usage.outputTokens}` +
          (ok ? "" : c.expectRefusal ? "  (did not refuse)" : `  (missing: ${missing.join(", ")})`)
      );
      if (!ok) console.log(`      ${r.answer.slice(0, 220).replace(/\n/g, " ")}`);
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      console.log(`ERROR ${c.label.padEnd(14)} ${ms}ms  ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `-- ${passed}/${CASES.length} passed · avg ${Math.round(totalMs / CASES.length)}ms · tokens in=${totalIn} out=${totalOut}`
  );
}

async function main() {
  const models = process.argv.slice(2);
  if (models.length === 0) {
    models.push("claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8");
  }
  for (const m of models) {
    await evalModel(m);
  }
}

main();
