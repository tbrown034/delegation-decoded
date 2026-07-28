import { STATE_ELECTION_TRIAGE } from "./registry";

// Derives the general-election matchup for a contest from candidacy statuses.
// Never stored: recomputed from the same rows the race pages already read, so
// the matchup can only ever say what the underlying provenance supports.
//
// Basis ranking (strongest first): certified primary results > state-reported
// unofficial results > the state's published general-candidate list. A primary
// winner is a sufficient basis — November certification is not required. FEC
// filings never produce a lane.

export type MatchupBasis =
  | "certified_results"
  | "unofficial_results"
  | "state_general_list"
  | "reference";

export type MatchupStatus =
  | "set_certified"
  | "set_unofficial"
  | "set_state_list"
  | "partial"
  | "pending_primary"
  | "pending_runoff"
  | "no_basis";

export type MatchupLane = {
  candidacyId: string;
  personId: string | null;
  fecCandidateId: string | null;
  name: string;
  party: string | null;
  partyLabel: string;
  basis: MatchupBasis;
  isWriteIn: boolean;
};

export type Matchup = {
  status: MatchupStatus;
  lanes: MatchupLane[];
  pendingParties: string[];
  nextEvent: string | null;
  statusLabel: string;
};

type MatchupCandidate = {
  candidacyId: string;
  personId?: string | null;
  fecCandidateId?: string | null;
  name: string;
  party: string | null;
  status: string;
  isActive: boolean;
  ballotLines: string[];
  resultStatus?: "unofficial" | "certified" | "complete_no_certification" | null;
  primaryWinner?: boolean | null;
};

const WRITE_IN_STATUSES = new Set(["qualified_write_in", "write_in"]);

// Statuses that mean the state has placed or named this candidate for the
// November ballot. Primary-stage and FEC statuses deliberately absent.
const GENERAL_LIST_STATUSES = new Set([
  "general_ballot",
  "state_general_qualified",
  "state_general_list",
  // Both write-in spellings must produce a lane. They are separated out as
  // write-ins for display, but a status that never becomes a lane would drop
  // the candidate from the matchup block entirely.
  "qualified_write_in",
  "write_in",
]);

const REPORTED_WINNER_STATUSES = new Set([
  "primary_winner",
  "state_reported_primary_winner",
  "state_reported_primary_unopposed",
  "advanced_top_two",
]);

// Active statuses that mean this candidacy is still waiting on a primary or
// runoff — their parties are what a formed matchup is missing.
const PRIMARY_STAGE_STATUSES = new Set([
  "state_primary_qualified",
  "state_primary_ballot",
  "state_primary_provisional",
  "state_general_filing_unofficial",
  "state_general_provisional",
]);

export function nomineeBasisFor(candidate: MatchupCandidate): MatchupBasis | null {
  if (!candidate.isActive) return null;
  if (candidate.status.startsWith("reference_")) return "reference";
  if (candidate.primaryWinner && candidate.resultStatus === "certified") {
    return "certified_results";
  }
  if (candidate.primaryWinner && candidate.resultStatus === "unofficial") {
    return "unofficial_results";
  }
  if (REPORTED_WINNER_STATUSES.has(candidate.status)) return "unofficial_results";
  if (GENERAL_LIST_STATUSES.has(candidate.status)) return "state_general_list";
  return null;
}

const BASIS_RANK: Record<MatchupBasis, number> = {
  certified_results: 3,
  unofficial_results: 2,
  state_general_list: 1,
  reference: 0,
};

function partyLabelFor(candidate: MatchupCandidate) {
  if (WRITE_IN_STATUSES.has(candidate.status)) {
    return candidate.party ? `Write-in (${candidate.party})` : "Write-in";
  }
  // A candidacy can repeat one label across primary and general stages;
  // distinct labels (fusion states) stay joined.
  const lines = Array.from(new Set(candidate.ballotLines));
  if (lines.length > 1) return lines.join(" / ");
  return candidate.party ?? lines[0] ?? "No party listed";
}

