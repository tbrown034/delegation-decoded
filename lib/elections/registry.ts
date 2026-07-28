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

const delawareIndex = stateSeeds.findIndex((source) => source.stateCode === "DE");
stateSeeds[delawareIndex] = {
  sourceId: "state-de",
  stateCode: "DE",
  authorityName: "Delaware Department of Elections",
  sourceKind: "state_election_authority",
  sourceUrl: "https://elections.delaware.gov/candidates/candidatelist/",
  adapterKey: "delaware-2026",
  coverageStatus: "verification_pending",
  isAuthoritative: true,
  certificationWindowDays: 21,
  nextExpectedEvent: "2026-09-15",
  nextCheckAt: new Date("2026-07-22T00:00:00Z"),
  notes:
    "Current-cycle adapter: state-published qualified and withdrawn federal candidates from the official primary and general lists. Coverage remains verification pending until a ballot or certified result source is available.",
};

const floridaIndex = stateSeeds.findIndex((source) => source.stateCode === "FL");
stateSeeds[floridaIndex] = {
  sourceId: "state-fl",
  stateCode: "FL",
  authorityName: "Florida Department of State, Division of Elections",
  sourceKind: "state_election_authority",
  sourceUrl: "https://dos.elections.myflorida.com/candidates/downloadcanlist.asp",
  adapterKey: "florida-2026",
  coverageStatus: "verification_pending",
  isAuthoritative: true,
  certificationWindowDays: 14,
  nextExpectedEvent: "2026-08-18",
  nextCheckAt: new Date("2026-07-22T00:00:00Z"),
  notes:
    "Current-cycle adapter: the state candidate export supplies federal qualifying status, including unopposed, withdrawn and did-not-qualify records. The tracking system is an unofficial reference, so coverage remains verification pending until official ballots or results are loaded.",
};

const rhodeIslandIndex = stateSeeds.findIndex((source) => source.stateCode === "RI");
stateSeeds[rhodeIslandIndex] = {
  sourceId: "state-ri",
  stateCode: "RI",
  authorityName: "Rhode Island Department of State, Elections Division",
  sourceKind: "state_election_authority",
  sourceUrl: "https://vote.sos.ri.gov/Candidates/CandidateSearch",
  adapterKey: "rhode-island-2026",
  coverageStatus: "verified_ballot",
  isAuthoritative: true,
  certificationWindowDays: 21,
  nextExpectedEvent: "2026-09-09",
  nextCheckAt: new Date("2026-07-22T00:00:00Z"),
  notes:
    "Current-cycle adapter: the official candidate workbook identifies candidates qualified for ballot placement, primary and general ballot inclusion, and later winner status. Structured records exclude the workbook's voter and contact fields.",
};

const nebraskaIndex = stateSeeds.findIndex((source) => source.stateCode === "NE");
stateSeeds[nebraskaIndex] = {
  sourceId: "state-ne",
  stateCode: "NE",
  authorityName: "Nebraska Secretary of State, Elections Division",
  sourceKind: "state_election_authority",
  sourceUrl: "https://sos.nebraska.gov/elections",
  adapterKey: "nebraska-2026",
  coverageStatus: "verified_ballot",
  isAuthoritative: true,
  certificationWindowDays: 27,
  nextExpectedEvent: "2026-11-03",
  nextCheckAt: new Date("2026-07-22T00:00:00Z"),
  notes:
    "Mid-cycle adapter: the current candidate workbook is reconciled against the June 8 certified primary canvass. Machine-readable state result pages supply totals; a separate official certification record proves the petition candidate's general-ballot qualification.",
};

const michiganIndex = stateSeeds.findIndex((source) => source.stateCode === "MI");
stateSeeds[michiganIndex] = {
  sourceId: "state-mi",
  stateCode: "MI",
  authorityName: "Michigan Department of State, Bureau of Elections",
  sourceKind: "state_election_authority",
  sourceUrl: "https://www.michigan.gov/sos/elections",
  adapterKey: "michigan-2026",
  coverageStatus: "verification_pending",
  isAuthoritative: true,
  certificationWindowDays: 14,
  nextExpectedEvent: "2026-08-04",
  nextCheckAt: new Date("2026-07-22T00:00:00Z"),
  notes:
    "Current-cycle adapter: the official August primary report establishes ballot-qualified, withdrawn and disqualified federal candidates. The November report is retained as provisional filing evidence only because the state labels it unofficial.",
};

