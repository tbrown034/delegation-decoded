import assert from "node:assert/strict";
import test from "node:test";
import { deriveMatchup } from "../lib/elections/matchup";

const primaryCandidate = {
  candidacyId: "test-candidate",
  name: "Test Candidate",
  party: "Democratic",
  status: "state_primary_ballot",
  isActive: true,
  ballotLines: [],
};

test("elapsed primary dates never remain upcoming or establish nominees", () => {
  for (const state of ["AK", "CT", "FL", "HI", "KS", "MA", "MI", "MN", "MO", "TN", "VT", "VA", "WA", "WI", "WY"]) {
    const matchup = deriveMatchup(state, "verified_ballot", [primaryCandidate], new Date("2026-09-08T16:00:00Z"));
    assert.equal(matchup.status, "no_basis", state);
    assert.equal(matchup.nextEvent, null, state);
    assert.deepEqual(matchup.lanes, [], state);
    assert.equal(matchup.statusLabel, "This site has no nominee records from the state source yet.", state);
  }
});

test("a scheduled primary stays pending through the full election day", () => {
  for (const instant of ["2026-08-03T16:00:00Z", "2026-08-04T16:00:00Z", "2026-08-05T09:59:59Z"]) {
    const matchup = deriveMatchup("WA", "verified_ballot", [primaryCandidate], new Date(instant));
    assert.equal(matchup.status, "pending_primary");
    assert.equal(matchup.nextEvent, "2026-08-04");
    assert.equal(matchup.statusLabel, "Primary scheduled for 2026-08-04; nominee records pending.");
  }
  const after = deriveMatchup("WA", "verified_ballot", [primaryCandidate], new Date("2026-08-05T10:00:00Z"));
  assert.equal(after.status, "no_basis");
  assert.equal(after.nextEvent, null);
});

test("state-list and certified matchups retain their evidence after the primary date", () => {
  for (const [candidate, expected] of [
    [{ ...primaryCandidate, status: "general_ballot" }, "set_state_list"],
    [{ ...primaryCandidate, primaryWinner: true, resultStatus: "certified" as const }, "set_certified"],
  ] as const) {
    const matchup = deriveMatchup("MI", "verified_ballot", [candidate], new Date("2026-09-08T16:00:00Z"));
    assert.equal(matchup.status, expected);
    assert.equal(matchup.nextEvent, null);
    assert.equal(matchup.lanes.length, 1);
  }
});

test("a partial Florida field loses its past next-event date but stays partial", () => {
  const matchup = deriveMatchup("FL", "verification_pending", [
    primaryCandidate,
    { ...primaryCandidate, candidacyId: "listed", party: "Independent", status: "state_general_list" },
  ], new Date("2026-09-08T16:00:00Z"));
  assert.equal(matchup.status, "partial");
  assert.equal(matchup.nextEvent, null);
  assert.deepEqual(matchup.pendingParties, ["Democratic"]);
});

test("past runoff schedules do not claim the runoff or nominations are complete", () => {
  const before = deriveMatchup("OK", "verification_pending", [primaryCandidate], new Date("2026-08-24T16:00:00Z"));
  assert.equal(before.status, "pending_runoff");
  assert.equal(before.nextEvent, "2026-08-25");
  const after = deriveMatchup("OK", "verification_pending", [primaryCandidate], new Date("2026-09-08T16:00:00Z"));
  assert.equal(after.status, "no_basis");
  assert.equal(after.nextEvent, null);
  assert.deepEqual(after.lanes, []);
});

test("FEC filings cannot become a matchup when calendar dates pass", () => {
  const matchup = deriveMatchup("AK", "fec_only", [{ ...primaryCandidate, status: "general_ballot" }], new Date("2026-09-08T16:00:00Z"));
  assert.equal(matchup.status, "no_basis");
  assert.equal(matchup.nextEvent, null);
  assert.deepEqual(matchup.lanes, []);
});