export function deriveMatchup(
  stateCode: string,
  coverage: "verified_ballot" | "verification_pending" | "fec_only",
  candidates: MatchupCandidate[]
): Matchup {
  const triage = STATE_ELECTION_TRIAGE[stateCode.toUpperCase()];
  const nextEvent = triage
    ? triage.runoffPending
      ? triage.runoffDate ?? null
      : triage.primaryHeld
        ? null
        : triage.primaryDate
    : null;

  // FEC filings are never a matchup basis; without state-authority coverage
  // there is nothing to derive.
  if (coverage === "fec_only") {
    return {
      status: "no_basis",
      lanes: [],
      pendingParties: [],
      nextEvent,
      statusLabel: "No state-authority source yet; FEC filings do not establish a matchup.",
    };
  }

  const lanes: MatchupLane[] = [];
  const pending = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.isActive) continue;
    const basis = nomineeBasisFor(candidate);
    if (basis) {
      lanes.push({
        candidacyId: candidate.candidacyId,
        personId: candidate.personId ?? null,
        fecCandidateId: candidate.fecCandidateId ?? null,
        name: candidate.name,
        party: candidate.party,
        partyLabel: partyLabelFor(candidate),
        basis,
        isWriteIn: WRITE_IN_STATUSES.has(candidate.status),
      });
    } else if (PRIMARY_STAGE_STATUSES.has(candidate.status)) {
      pending.add(candidate.party ?? "unaffiliated");
    }
  }
  lanes.sort((a, b) =>
    Number(a.isWriteIn) - Number(b.isWriteIn) || a.partyLabel.localeCompare(b.partyLabel)
  );
  const pendingParties = Array.from(pending).sort();

  const ballotLanes = lanes.filter((lane) => !lane.isWriteIn);

  if (ballotLanes.length === 0) {
    if (triage?.runoffPending) {
      return {
        status: "pending_runoff",
        lanes,
        pendingParties,
        nextEvent,
        statusLabel: `Matchup forms after the ${triage.runoffDate} runoff.`,
      };
    }
    if (triage && !triage.primaryHeld) {
      return {
        status: "pending_primary",
        lanes,
        pendingParties,
        nextEvent,
        statusLabel: `Matchup forms after the ${triage.primaryDate} primary.`,
      };
    }
    return {
      status: "no_basis",
      lanes,
      pendingParties,
      nextEvent,
      statusLabel: pendingParties.length
        ? "Primary concluded but the state source has not yet reported nominees."
        : "No general-election records from the state source yet.",
    };
  }

  if (pendingParties.length > 0 || triage?.runoffPending) {
    return {
      status: "partial",
      lanes,
      pendingParties,
      nextEvent,
      statusLabel: triage?.runoffPending
        ? `Partially formed; one or more nominations wait on the ${triage.runoffDate} runoff.`
        : `Partially formed; still awaiting ${pendingParties.join(", ")} nomination${pendingParties.length > 1 ? "s" : ""}.`,
    };
  }

  // The matchup's label is its weakest lane: one unofficial nominee keeps the
  // whole matchup labeled unofficial.
  const weakest = ballotLanes.reduce(
    (min, lane) => Math.min(min, BASIS_RANK[lane.basis]),
    BASIS_RANK.certified_results
  );
  if (weakest >= BASIS_RANK.certified_results) {
    return {
      status: "set_certified",
      lanes,
      pendingParties,
      nextEvent,
      statusLabel: "General matchup set; every ballot lane is backed by certified primary results.",
    };
  }
  if (weakest >= BASIS_RANK.unofficial_results) {
    return {
      status: "set_unofficial",
      lanes,
      pendingParties,
      nextEvent,
      statusLabel: "General matchup set from state-reported primary results; certification pending.",
    };
  }
  return {
    status: "set_state_list",
    lanes,
    pendingParties,
    nextEvent,
    statusLabel: "General matchup drawn from the state's published general-candidate list, which the state may still update.",
  };
}

// Coarse status for index cards, computed from statuses alone (no result join).
export function deriveIndexMatchupStatus(
  stateCode: string,
  coverage: "verified_ballot" | "verification_pending" | "fec_only",
  activeStatuses: string[]
): "set" | "partial" | "pending" | "none" {
  if (coverage === "fec_only") return "none";
  const hasNominee = activeStatuses.some(
    (status) =>
      REPORTED_WINNER_STATUSES.has(status) ||
      (GENERAL_LIST_STATUSES.has(status) && !WRITE_IN_STATUSES.has(status))
  );
  const hasPending = activeStatuses.some((status) => PRIMARY_STAGE_STATUSES.has(status));
  const triage = STATE_ELECTION_TRIAGE[stateCode.toUpperCase()];
  if (hasNominee && !hasPending && !triage?.runoffPending) return "set";
  if (hasNominee) return "partial";
  return "pending";
}
