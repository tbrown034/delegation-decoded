export type RaceCoverage =
  | "verified_ballot"
  | "verification_pending"
  | "fec_only";

export type RaceCandidate = {
  candidacyId: string;
  personId: string | null;
  name: string;
  party: string | null;
  status: string;
  isActive: boolean;
  ballotLines: string[];
  fecCandidateId: string | null;
  totalReceipts: number | null;
  resultStatus: "unofficial" | "certified" | "complete_no_certification" | null;
  primaryVotes: number | null;
  primaryWinner: boolean | null;
  // Set when the candidate resolves to a member record, so pages hand off to
  // the far richer member page. isIncumbent is true only when that member
  // currently holds the exact seat this contest elects — a sitting member
  // running for a different office links but is not the incumbent here.
  bioguideId: string | null;
  isIncumbent: boolean;
  // Compatibility fields consumed by the established member card and ask
  // tool while those surfaces migrate to the normalized names above.
  candidate_id: string;
  incumbent_challenge: unknown;
  total_receipts: number | null;
  first_file_date: unknown;
  last_file_date: unknown;
};

export type RaceCandidateResult = {
  contestId: string;
  title: string;
  stateCode: string;
  office: "H" | "S";
  district: number | null;
  senateClass: 1 | 2 | 3 | null;
  electionType: "regular" | "special";
  coverage: RaceCoverage;
  sourceKind: "state_election_authority" | "fec_form_2";
  sourceName: string;
  sourceUrl: string;
  certifiedThrough: string | null;
  nextExpectedEvent: string | null;
  coverageNote?: string;
  hasData: boolean;
  candidates: RaceCandidate[];
};

export type StateRaceCoverage = {
  stateCode: string;
  stateName: string;
  coverage: RaceCoverage | "adapter_pending";
  authorityName: string;
  sourceUrl: string;
  adapterKey: string | null;
  lastSuccessAt: string | null;
  nextExpectedEvent: string | null;
  verifiedContests: number;
  totalContests: number;
};

export function stateAuthorityCoverageNote(
  coverage: RaceCoverage,
  candidates: Pick<RaceCandidate, "status">[]
) {
  if (coverage !== "verification_pending") return undefined;
  const statuses = new Set(candidates.map((candidate) => candidate.status));
  if (!statuses.has("state_primary_ballot")) return undefined;
  if (statuses.has("state_general_filing_unofficial")) {
    return "This contest mixes two verification levels. A state_primary_ballot record is verified for the primary ballot. A state_general_filing_unofficial record is provisional filing evidence only and is not verified for the general-election ballot. Do not describe the entire field as provisional.";
  }
  return "A state_primary_ballot record is verified for the primary ballot. Contest-level verification remains pending only for later stages; do not describe these primary ballot records as provisional.";
}
