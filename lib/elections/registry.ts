import { STATES } from "../states";

export const FEC_STATE_OFFICE_DIRECTORY =
  "https://www.fec.gov/help-candidates-and-committees/state-election-offices/";
export const FEC_2026_CALENDAR =
  "https://www.fec.gov/resources/cms-content/documents/2026pdates.pdf";

const UPCOMING_2026_EVENTS: Partial<Record<string, string>> = {
  AZ: "2026-07-21",
  SD: "2026-07-28",
  GU: "2026-08-01",
  VI: "2026-08-01",
  KS: "2026-08-04",
  MI: "2026-08-04",
  MO: "2026-08-04",
  WA: "2026-08-04",
  TN: "2026-08-06",
  HI: "2026-08-08",
  AL: "2026-08-11",
  CT: "2026-08-11",
  MN: "2026-08-11",
  VT: "2026-08-11",
  WI: "2026-08-11",
  AK: "2026-08-18",
  FL: "2026-08-18",
  WY: "2026-08-18",
  OK: "2026-08-25",
  MA: "2026-09-01",
  NH: "2026-09-08",
  RI: "2026-09-09",
  DE: "2026-09-15",
  LA: "2026-11-03",
};

export type ElectionSourceSeed = {
  sourceId: string;
  stateCode: string | null;
  authorityName: string;
  sourceKind: string;
  sourceUrl: string;
  adapterKey: string | null;
  coverageStatus: "verified_ballot" | "verification_pending" | "adapter_pending" | "fec_only";
  isAuthoritative: boolean;
  certificationWindowDays: number | null;
  nextExpectedEvent: string | null;
  nextCheckAt: Date | null;
  notes: string | null;
};

const stateSeeds: ElectionSourceSeed[] = STATES.map((state) => ({
  sourceId: `state-${state.code.toLowerCase()}`,
  stateCode: state.code,
  authorityName: `${state.name} election authority`,
  sourceKind: "state_election_authority",
  sourceUrl: FEC_STATE_OFFICE_DIRECTORY,
  adapterKey: null,
  coverageStatus: "adapter_pending",
  isAuthoritative: false,
  certificationWindowDays: 21,
  nextExpectedEvent: UPCOMING_2026_EVENTS[state.code] ?? "2026-11-03",
  nextCheckAt: null,
  notes:
    "Adapter pending. The FEC directory is the discovery source; FEC filings remain the labeled fallback until a state source is verified.",
}));

const indianaIndex = stateSeeds.findIndex((source) => source.stateCode === "IN");
stateSeeds[indianaIndex] = {
  sourceId: "state-in",
  stateCode: "IN",
  authorityName: "Indiana Secretary of State, Election Division",
  sourceKind: "state_election_authority",
  sourceUrl: "https://www.in.gov/sos/elections/candidate-information/",
  adapterKey: "indiana-2026",
  coverageStatus: "verification_pending",
  isAuthoritative: true,
  certificationWindowDays: 14,
  nextExpectedEvent: "2026-11-03",
  nextCheckAt: new Date("2026-07-22T00:00:00Z"),
  notes:
    "Mid-cycle adapter: state-published general candidate list plus the statewide primary result feed. The result feed's Certified flag controls result labels.",
};

export const ELECTION_SOURCE_REGISTRY: ElectionSourceSeed[] = [
  {
    sourceId: "fec-form2",
    stateCode: null,
    authorityName: "Federal Election Commission",
    sourceKind: "fec_form_2",
    sourceUrl: "https://www.fec.gov/data/candidates/",
    adapterKey: "fec-form2",
    coverageStatus: "fec_only",
    isAuthoritative: false,
    certificationWindowDays: null,
    nextExpectedEvent: null,
    nextCheckAt: new Date("2026-07-22T00:00:00Z"),
    notes: "Campaign-finance filing source only. A Form 2 does not establish ballot access.",
  },
  ...stateSeeds,
];

export const INDIANA_2026_SOURCES = {
  generalCandidateList:
    "https://www.in.gov/sos/elections/files/2026-General-Candidate-List.7-6-26.pm.xlsx",
  candidateLanding: "https://www.in.gov/sos/elections/candidate-information/",
  primarySettings: "https://enr.indianavoters.in.gov/site/data/settings.json",
  primaryHouseResults:
    "https://enr.indianavoters.in.gov/site/data/OffCatC_1005_A.json",
} as const;

export const ELECTION_CALENDAR_AS_OF = "2026-05-18";