const washingtonIndex = stateSeeds.findIndex((source) => source.stateCode === "WA");
stateSeeds[washingtonIndex] = {
  sourceId: "state-wa",
  stateCode: "WA",
  authorityName: "Washington Secretary of State, Elections Division",
  sourceKind: "state_election_authority",
  sourceUrl: "https://voter.votewa.gov/CandidateList.aspx?e=898",
  adapterKey: "washington-2026",
  coverageStatus: "verified_ballot",
  isAuthoritative: true,
  certificationWindowDays: 17,
  nextExpectedEvent: "2026-08-04",
  nextCheckAt: new Date("2026-07-22T00:00:00Z"),
  notes:
    "Current-cycle adapter: the official VoteWA list identifies active candidates whose election status is In Primary and retains withdrawn federal filings. Washington uses a top-two primary; listed party values are candidate preferences, not party nominations.",
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
  // Pinned fallback; the adapter discovers the newest dated revision from the
  // candidate-information landing page because the state re-dates the file.
  generalCandidateList:
    "https://www.in.gov/sos/elections/files/2026-General-Candidate-List.7-22-26.pm.xlsx",
  candidateLanding: "https://www.in.gov/sos/elections/candidate-information/",
  primarySettings: "https://enr.indianavoters.in.gov/site/data/settings.json",
  primaryHouseResults:
    "https://enr.indianavoters.in.gov/site/data/OffCatC_1005_A.json",
} as const;

export const DELAWARE_2026_SOURCES = {
  candidateLanding: "https://elections.delaware.gov/candidates/candidatelist/",
  primaryCandidateList:
    "https://elections.delaware.gov/candidates/candidatelist/prim_fcddt_2026.xlsx",
  generalCandidateList:
    "https://elections.delaware.gov/candidates/candidatelist/genl_fcddt_2026.xlsx",
} as const;

export const FLORIDA_2026_SOURCES = {
  candidateLanding: "https://dos.fl.gov/elections/candidates-committees/candidates-campaign-documents-and-committees/",
  candidateDownload: "https://dos.elections.myflorida.com/candidates/downloadcanlist.asp",
  candidateExtract: "https://dos.elections.myflorida.com/candidates/extractCanList.asp",
  senateVacancyLaw: "https://www.flsenate.gov/Laws/Statutes/2025/0100.161",
  primaryCalendar: "https://dos.fl.gov/elections/for-voters/election-dates/",
} as const;

export const RHODE_ISLAND_2026_SOURCES = {
  candidateLanding: "https://vote.sos.ri.gov/Candidates/CandidateSearch",
  candidateWorkbook: "https://vote.sos.ri.gov/Forms/elections/Reports/Candidates.xlsx",
  candidateGuide: "https://vote.sos.ri.gov/Forms/Elections/Guides/2026RunforOffice.pdf",
} as const;

export const NEBRASKA_2026_SOURCES = {
  electionLanding: "https://sos.nebraska.gov/elections",
  currentCandidateWorkbook:
    "https://sos.nebraska.gov/sites/default/files/doc/elections/2026/Statewide_Candidate_Filing_List.xlsx",
  primaryCanvass:
    "https://sos.nebraska.gov/sites/default/files/doc/elections/2026/2026_Primary_Canvass_Book.pdf",
  primaryCertification:
    "https://sos.nebraska.gov/board-state-canvassers-reviews-and-certifies-2026-primary-election-results",
  primaryStatewideResults:
    "https://electionresults.nebraska.gov/resultsSW.aspx?type=SW&map=CTY",
  primaryCongressionalResults:
    "https://electionresults.nebraska.gov/resultsSW.aspx?type=CG&map=DIST",
  petitionCertification:
    "https://sos.nebraska.gov/secretary-state-certifies-dan-osborns-us-senate-candidate-petition",
} as const;

export const MICHIGAN_2026_SOURCES = {
  electionLanding: "https://www.michigan.gov/sos/elections",
  primaryCandidateReport:
    "https://mi-boe.entellitrak.com/etk-mi-boe-prod/page.request.do?electionType=PRI&electionYear=2026&page=page.miboePublicReport",
  generalCandidateReport:
    "https://mi-boe.entellitrak.com/etk-mi-boe-prod/page.request.do?electionType=GEN&electionYear=2026&page=page.miboePublicReport",
} as const;

export const WASHINGTON_2026_SOURCES = {
  electionLanding: "https://www.sos.wa.gov/elections",
  primaryCandidateList: "https://voter.votewa.gov/CandidateList.aspx?e=898",
  electionCalendar: "https://www.sos.wa.gov/elections/calendar?y=2026",
} as const;

export const ELECTION_CALENDAR_AS_OF = "2026-07-23";

