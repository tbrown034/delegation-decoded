/**
 * Paid synthetic sweep for /ask: one roster question per delegation (50
 * states + DC + territories), generated and graded from the database itself.
 *
 * The breadth tier of the eval stack. eval-ask.ts is the depth tier (curated
 * capability cases); this sweep asks the same shallow question
 * 56 ways to flush out data-corner bugs — territories, at-large districts,
 * DC — that a single-state fixture never touches. Questions run in national
 * scope so the model must retrieve the roster with tools rather than read it
 * from a page context.
 *
 * Grading is self-generating: the expected names come from the same members
 * table the assistant reads, so this tests fidelity (answer matches our
 * data), not external truth. Senators' last names are required per state;
 * delegations without senators (DC, territories) require their House
 * members' names instead.
 *
 * Run (hits paid provider APIs — a full 56-delegation pass takes several
 * minutes and real money):
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/eval-ask-sweep.ts [provider:model]
 *
 * Scope controls:
 *   SWEEP_LIMIT=5            first N delegations alphabetically
 *   SWEEP_STATES=IN,CA,DC    exact delegations
 */
import "./lib/env";
import {
  runAsk,
  type AskProvider,
  type RunOptions,
} from "../lib/ask-engine";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";
import { STATE_BY_CODE } from "../lib/states";

interface SweepCase {
  stateCode: string;
  stateName: string;
  question: string;
  expectNames: string[];
}

function parseTarget(value: string | undefined): {
  provider?: AskProvider;
  model?: string;
} {
  if (!value) return {};
  const [provider, ...modelParts] = value.split(":");
  if ((provider !== "anthropic" && provider !== "openai") || modelParts.length === 0) {
    throw new Error(`Invalid target "${value}". Use provider:model.`);
  }
  return { provider, model: modelParts.join(":") };
}

async function buildCases(): Promise<SweepCase[]> {
  const result = (await db.execute(sql`
    SELECT state_code, last_name, chamber
    FROM members
    WHERE in_office = true
    ORDER BY state_code, chamber, last_name
  `)) as unknown as {
    rows: { state_code: string; last_name: string; chamber: string }[];
  };

  const byState = new Map<string, { senate: string[]; house: string[] }>();
  for (const row of result.rows) {
    const entry = byState.get(row.state_code) ?? { senate: [], house: [] };
    entry[row.chamber === "senate" ? "senate" : "house"].push(row.last_name);
    byState.set(row.state_code, entry);
  }

  const cases: SweepCase[] = [];
  for (const [stateCode, delegation] of [...byState.entries()].sort()) {
    const state = STATE_BY_CODE[stateCode];
    if (!state) continue;
    // States: both senators must be named. DC/territories: no senators, so
    // the delegate (or resident commissioner) must be named instead.
    const expectNames =
      delegation.senate.length > 0 ? delegation.senate : delegation.house;
    if (expectNames.length === 0) continue;
    cases.push({
      stateCode,
      stateName: state.name,
      question: `Who represents ${state.name} in Congress?`,
      expectNames,
    });
  }
  return cases;
}

async function main() {
  const target = parseTarget(process.argv[2]);
  let cases = await buildCases();

  const statesFilter = process.env.SWEEP_STATES
    ?.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (statesFilter && statesFilter.length > 0) {
    cases = cases.filter((c) => statesFilter.includes(c.stateCode));
  }
  const limit = Number(process.env.SWEEP_LIMIT || 0);
  if (limit > 0) cases = cases.slice(0, limit);

  console.log(
    `Sweeping ${cases.length} delegation${cases.length === 1 ? "" : "s"} in national scope` +
      (target.provider ? ` against ${target.provider}:${target.model}` : " against the default provider order")
  );

  let passed = 0;
  let totalMs = 0;
  let totalIn = 0;
  let totalOut = 0;
  const failures: string[] = [];

  for (const c of cases) {
    const started = performance.now();
    try {
      const runOptions: RunOptions = {
        providerOverride: target.provider,
        modelOverride: target.model,
        debugProviderErrors: true,
      };
      const result = await runAsk(c.question, { type: "national" }, runOptions);
      const elapsed = Math.round(performance.now() - started);
      totalMs += elapsed;
      totalIn += result.usage.inputTokens;
      totalOut += result.usage.outputTokens;

      const lower = result.answer.toLowerCase();
      // Compound surnames ("Hernández Rivera", "Graham Nordone") count as
      // present when any component appears — answers legitimately shorten.
      const missing = c.expectNames.filter(
        (name) =>
          !name
            .toLowerCase()
            .split(/[\s-]+/)
            .filter((part) => part.length >= 3)
            .some((part) => lower.includes(part))
      );
      const ok = result.status === "answered" && missing.length === 0;
      if (ok) {
        passed++;
        console.log(`PASS  ${c.stateCode}  ${elapsed}ms  out=${result.usage.outputTokens}`);
      } else {
        const reason =
          result.status !== "answered"
            ? `status: ${result.status}`
            : `missing: ${missing.join(", ")}`;
        failures.push(`${c.stateCode} — ${reason}`);
        console.log(`FAIL  ${c.stateCode}  ${elapsed}ms  (${reason})`);
        console.log(`      ${result.answer.slice(0, 200).replace(/\n/g, " ")}`);
        console.log(`      trace=${JSON.stringify(result.trace)}`);
      }
    } catch (error) {
      const elapsed = Math.round(performance.now() - started);
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${c.stateCode} — error: ${message}`);
      console.log(`ERROR ${c.stateCode}  ${elapsed}ms  ${message}`);
    }
  }

  console.log(
    `\n-- ${passed}/${cases.length} passed · avg ${cases.length ? Math.round(totalMs / cases.length) : 0}ms · tokens in=${totalIn} out=${totalOut}`
  );
  if (failures.length > 0) {
    console.log(`Failures:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
