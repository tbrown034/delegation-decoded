import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EvidenceRegistry,
  annotateToolResult,
  resolveCitations,
  prepareToolPayload,
} from "../lib/ask-citations";

test("annotate injects sequential refs into vote records", () => {
  const registry = new EvidenceRegistry();
  const result = annotateToolResult(
    "get_member_votes",
    { bioguide_id: "Y000064" },
    {
      source: "House Clerk and Senate roll-call XML",
      records: [
        { roll: 210, chamber: "senate", date: "2026-06-01" },
        { roll: 198, chamber: "senate", date: "2026-05-20" },
      ],
    },
    registry
  ) as { records: { ref: string }[] };
  assert.deepEqual(
    result.records.map((r) => r.ref),
    ["v1", "v2"]
  );
  assert.equal(registry.get("v1")?.href, "/member/Y000064#votes");
  assert.match(registry.get("v2")?.label ?? "", /Roll call 198/);
});

test("annotate leaves error results untouched", () => {
  const registry = new EvidenceRegistry();
  const result = annotateToolResult(
    "get_member_votes",
    { bioguide_id: "Y000064" },
    { error: "That member is outside this page's delegation scope." },
    registry
  );
  assert.deepEqual(result, {
    error: "That member is outside this page's delegation scope.",
  });
  assert.equal(registry.get("v1"), undefined);
});

test("markers the registry never issued are stripped", () => {
  const registry = new EvidenceRegistry();
  registry.register("v", "get_member_votes", "Roll call 210", "/member/Y000064");
  const { answer, citations } = resolveCitations(
    "She voted yea. [v1] The sky is green. [v9] Also this. [x1]",
    registry
  );
  assert.equal(answer, "She voted yea. [1] The sky is green. Also this.");
  assert.equal(citations.length, 1);
  assert.equal(citations[0].label, "Roll call 210");
});

test("valid markers renumber in order of first appearance and repeat stably", () => {
  const registry = new EvidenceRegistry();
  registry.register("v", "get_member_votes", "Roll call 210", null); // v1
  const f1 = registry.register("f", "get_member_finance", "FEC totals, 2026 cycle", null);
  assert.equal(f1, "f1");
  const { answer, citations } = resolveCitations(
    "Raised $12.4 million. [f1] Voted yea. [v1] Again per filings. [f1]",
    registry
  );
  assert.equal(
    answer,
    "Raised $12.4 million. [1] Voted yea. [2] Again per filings. [1]"
  );
  assert.deepEqual(
    citations.map((c) => [c.n, c.ref]),
    [
      [1, "f1"],
      [2, "v1"],
    ]
  );
});

test("bill citations link to the bill page when the id is well-formed", () => {
  const registry = new EvidenceRegistry();
  annotateToolResult(
    "get_member_bills",
    { bioguide_id: "H001093" },
    { records: [{ bill_id: "hr-1234-119", label: "HR 1234", introduced: "2025-03-01" }] },
    registry
  );
  assert.equal(registry.get("b1")?.href, "/bill/hr-1234-119");
});

test("an answer with no markers degrades to zero citations", () => {
  const registry = new EvidenceRegistry();
  const { answer, citations } = resolveCitations("A plain answer.", registry);
  assert.equal(answer, "A plain answer.");
  assert.equal(citations.length, 0);
});

test("official biography records receive member-page citations", () => {
  const registry = new EvidenceRegistry();
  const result = annotateToolResult(
    "get_member_biography",
    { bioguide_id: "B001299" },
    {
      records: [
        {
          fact_type: "education",
          quote: "The official biography says the senator attended IU.",
        },
      ],
    },
    registry
  ) as { records: Array<{ ref: string }> };
  assert.equal(result.records[0].ref, "o1");
  assert.equal(registry.get("o1")?.href, "/member/B001299#biography");
  assert.match(registry.get("o1")?.label ?? "", /education/);
});

test("member-seat race results cite campaign biography and prior service separately", () => {
  const registry = new EvidenceRegistry();
  const result = annotateToolResult(
    "get_race_candidates",
    {},
    {
      contests: [
        {
          contest_id: "2026-GA-S2-special",
          source: "Georgia Secretary of State",
          records: [
            {
              name: "Jordan Lee",
              status: "active",
              campaign_biography: [{ quote: "Campaign biography statement" }],
              prior_service_stated_by_campaign: [{ office: "Mayor" }],
            },
          ],
        },
      ],
    },
    registry
  ) as {
    contests: Array<{
      records: Array<{
        ref: string;
        campaign_biography: Array<{ ref: string }>;
        prior_service_stated_by_campaign: Array<{ ref: string }>;
      }>;
    }>;
  };
  const candidate = result.contests[0].records[0];
  assert.equal(candidate.ref, "r1");
  assert.equal(candidate.campaign_biography[0].ref, "c1");
  assert.equal(candidate.prior_service_stated_by_campaign[0].ref, "s1");
  assert.equal(registry.get("c1")?.href, "/race/2026-GA-S2-special");
});


test("untrusted record fields cannot override server citation references", () => {
  const registry = new EvidenceRegistry();
  const result = annotateToolResult("get_member_votes", {}, { records: [{ ref: "v99", roll: 1 }] }, registry) as { records: { ref: string }[] };
  assert.equal(result.records[0].ref, "v1");
  assert.deepEqual(resolveCitations("Claim. [v99]", registry).unknownRefs, ["v99"]);
});


test("oversized tool results retain complete records and never register omitted evidence", () => {
  const registry = new EvidenceRegistry();
  registry.register("f", "get_member_finance", "Earlier evidence", null);
  const payload = prepareToolPayload("get_member_votes", {}, {
    matched: 3, showing: 3,
    records: [{ roll: 1, text: "a".repeat(250) }, { roll: 2, text: "b".repeat(250) }, { roll: 3, text: "c".repeat(250) }],
  }, registry, 550);
  const result = JSON.parse(payload);
  assert.ok(payload.length <= 550);
  assert.equal(result.records.length, 1);
  assert.equal(result.showing, 1);
  assert.equal(result.matched, 3);
  assert.ok(result.truncation_note);
  assert.ok(registry.get("v1"));
  assert.equal(registry.get("v2"), undefined);
  assert.ok(registry.get("f1"));
});


test("citation lists and ranges validate every constituent record", () => {
  const registry = new EvidenceRegistry();
  for (let n = 1; n <= 3; n++) registry.register("p", "get_member_finance", `Committee ${n}`, null);
  const result = resolveCitations("Committees. [p1-p3] Again. [p1, p3]", registry);
  assert.equal(result.answer, "Committees. [1][2][3] Again. [1][3]");
  assert.deepEqual(result.unknownRefs, []);
  assert.equal(result.citations.length, 3);
});
