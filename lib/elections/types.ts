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
