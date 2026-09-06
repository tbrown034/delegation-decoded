import assert from "node:assert/strict";
import test from "node:test";
import { ASK_SYSTEM_PROMPT, sanitizeAnswerLinks, finalizeAskAnswer, parseTerminalAnswer } from "../lib/ask-engine";
import {
  executeAskTool,
  getAskTools,
  getAskToolsForQuestion,
  isUnsetAskFilter,
  type AskScope,
} from "../lib/ask-tools";
import { createSafetyIdentifier } from "../lib/ask-limits";
import { toAnthropicStrictSchema } from "../lib/anthropic-schema";

import { EvidenceRegistry, annotateToolResult } from "../lib/ask-citations";

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


test("failed and empty lookups cannot support an answered response", () => {
  for (const payload of [{ error: "lookup failed" }, { records: [] }]) {
    const registry = new EvidenceRegistry();
    annotateToolResult("get_member_votes", {}, payload, registry);
    // The old attempt-count check passed this exact sequence.
    const terminal = parseTerminalAnswer({ status: "answered", answer: "She voted yea." }, 1);
    assert.throws(() => finalizeAskAnswer(terminal.answer, terminal.status, JSON.stringify(payload), registry), /did not cite/);
  }
});

test("a valid citation cannot conceal an invented citation", () => {
  const registry = new EvidenceRegistry();
  registry.register("v", "get_member_votes", "Roll call 210", null);
  assert.throws(() => finalizeAskAnswer("Voted yea. [v1] Also another vote. [v99]", "answered", "", registry), /did not retrieve/);
});

test("retrieved records still require an explicit citation for factual answers", () => {
  const registry = new EvidenceRegistry();
  registry.register("v", "get_member_votes", "Roll call 210", null);
  assert.throws(() => finalizeAskAnswer("Voted yea.", "answered", "", registry), /did not cite/);
  assert.equal(finalizeAskAnswer("Voted yea. [v1]", "answered", "", registry).citations.length, 1);
});

test("record-free boundary responses remain available", () => {
  for (const status of ["not_found", "out_of_scope", "declined"] as const) {
    assert.equal(finalizeAskAnswer("I cannot answer that from these records.", status, "", new EvidenceRegistry()).citations.length, 0);
  }
});


test("official domains alone do not authorize invented evidence links", () => {
  assert.equal(sanitizeAnswerLinks("[Source](https://www.congress.gov/bill/invented)", ""), "Source");
  assert.equal(sanitizeAnswerLinks("[FEC](https://www.fec.gov/invented)", ""), "FEC");
  assert.equal(sanitizeAnswerLinks("[Source](https://www.congress.gov/bill/example)", "https://www.congress.gov/bill/example-other"), "Source");
  assert.match(sanitizeAnswerLinks("[Source](https://www.congress.gov/bill/example)", "https://www.congress.gov/bill/example"), /https:/);
  assert.equal(sanitizeAnswerLinks("[Voting information](https://vote.gov)", ""), "[Voting information](https://vote.gov)");
});

test("unrecognized member questions retain retrieval capability", () => {
  const scope: AskScope = { type: "member", stateCode: "IN", bioguideId: "B001299", seat: { office: "S", senateClass: 1 } };
  for (const question of ["Was he a veteran?", "Where did he attend college?", "What has he accomplished?"]) {
    assert.ok(getAskToolsForQuestion(scope, question).some(tool => !tool.terminal));
  }
  assert.ok(getAskToolsForQuestion(scope, "How much has he spent?").some(tool => tool.name === "get_member_finance"));
  assert.ok(getAskToolsForQuestion(scope, "Which amendment did he sponsor?").some(tool => tool.name === "get_member_bills"));
});


test("model-authored numeric footnotes cannot bypass citation validation", () => {
  const registry = new EvidenceRegistry();
  registry.register("v", "get_member_votes", "Roll call 210", null);
  for (const fake of ["99", "v1234"]) {
    assert.throws(() => finalizeAskAnswer(`Real. [v1] Unsupported. [${fake}]`, "answered", "", registry), /did not retrieve/);
  }
});


test("FEC filer questions expose candidate retrieval to the fallback provider", () => {
  assert.ok(getAskToolsForQuestion(stateScope, "Who has filed with the FEC for Indiana's 7th District?").some(tool => tool.name === "get_race_candidates"));
});


test("unrecognized state and national questions retain substantive retrieval", () => {
  for (const scope of [stateScope, { type: "national" } as const]) {
    const tools = getAskToolsForQuestion(scope, "What has Todd Young said about Ukraine?");
    assert.ok(tools.some(tool => tool.name === "get_member_biography"));
    assert.ok(tools.some(tool => tool.name === "get_member_bills"));
  }
});

test("grouped invented references reject the whole answer", () => {
  const registry = new EvidenceRegistry();
  registry.register("v", "get_member_votes", "Vote", null);
  for (const group of ["f7, f8", "ref v9", "v1-v3", "source: invented"]) {
    assert.throws(() => finalizeAskAnswer(`Real. [v1] False. [${group}]`, "answered", "", registry), /did not retrieve/);
  }
});


test("plain roster questions keep the fallback schema set small", () => {
  assert.deepEqual(getAskToolsForQuestion(stateScope, "Who are Indiana's two senators and the representative for its 9th District?").map(t => t.name), ["get_delegation", "submit_answer"]);
});


test("terminal answer wrappers are not displayed as reader text", () => {
  assert.deepEqual(parseTerminalAnswer({ status: "not_found", answer: "<answer>No matching records.</answer>" }, 1), { status: "not_found", answer: "No matching records." });
});


test("cited finance answers retain agency attribution when copied from the UI", () => {
  const registry = new EvidenceRegistry();
  registry.register("f", "get_member_finance", "2022 FEC totals", null);
  const result = finalizeAskAnswer("The campaign raised $10 million. [f1]", "answered", "", registry);
  assert.match(result.answer, /Source: FEC campaign-finance filings\. \[1\]/);
  assert.equal(finalizeAskAnswer("FEC reports $10 million. [f1]", "answered", "", registry).answer, "FEC reports $10 million. [1]");
});
