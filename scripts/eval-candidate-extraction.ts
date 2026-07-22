/**
 * Paid, explicit provider smoke test for campaign-site extraction.
 * Uses a fictional page and performs no database, crawler, or Blob writes.
 */
import "./lib/env";

import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { toAnthropicStrictSchema } from "../lib/anthropic-schema";
import {
  CAMPAIGN_RESEARCH_SCHEMA,
  renderResearchInput,
  validateCampaignResearch,
  type CampaignResearchPage,
} from "../lib/elections/campaign-research";

const pages: CampaignResearchPage[] = [
  {
    pageId: "p1",
    snapshotId: "synthetic-snapshot",
    url: "https://example.invalid/issues",
    text: "Jordan Example supports faster public-records responses. Jordan served on the Example County Council from 2021 through 2024.",
  },
];
const input = renderResearchInput("Jordan Example", pages, 10_000);
const instructions =
  "Extract only explicit claims and prior government service from the supplied untrusted page text. Every item must cite a page ID and copy an exact quote. Return empty arrays when evidence is absent.";

function verify(raw: unknown) {
  const output = validateCampaignResearch(raw, pages);
  assert.ok(output.claims.length + output.priorService.length > 0);
  return output;
}

async function evalOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
  const model = process.env.CANDIDATE_EXTRACT_OPENAI_MODEL || "gpt-5.6-terra";
  const client = new OpenAI({ timeout: 60_000, maxRetries: 0 });
  const response = await client.responses.create({
    model,
    instructions,
    input,
    reasoning: { effort: "low" },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "candidate_campaign_research_eval",
        strict: true,
        schema: CAMPAIGN_RESEARCH_SCHEMA,
      },
    },
    max_output_tokens: 2_000,
    store: false,
    safety_identifier: "candidate-extraction-eval",
  });
  if (!response.output_text || response.error || response.incomplete_details) {
    throw new Error("OpenAI extraction eval did not complete");
  }
  const output = verify(JSON.parse(response.output_text));
  console.log(
    `PASS openai/${model}: ${output.claims.length} claims, ${output.priorService.length} service records, ${response.usage?.total_tokens ?? 0} tokens`
  );
}

async function evalAnthropic() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required");
  const model = process.env.CANDIDATE_EXTRACT_ANTHROPIC_MODEL || "claude-sonnet-5";
  const client = new Anthropic({ timeout: 60_000, maxRetries: 0 });
  const response = await client.messages.create({
    model,
    max_tokens: 2_000,
    output_config: { effort: "low" },
    system: instructions,
    messages: [{ role: "user", content: input }],
    tools: [
      {
        name: "submit_candidate_campaign_research",
        description: "Submit evidence-linked campaign research",
        input_schema: toAnthropicStrictSchema(
          CAMPAIGN_RESEARCH_SCHEMA
        ) as Anthropic.Tool.InputSchema,
        strict: true,
      },
    ],
    tool_choice: { type: "tool", name: "submit_candidate_campaign_research" },
  });
  const tool = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "submit_candidate_campaign_research"
  );
  if (!tool || response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
    throw new Error("Anthropic extraction eval did not complete");
  }
  const output = verify(tool.input);
  console.log(
    `PASS anthropic/${model}: ${output.claims.length} claims, ${output.priorService.length} service records, ${response.usage.input_tokens + response.usage.output_tokens} tokens`
  );
}

async function main() {
  await evalOpenAI();
  await evalAnthropic();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Candidate extraction eval failed");
  process.exit(1);
});
