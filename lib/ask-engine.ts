import Anthropic from "@anthropic-ai/sdk";
import { askTools, executeAskTool, type ToolTraceEntry } from "./ask-tools";
import { getMembersByState, getStateByCode } from "./queries";

// Core of the /ask feature: one grounded tool loop shared by the API route
// and the eval harness (scripts/eval-ask.ts). Keep transport concerns
// (validation, rate limiting, caching) out of this file.

// Haiku won the scripts/eval-ask.ts bake-off (July 2026): 6/6 grounding
// checks, ~2x faster and ~3x cheaper than Sonnet on this tool-routing
// workload. Override with ASK_MODEL to re-test alternatives.
export const DEFAULT_ASK_MODEL = process.env.ASK_MODEL || "claude-haiku-4-5";
const MAX_ITERATIONS = 6;

export const ASK_SYSTEM_PROMPT = `You are the lookup assistant for Delegation Decoded, a congressional accountability site built by a journalist. You answer questions about a reader's congressional delegation using ONLY the results of the tools provided. The tools read from official records: Congress.gov (bills), House Clerk and Senate roll-call XML (votes), the FEC (campaign finance), and the @unitedstates project (members, committees).

Grounding rules, non-negotiable:
- Every number, vote position, dollar figure, and name in your answer must come from a tool result in this conversation. Never estimate, extrapolate, or fill gaps from general knowledge.
- If the tools cannot answer the question (state legislatures, governors, local offices, ballot measures, election predictions, opinions, anything outside this congressional data), say plainly that this site only covers the current US Congress and name what the reader could check instead. Do not partially answer from memory.
- If a tool returns no rows, say the record is not in our data, not that it does not exist.
- Questions about OTHER states are welcome: call get_delegation with that state's two-letter code. The reader's location is context for "my/me" questions, not a restriction.
- If the reader's House district is unknown and the question needs it, answer what you can (their senators, the number of districts), then tell them to add their street address in the location bar above this chat — that resolves their district instantly. Never send them to house.gov or any external site to find their representative, and never ask them to reply with information: each question here is answered independently, not as a conversation.
- You DO have term dates: use get_member_terms to answer whether a seat is up in a given election year. Every House seat is up every two years (all are on the November 2026 ballot). A Senate seat is up in November of the year before its current term's January end date — a term ending January 2027 means the seat is on the 2026 ballot; a term ending 2029 or 2031 means it is not.
- You have NO candidate or challenger data — no filings, no primary results. For "who is running" questions, say that plainly, then offer what you can verify: whether the seat is up, and who holds it now.

Citation rules:
- Link every member on first mention: [Full Name](/member/BIOGUIDE_ID).
- Link bills: [HR 1234](/bill/BILL_ID) using the bill_id from tool results.
- When you cite campaign finance, name the cycle and attribute to FEC filings. When you cite votes, give the date and roll number.

Style:
- Journalist voice. Short paragraphs, one to three sentences. Lead with the direct answer.
- No emojis. No headers. Plain prose, with a short dash-free list only when comparing several members.
- Dollar amounts rounded sensibly ($4.2 million, not $4,201,338).
- Keep answers under 150 words unless the question genuinely needs more.`;

export class AskError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface AskResult {
  answer: string;
  trace: ToolTraceEntry[];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export async function runAsk(
  question: string,
  stateCode: string,
  district: number | null,
  model: string = DEFAULT_ASK_MODEL
): Promise<AskResult> {
  const [state, delegation] = await Promise.all([
    getStateByCode(stateCode),
    getMembersByState(stateCode),
  ]);
  if (!state || delegation.length === 0) {
    throw new AskError(`No delegation on file for ${stateCode}.`, 404);
  }

  const roster = delegation
    .map(
      (m) =>
        `${m.fullName} (${m.party}, ${m.chamber === "senate" ? "Senator" : m.district === 0 ? "Rep. at-large" : `Rep. district ${m.district}`}, bioguide_id ${m.bioguideId})`
    )
    .join("\n");

  const contextBlock = [
    `Reader location: ${state.name} (${stateCode})${district != null ? `, congressional district ${district}` : ""}.`,
    `Current delegation:`,
    roster,
    ``,
    `Reader question: ${question}`,
  ].join("\n");

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: contextBlock },
  ];
  const trace: ToolTraceEntry[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };

  // Haiku 4.5 does not support adaptive thinking; omit the param there.
  const supportsAdaptive = !model.includes("haiku");

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 1600,
      ...(supportsAdaptive ? { thinking: { type: "adaptive" as const } } : {}),
      system: [
        {
          type: "text",
          text: ASK_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: askTools,
      messages,
    });

    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    if (response.stop_reason !== "tool_use") {
      const answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { answer, trace, model, usage };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const input = use.input as Record<string, unknown>;
      trace.push({ tool: use.name, input });
      let result: unknown;
      try {
        result = await executeAskTool(use.name, input);
      } catch (err) {
        result = {
          error: `Tool failed: ${err instanceof Error ? err.message : "unknown"}`,
        };
      }
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: results });
  }

  throw new AskError(
    "The lookup took too many steps. Try a narrower question.",
    504
  );
}