// =============================================================================
// 50-state triage registry
//
// The per-state worksheet behind the matchup pipeline. Each entry answers, in
// order: where is the authority site, when is (was) the primary, is a general
// candidate list published, are official results published, and what blocks an
// adapter. Seeded July 23, 2026 from a six-agent source survey; URLs were
// fetch-verified at that time. States already covered by a live adapter point
// at their adapter key. triage drives the nightly resolution queue and the
// needs_trevor escalation board.
// =============================================================================

export type TriageStatus =
  | "adapter_live"          // a full adapter already ingests this state
  | "buildable_structured"  // structured download or JSON endpoint verified
  | "buildable_html"        // stable HTML tables; parseable
  | "blocked_pdf"           // authority publishes PDF only
  | "blocked_portal"        // JS-only portal or export format we cannot parse yet
  | "pre_primary"           // nothing to resolve until the primary happens
  | "needs_trevor";         // human decision or manual fetch required

export type StateElectionTriage = {
  stateCode: string;
  electionSiteUrl: string;
  primaryDate: string;
  primaryHeld: boolean;
  runoffDate?: string;
  runoffRule?: string;
  runoffPending?: boolean;
  generalListUrl?: string;
  generalListFormat?: "xlsx" | "csv" | "txt" | "html" | "pdf" | "portal";
  resultsUrl?: string;
  resultsFormat?: "clarity-json" | "csv" | "xlsx" | "txt" | "html" | "pdf" | "portal" | "zip";
  certifiedAt?: string;
  triage: TriageStatus;
  triageNote: string;
};

