import assert from "node:assert/strict";
import test from "node:test";
import { ASK_SYSTEM_PROMPT, sanitizeAnswerLinks } from "../lib/ask-engine";
import {
  executeAskTool,
  getAskTools,
  getAskToolsForQuestion,
  isUnsetAskFilter,
  type AskScope,
} from "../lib/ask-tools";
import { createSafetyIdentifier } from "../lib/ask-limits";
import { toAnthropicStrictSchema } from "../lib/anthropic-schema";

const stateScope: AskScope = {
  type: "state",
  stateCode: "IN",
  district: null,
};

test("Ask preserves Washington top-two party-preference language", () => {
  assert.match(ASK_SYSTEM_PROMPT, /Washington uses a top-two primary/);
  assert.match(ASK_SYSTEM_PROMPT, /never shorten them to "Democrat" or "Republican"/);
});

test("tool schemas are closed and stock disclosure tools are absent", () => {
  const tools = getAskTools(stateScope);
  assert.equal(tools.some((tool) => tool.name.includes("trade")), false);
  assert.equal(tools.some((tool) => tool.name.includes("disclosure")), false);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(
      tool.inputSchema.required,
      Object.keys(tool.inputSchema.properties as Record<string, unknown>)
    );
  }
});

test("Anthropic strict-schema normalization strips unsupported bounds but preserves structure", () => {
  assert.deepEqual(
    toAnthropicStrictSchema({
      type: "object",
      additionalProperties: false,
      properties: {
        value: { type: "string", minLength: 1, maxLength: 10 },
      },
      required: ["value"],
    }),
    {
      type: "object",
      additionalProperties: false,
      properties: { value: { type: "string" } },
      required: ["value"],
    }
  );
  assert.deepEqual(
    toAnthropicStrictSchema({
      anyOf: [{ type: "string", enum: ["sponsor", "cosponsor"] }, { type: "null" }],
      description: "Role filter.",
    }),
    {
      type: "string",
      enum: ["sponsor", "cosponsor", ""],
      description: "Role filter. Use an empty string when this field does not apply.",
    }
  );
});

test("member scope does not expose delegation retrieval", () => {
  const tools = getAskTools({
    type: "member",
    stateCode: "IN",
    bioguideId: "B001299",
    seat: { office: "S", senateClass: 1 },
  });
  assert.equal(tools.some((tool) => tool.name === "get_delegation"), false);
  const raceTool = tools.find((tool) => tool.name === "get_race_candidates");
  assert.deepEqual(
    (raceTool?.inputSchema as { properties?: Record<string, unknown> }).properties,
    {}
  );
});

test("Anthropic question routing exposes only relevant retrieval tools", () => {
  assert.deepEqual(
    getAskToolsForQuestion(stateScope, "What health bills did Jim Banks sponsor?").map(
      (tool) => tool.name
    ),
    ["get_member_bills", "submit_answer"]
  );
  assert.deepEqual(
    getAskToolsForQuestion(stateScope, "What was Erin Houchin's latest vote?").map(
      (tool) => tool.name
    ),
    ["get_member_votes", "submit_answer"]
  );
  assert.deepEqual(
    getAskToolsForQuestion(stateScope, "How much did Todd Young raise in the 2022 election cycle?").map(
      (tool) => tool.name
    ),
    ["get_member_finance", "submit_answer"]
  );
  assert.deepEqual(
    getAskToolsForQuestion(stateScope, "What does Todd Young's biography say about his education?").map(
      (tool) => tool.name
    ),
    ["get_member_biography", "submit_answer"]
  );
});

test("provider null sentinels cannot become accidental database filters", () => {
  for (const value of [null, -1, "", "null", '""', "</antml_parameter>"]) {
    assert.equal(isUnsetAskFilter(value), true);
  }
  assert.equal(isUnsetAskFilter("health care"), false);
});

test("executor rejects a member outside scope before any query", async () => {
  const result = await executeAskTool(
    "get_member_votes",
    { bioguide_id: "Y000064", limit: 10 },
    {
      scope: {
        type: "member",
        stateCode: "IN",
        bioguideId: "B001299",
        seat: { office: "S", senateClass: 1 },
      },
      allowedMemberIds: new Set(["B001299"]),
    }
  );
  assert.deepEqual(result, {
    error: "That member is outside this page's delegation scope.",
  });
});

test("answer links require allowlisted routes and evidence", () => {
  const evidence = "member B001299 bill hr-123-119";
  const answer = [
    "[Jim Banks](/member/B001299)",
    "[Invented](/member/X999999)",
    "[Bad](javascript:alert(1))",
    "[Bill](/bill/hr-123-119)",
    "[Race](/race/2026-IN-S2)",
  ].join(" ");
  const sanitized = sanitizeAnswerLinks(answer, evidence);
  assert.match(sanitized, /\[Jim Banks\]\(\/member\/B001299\)/);
  assert.doesNotMatch(sanitized, /X999999/);
  assert.doesNotMatch(sanitized, /javascript:/);
  assert.match(sanitized, /\[Bill\]\(\/bill\/hr-123-119\)/);
  assert.doesNotMatch(sanitized, /\/race\/2026-IN-S2/);
});

test("safety identifiers are stable, keyed, and do not reveal the IP", () => {
  const first = createSafetyIdentifier("203.0.113.42");
  const second = createSafetyIdentifier("203.0.113.42");
  assert.equal(first, second);
  assert.equal(first.length, 32);
  assert.equal(first.includes("203.0.113.42"), false);
});