export const STATE_ELECTION_TRIAGE: Record<string, StateElectionTriage> = {
  AL: {
    stateCode: "AL",
    electionSiteUrl: "https://www.sos.alabama.gov/alabama-votes/voter/election-information/2026",
    primaryDate: "2026-05-19",
    primaryHeld: true,
    runoffDate: "2026-06-16",
    runoffRule: "majority; runoff held Jun 16",
    resultsUrl: "https://www.alabamavotes.gov/",
    resultsFormat: "portal",
    triage: "blocked_portal",
    triageNote: "May 19 primary certified, but SCOTUS redistricting forced separate Aug 11 special primaries for CDs 1, 2, 6, 7. ENR portal format unverified.",
  },
  AK: {
    stateCode: "AK",
    electionSiteUrl: "https://www.elections.alaska.gov/",
    primaryDate: "2026-08-18",
    primaryHeld: false,
    runoffRule: "top-four advance; RCV general",
    triage: "pre_primary",
    triageNote: "Top-four primary Aug 18; general is RCV. Candidate list on elections.alaska.gov (HTML/PDF).",
  },
  AZ: {
    stateCode: "AZ",
    electionSiteUrl: "https://azsos.gov/elections/election-information/2026-election-info",
    primaryDate: "2026-07-21",
    primaryHeld: true,
    resultsUrl: "https://azsos.gov/elections",
    resultsFormat: "portal",
    certifiedAt: "2026-08-10",
    triage: "buildable_html",
    triageNote: "Voted two days ago; canvass ~Aug 10. XML press feed exists but may need credentials. No Senate race; 9 House.",
  },
  AR: {
    stateCode: "AR",
    electionSiteUrl: "https://www.sos.arkansas.gov/elections",
    primaryDate: "2026-03-03",
    primaryHeld: true,
    runoffDate: "2026-03-31",
    runoffRule: "majority; runoff held Mar 31",
    resultsUrl: "https://enr.totalresults.com/arkansas",
    resultsFormat: "portal",
    triage: "buildable_structured",
    triageNote: "Fully settled. TotalResults ENR portal offers Excel/PDF downloads. 4 House, no Senate.",
  },
  CA: {
    stateCode: "CA",
    electionSiteUrl: "https://www.sos.ca.gov/elections",
    primaryDate: "2026-06-02",
    primaryHeld: true,
    runoffRule: "top-two; general field is exactly the top two per race",
    generalListUrl: "https://elections.cdn.sos.ca.gov/statewide-elections/2026-primary/cert-list-candidates.pdf",
    generalListFormat: "pdf",
    resultsUrl: "https://media.sos.ca.gov/",
    resultsFormat: "txt",
    triage: "buildable_structured",
    triageNote: "Best data portal surveyed: C26DP.txt (candidates), V26DP.txt (votes), R26DP.txt (contests) plus XLSX statement of vote. Certified. 52 House, no Senate.",
  },
  CO: {
    stateCode: "CO",
    electionSiteUrl: "https://www.sos.state.co.us/pubs/elections/",
    primaryDate: "2026-06-30",
    primaryHeld: true,
    resultsUrl: "https://results.enr.clarityelections.com/CO",
    resultsFormat: "clarity-json",
    certifiedAt: "2026-07-22",
    triage: "buildable_structured",
    triageNote: "Clarity ENR with JSON endpoints. Canvass deadline was Jul 22. Senate (Hickenlooper) + 8 House.",
  },
  CT: {
    stateCode: "CT",
    electionSiteUrl: "https://portal.ct.gov/sots/election-services",
    primaryDate: "2026-08-11",
    primaryHeld: false,
    triage: "pre_primary",
    triageNote: "Convention-endorsement system; 18 primaries confirmed for Aug 11. Endorsements published as PDFs. 5 House, no Senate.",
  },
  DE: {
    stateCode: "DE",
    electionSiteUrl: "https://elections.delaware.gov/",
    primaryDate: "2026-09-15",
    primaryHeld: false,
    generalListUrl: DELAWARE_2026_SOURCES.generalCandidateList,
    generalListFormat: "xlsx",
    triage: "adapter_live",
    triageNote: "delaware-2026 adapter ingests primary and general lists daily.",
  },
  FL: {
    stateCode: "FL",
    electionSiteUrl: "https://dos.fl.gov/elections/",
    primaryDate: "2026-08-18",
    primaryHeld: false,
    resultsUrl: "https://dos.elections.myflorida.com/candidates/downloadcanlist.asp",
    resultsFormat: "txt",
    triage: "adapter_live",
    triageNote: "florida-2026 adapter ingests the candidate export daily; unopposed records already imply nominees.",
  },
  GA: {
    stateCode: "GA",
    electionSiteUrl: "https://sos.ga.gov/elections-division-georgia-secretary-states-office",
    primaryDate: "2026-05-19",
    primaryHeld: true,
    runoffDate: "2026-06-16",
    runoffRule: "majority; primary runoff held Jun 16; general runoff Dec 1 if triggered",
    resultsUrl: "https://results.sos.ga.gov/results/public/Georgia",
    resultsFormat: "clarity-json",
    triage: "buildable_structured",
    triageNote: "Clarity ENR JSON verified. Candidate-list portal is JS-heavy Salesforce (blocked) but results establish winners. Open Senate (Ossoff) + 14 House.",
  },
  HI: {
    stateCode: "HI",
    electionSiteUrl: "https://elections.hawaii.gov/",
    primaryDate: "2026-08-08",
    primaryHeld: false,
    triage: "pre_primary",
    triageNote: "2 House, no Senate. Candidate reports portal updated through Jul 6.",
  },
  ID: {
    stateCode: "ID",
    electionSiteUrl: "https://voteidaho.gov/",
    primaryDate: "2026-05-19",
    primaryHeld: true,
    certifiedAt: "2026-06-09",
    resultsUrl: "https://voteidaho.gov/election-results/",
    resultsFormat: "portal",
    triage: "buildable_html",
    triageNote: "Certified Jun 9. VoteIdaho portal format needs confirmation. Senate (Risch) + 2 House.",
  },
  IL: {
    stateCode: "IL",
    electionSiteUrl: "https://www.elections.il.gov/",
    primaryDate: "2026-03-17",
    primaryHeld: true,
    resultsUrl: "https://www.elections.il.gov/electionoperations/DownloadVoteTotals.aspx",
    resultsFormat: "xlsx",
    triage: "buildable_structured",
    triageNote: "Certified. Dedicated vote-totals download page. Open Senate (Durbin seat; Stratton won D primary) + 17 House.",
  },
  IN: {
    stateCode: "IN",
    electionSiteUrl: "https://www.in.gov/sos/elections/",
    primaryDate: "2026-05-05",
    primaryHeld: true,
    generalListUrl: "https://www.in.gov/sos/elections/files/2026-General-Candidate-List.7-22-26.pm.xlsx",
    generalListFormat: "xlsx",
    resultsUrl: "https://enr.indianavoters.in.gov/site/index.html",
    resultsFormat: "portal",
    triage: "adapter_live",
    triageNote: "indiana-2026 adapter live. State publishes a dated general candidate list xlsx (7-22-26 revision verified locally); the list self-describes as updatable, so matchups cite it as a state list, not a certified ballot.",
  },
  IA: {
    stateCode: "IA",
    electionSiteUrl: "https://sos.iowa.gov/",
    primaryDate: "2026-06-02",
    primaryHeld: true,
    certifiedAt: "2026-06-29",
    resultsUrl: "https://sos.iowa.gov/iowans/election-results-statistics",
    resultsFormat: "html",
    triage: "buildable_html",
    triageNote: "Canvassed ~Jun 29. SoS site returns 403 to plain fetches; may need county aggregation. Senate (Ernst) + 4 House.",
  },
  KS: {
    stateCode: "KS",
    electionSiteUrl: "https://sos.ks.gov/elections/",
    primaryDate: "2026-08-04",
    primaryHeld: false,
    triage: "pre_primary",
    triageNote: "Primary in 12 days. Senate (Marshall) + 4 House. Candidate page 403s to plain fetches.",
  },
  KY: {
    stateCode: "KY",
    electionSiteUrl: "https://elect.ky.gov/",
    primaryDate: "2026-05-19",
    primaryHeld: true,
    resultsUrl: "https://elect.ky.gov/results",
    resultsFormat: "pdf",
    triage: "blocked_pdf",
    triageNote: "Certified results are PDF-only; live portal 403s. Open Senate (McConnell retiring) + 6 House — high value, hard access.",
  },
  LA: {
    stateCode: "LA",
    electionSiteUrl: "https://www.sos.la.gov/ElectionsAndVoting",
    primaryDate: "2026-05-16",
    primaryHeld: true,
    runoffDate: "2026-06-27",
    runoffRule: "Senate: partisan primary with majority runoff (held). House: Nov 3 all-candidate primary; Dec 12 runoff if no majority.",
    resultsUrl: "https://www.sos.la.gov/ElectionsAndVoting/Pages/ElectionResults.aspx",
    resultsFormat: "html",
    triage: "buildable_html",
    triageNote: "Split system: Senate nominees settled (Letlow/Fleming runoff done); House qualifying is Aug 5-7 and every qualifier appears on the Nov 3 ballot.",
  },
  ME: {
    stateCode: "ME",
    electionSiteUrl: "https://www.maine.gov/sos/elections-voting",
    primaryDate: "2026-06-09",
    primaryHeld: true,
    runoffRule: "RCV in place of runoffs; tabulation completed ~Jun 18",
    resultsUrl: "https://www.maine.gov/sos/elections-voting/election-results-data/",
    resultsFormat: "xlsx",
    triage: "buildable_structured",
    triageNote: "Excel downloads per race plus RCV round reports. Senate primary winner later withdrew — expect a replacement/presumptive edge case. Senate (Collins) + 2 House.",
  },
  MD: {
    stateCode: "MD",
    electionSiteUrl: "https://elections.maryland.gov/",
    primaryDate: "2026-06-23",
    primaryHeld: true,
    certifiedAt: "2026-07-23",
    resultsUrl: "https://elections.maryland.gov/elections/2026/primary_results/index.html",
    resultsFormat: "html",
    triage: "buildable_html",
    triageNote: "Certified today (Jul 23). Stable per-district HTML result tables at predictable URLs. 8 House, no Senate.",
  },
  MA: {
    stateCode: "MA",
    electionSiteUrl: "https://www.sec.state.ma.us/divisions/elections/elections-and-voting.htm",
    primaryDate: "2026-09-01",
    primaryHeld: false,
    generalListUrl: "https://www.sec.state.ma.us/divisions/elections/research-and-statistics/candidates2026.htm",
    generalListFormat: "html",
    triage: "pre_primary",
    triageNote: "Primary Sep 1. Candidate pages published (HTML). Senate primary is Markey vs Moulton + 9 House.",
  },
  MI: {
    stateCode: "MI",
    electionSiteUrl: "https://www.michigan.gov/sos/elections",
    primaryDate: "2026-08-04",
    primaryHeld: false,
    generalListUrl: MICHIGAN_2026_SOURCES.generalCandidateReport,
    generalListFormat: "portal",
    triage: "adapter_live",
    triageNote: "michigan-2026 adapter live. Primary Aug 4; open Senate (Peters) + 13 House. Results ingestion activates post-primary.",
  },
  MN: {
    stateCode: "MN",
    electionSiteUrl: "https://www.sos.state.mn.us/elections-voting/",
    primaryDate: "2026-08-11",
    primaryHeld: false,
    generalListUrl: "https://candidates.sos.mn.gov/",
    generalListFormat: "txt",
    triage: "pre_primary",
    triageNote: "Candidate filings downloadable as text files now (layout documented). Primary Aug 11. Senate (Smith) + 8 House.",
  },
  MS: {
    stateCode: "MS",
    electionSiteUrl: "https://www.sos.ms.gov/elections-voting",
    primaryDate: "2026-03-10",
    primaryHeld: true,
    runoffDate: "2026-04-07",
    runoffRule: "majority; runoff held Apr 7",
    generalListUrl: "https://www.sos.ms.gov/elections-voting/candidate-qualifying-list",
    generalListFormat: "html",
    resultsUrl: "https://www.sos.ms.gov/elections-voting/election-results",
    resultsFormat: "html",
    triage: "buildable_html",
    triageNote: "Earliest fully-settled state (Mar 10 + Apr 7 runoff). HTML qualifying list updated daily. Senate (Hyde-Smith) + 4 House.",
  },
  MO: {
    stateCode: "MO",
    electionSiteUrl: "https://www.sos.mo.gov/elections",
    primaryDate: "2026-08-04",
    primaryHeld: false,
    triage: "pre_primary",
    triageNote: "Primary Aug 4. Candidate portal 403s to plain fetches. 8 House, no Senate.",
  },
  MT: {
    stateCode: "MT",
    electionSiteUrl: "https://sosmt.gov/elections/",
    primaryDate: "2026-06-02",
    primaryHeld: true,
    certifiedAt: "2026-06-24",
    resultsUrl: "https://electionresults.mt.gov/ResultsExport.aspx",
    resultsFormat: "portal",
    triage: "buildable_structured",
    triageNote: "Certified Jun 24 with a structured export endpoint. Senate (Daines) + 2 House.",
  },
  NE: {
    stateCode: "NE",
    electionSiteUrl: "https://sos.nebraska.gov/elections",
    primaryDate: "2026-05-12",
    primaryHeld: true,
    certifiedAt: "2026-06-08",
    resultsUrl: NEBRASKA_2026_SOURCES.primaryCongressionalResults,
    resultsFormat: "html",
    triage: "adapter_live",
    triageNote: "nebraska-2026 adapter live with certified canvass; matchups are certifiable today.",
  },
  NV: {
    stateCode: "NV",
    electionSiteUrl: "https://www.nvsos.gov/sos/elections",
    primaryDate: "2026-06-09",
    primaryHeld: true,
    certifiedAt: "2026-06-18",
    resultsUrl: "https://www.nvsos.gov/electionresults/",
    resultsFormat: "csv",
    triage: "buildable_structured",
    triageNote: "Certified Jun 18; precinct CSV/Excel export confirmed. 4 House, no Senate.",
  },
  NH: {
    stateCode: "NH",
    electionSiteUrl: "https://www.sos.nh.gov/elections",
    primaryDate: "2026-09-08",
    primaryHeld: false,
    triage: "pre_primary",
    triageNote: "Latest primary in the country (Sep 8). Open Senate (Shaheen) + 2 House. Historic results HTML-only.",
  },
  NJ: {
    stateCode: "NJ",
    electionSiteUrl: "https://www.nj.gov/state/elections/election-information-2026.shtml",
    primaryDate: "2026-06-02",
    primaryHeld: true,
    generalListUrl: "https://www.nj.gov/state/elections/election-information-2026.shtml",
    generalListFormat: "pdf",
    triage: "blocked_pdf",
    triageNote: "Candidate lists are PDF-only. Senate (Booker) + 12 House. Needs PDF parsing or manual assist.",
  },
  NM: {
    stateCode: "NM",
    electionSiteUrl: "https://www.sos.nm.gov/voting-and-elections/",
    primaryDate: "2026-06-02",
    primaryHeld: true,
    certifiedAt: "2026-06-23",
    resultsUrl: "https://www.sos.nm.gov/voting-and-elections/election-results/",
    resultsFormat: "html",
    triage: "buildable_html",
    triageNote: "Canvass board certified Jun 23; results page format unverified (fetch 404ed on one path). Senate (Lujan) + 3 House.",
  },
  NY: {
    stateCode: "NY",
    electionSiteUrl: "https://elections.ny.gov/",
    primaryDate: "2026-06-23",
    primaryHeld: true,
    resultsUrl: "https://elections.ny.gov/election-results",
    resultsFormat: "pdf",
    triage: "needs_trevor",
    triageNote: "Fusion voting (multi-line candidacies) + 215-page certification PDF + separate NYC BOE. Needs a design pass before building. 26 House, no Senate.",
  },
  NC: {
    stateCode: "NC",
    electionSiteUrl: "https://www.ncsbe.gov/",
    primaryDate: "2026-03-03",
    primaryHeld: true,
    runoffDate: "2026-05-12",
    runoffRule: "30% threshold; runoff held May 12",
    generalListUrl: "https://s3.amazonaws.com/dl.ncsbe.gov/Elections/2026/Candidate%20Filing/Candidate_Listing_2026.csv",
    generalListFormat: "csv",
    resultsUrl: "https://er.ncsbe.gov/?election_dt=03%2F03%2F2026",
    resultsFormat: "portal",
    certifiedAt: "2026-04-15",
    triage: "buildable_structured",
    triageNote: "Gold standard: candidate CSV on S3, certified results. Open Senate (Tillis seat) + 14 House.",
  },
  ND: {
    stateCode: "ND",
    electionSiteUrl: "https://vip.sos.nd.gov/",
    primaryDate: "2026-06-09",
    primaryHeld: true,
    certifiedAt: "2026-06-25",
    resultsUrl: "https://resultsnd.sos.nd.gov/",
    resultsFormat: "portal",
    triage: "buildable_html",
    triageNote: "Certified Jun 25. One at-large House seat, no Senate — low effort, low volume.",
  },
  OH: {
    stateCode: "OH",
    electionSiteUrl: "https://www.ohiosos.gov/elections/",
    primaryDate: "2026-05-05",
    primaryHeld: true,
    certifiedAt: "2026-06-03",
    resultsUrl: "https://www.ohiosos.gov/elections/election-results-and-data/",
    resultsFormat: "html",
    triage: "buildable_html",
    triageNote: "Certified Jun 3. 15 House, no Senate. Historically publishes downloadable county data.",
  },
  OK: {
    stateCode: "OK",
    electionSiteUrl: "https://oklahoma.gov/elections.html",
    primaryDate: "2026-06-16",
    primaryHeld: true,
    runoffDate: "2026-08-25",
    runoffRule: "majority; Senate-D and CD1-R runoffs pending Aug 25",
    runoffPending: true,
    resultsUrl: "https://results.okelections.us/",
    resultsFormat: "zip",
    triage: "blocked_portal",
    triageNote: "Two federal nominations wait on the Aug 25 runoff. Export is compressed DBMS files, not CSV. Senate (Mullin) + 5 House.",
  },
  OR: {
    stateCode: "OR",
    electionSiteUrl: "https://sos.oregon.gov/elections/",
    primaryDate: "2026-05-19",
    primaryHeld: true,
    runoffRule: "top-two: exactly two general candidates per race",
    certifiedAt: "2026-06-12",
    resultsUrl: "https://results.oregonvotes.gov/",
    resultsFormat: "html",
    triage: "buildable_html",
    triageNote: "Certified. Top-two locks the general field at exactly 2 per race — simplest matchup shape. Senate (Merkley) + 6 House.",
  },
  PA: {
    stateCode: "PA",
    electionSiteUrl: "https://www.electionreturns.pa.gov/",
    primaryDate: "2026-05-19",
    primaryHeld: true,
    certifiedAt: "2026-07-17",
    resultsUrl: "https://www.electionreturns.pa.gov/",
    resultsFormat: "html",
    triage: "buildable_html",
    triageNote: "Certified Jul 17 (six days ago). Report center is parseable HTML; a 2026 data download is listed as coming. 17 House, no Senate.",
  },
  SC: {
    stateCode: "SC",
    electionSiteUrl: "https://scvotes.gov/",
    primaryDate: "2026-06-09",
    primaryHeld: true,
    runoffDate: "2026-06-23",
    runoffRule: "majority; runoff held Jun 23",
    certifiedAt: "2026-06-27",
    resultsUrl: "https://scvotes.gov/elections/election-results/",
    resultsFormat: "portal",
    triage: "buildable_html",
    triageNote: "Primary + runoff done, certified ~Jun 27. Candidate list is a search form. Senate (Graham) + 7 House incl. open CD1.",
  },
  SD: {
    stateCode: "SD",
    electionSiteUrl: "https://sdsos.gov/elections-voting/",
    primaryDate: "2026-06-02",
    primaryHeld: true,
    certifiedAt: "2026-06-10",
    generalListUrl: "https://vip.sdsos.gov/candidatelist.aspx?eid=774",
    generalListFormat: "html",
    resultsUrl: "https://electionresults.sd.gov/",
    resultsFormat: "portal",
    triage: "buildable_html",
    triageNote: "Certified. Sortable web candidate table. Open Senate (Rounds seat) + 1 House — good low-effort test case.",
  },
  TN: {
    stateCode: "TN",
    electionSiteUrl: "https://sos.tn.gov/elections",
    primaryDate: "2026-08-06",
    primaryHeld: false,
    triage: "pre_primary",
    triageNote: "Primary Aug 6. Candidate list page 403s; GoVoteTN ballot list is parseable HTML. Senate (Hagerty) + 9 House.",
  },
  TX: {
    stateCode: "TX",
    electionSiteUrl: "https://www.sos.state.tx.us/elections/",
    primaryDate: "2026-03-03",
    primaryHeld: true,
    runoffDate: "2026-05-26",
    runoffRule: "majority; runoff held May 26",
    resultsUrl: "https://electionresults.sos.state.tx.us/results.html",
    resultsFormat: "html",
    triage: "buildable_html",
    triageNote: "Primary + runoff complete; every nominee known (Paxton vs Talarico Senate + 38 House). Candidate portal is JS-only but the results page is stable HTML. Highest-value single state.",
  },
  UT: {
    stateCode: "UT",
    electionSiteUrl: "https://vote.utah.gov/",
    primaryDate: "2026-06-23",
    primaryHeld: true,
    certifiedAt: "2026-07-15",
    generalListUrl: "https://vote.utah.gov/wp-content/uploads/2026/07/2026-Primary-Election-Certification.pdf",
    generalListFormat: "pdf",
    resultsUrl: "https://vote.utah.gov/",
    resultsFormat: "pdf",
    triage: "blocked_pdf",
    triageNote: "PDF-only for both lists and results, plus the convention/signature dual path (a candidate can be nominated without a primary). 4 House, no Senate.",
  },
  VT: {
    stateCode: "VT",
    electionSiteUrl: "https://sos.vermont.gov/elections/",
    primaryDate: "2026-08-11",
    primaryHeld: false,
    triage: "pre_primary",
    triageNote: "1 at-large House seat, no Senate. Candidate database exists online; format unverified.",
  },
  VA: {
    stateCode: "VA",
    electionSiteUrl: "https://www.elections.virginia.gov/",
    primaryDate: "2026-08-04",
    primaryHeld: false,
    generalListUrl: "https://www.elections.virginia.gov/casting-a-ballot/candidate-list",
    generalListFormat: "pdf",
    resultsUrl: "https://www.elections.virginia.gov/resultsreports/election-results/",
    resultsFormat: "csv",
    triage: "pre_primary",
    triageNote: "Primary Aug 4 (Warner Senate + 11 House). Candidate list is a final PDF; results publish as CSV — build the adapter now, activate post-primary.",
  },
  WA: {
    stateCode: "WA",
    electionSiteUrl: "https://www.sos.wa.gov/elections",
    primaryDate: "2026-08-04",
    primaryHeld: false,
    runoffRule: "top-two; party values are candidate preferences",
    generalListUrl: WASHINGTON_2026_SOURCES.primaryCandidateList,
    generalListFormat: "portal",
    triage: "adapter_live",
    triageNote: "washington-2026 adapter live with the official top-two primary ballot. General field forms after Aug 4.",
  },
  WV: {
    stateCode: "WV",
    electionSiteUrl: "https://sos.wv.gov/elections/",
    primaryDate: "2026-05-12",
    primaryHeld: true,
    certifiedAt: "2026-06-10",
    resultsUrl: "https://results.enr.clarityelections.com/WV/126209",
    resultsFormat: "clarity-json",
    triage: "buildable_structured",
    triageNote: "Clarity ENR JSON confirmed; certified Jun 10 by all 55 counties. Senate (Capito) + 2 House — easiest Clarity pilot.",
  },
  WI: {
    stateCode: "WI",
    electionSiteUrl: "https://elections.wi.gov/",
    primaryDate: "2026-08-11",
    primaryHeld: false,
    triage: "pre_primary",
    triageNote: "Primary Aug 11. Decentralized (72 county clerks); state publishes a post-certification ZIP archive. 8 House, no Senate.",
  },
  WY: {
    stateCode: "WY",
    electionSiteUrl: "https://sos.wyo.gov/Elections/2026ElectionInformation.aspx",
    primaryDate: "2026-08-18",
    primaryHeld: false,
    generalListUrl: "https://sos.wyo.gov/Elections/Docs/2026/2026_WY_Primary_Election_Candidates.pdf",
    generalListFormat: "pdf",
    triage: "pre_primary",
    triageNote: "Primary Aug 18. Primary roster published now as PDF and Excel. Open Senate (Lummis seat) + 1 House.",
  },
  DC: {
    stateCode: "DC",
    electionSiteUrl: "https://dcboe.org/",
    primaryDate: "2026-06-16",
    primaryHeld: true,
    runoffRule: "RCV (first use)",
    certifiedAt: "2026-07-17",
    resultsUrl: "https://electionresults.dcboe.org/election_results/2026-Primary-Election",
    resultsFormat: "portal",
    triage: "needs_trevor",
    triageNote: "Delegate race decided by RCV rounds (Robert White won D primary). Round-by-round parsing for one non-voting seat — deferred.",
  },
};
