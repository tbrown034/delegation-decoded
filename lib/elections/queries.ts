import { sql } from "drizzle-orm";
import { db } from "../db";
import { STATE_BY_CODE, STATES } from "../states";
import {
  ELECTION_SOURCE_REGISTRY,
  FEC_STATE_OFFICE_DIRECTORY,
} from "./registry";
import { houseContestId, parseContestId, senateContestId } from "./ids";
import {
  regularSenateClassForElectionYear,
  type MemberSeat,
} from "./member-seat";
import type { RaceCandidateResult, StateRaceCoverage } from "./types";

export type SenateRaceIdentity = {
  senateClass: 1 | 2 | 3;
  electionType: "regular" | "special";
};

type RawRaceCandidate = {
  candidacy_id: string;
  person_id: string;
  name: string;
  party: string | null;
  current_status: string;
  is_active: boolean;
  fec_candidate_id: string | null;
  total_receipts: number | null;
  ballot_lines: string[] | null;
  total_votes: number | null;
  is_winner: boolean | null;
  result_status: "unofficial" | "certified" | "complete_no_certification" | null;
};

const CLASS_TWO_STATES = new Set([
  "AL", "AK", "AR", "CO", "DE", "GA", "ID", "IL", "IA", "KS", "KY",
  "LA", "ME", "MA", "MI", "MN", "MS", "MT", "NE", "NH", "NJ", "NM",
  "NC", "OK", "OR", "RI", "SC", "SD", "TN", "TX", "VA", "WV", "WY",
]);

function isMissingElectionSchema(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const record = current as { code?: string; message?: string; cause?: unknown };
    if (record.code === "42P01") return true;
    current = record.cause;
  }
  return false;
}

function fecCandidateUrl(stateCode: string, office: "H" | "S", district: number | null) {
  const params = new URLSearchParams({
    election_year: "2026",
    state: stateCode,
    office,
  });
  if (office === "H" && district != null) params.set("district", String(district).padStart(2, "0"));
  return `https://www.fec.gov/data/candidates/?${params.toString()}`;
}

function mapVerifiedCandidate(row: RawRaceCandidate) {
  return {
    candidacyId: row.candidacy_id,
    personId: row.person_id,
    name: row.name,
    party: row.party,
    status: row.current_status,
    isActive: row.is_active,
    ballotLines: row.ballot_lines ?? [],
    fecCandidateId: row.fec_candidate_id,
    totalReceipts: row.total_receipts == null ? null : Number(row.total_receipts),
    resultStatus: row.result_status,
    primaryVotes: row.total_votes == null ? null : Number(row.total_votes),
    primaryWinner: row.is_winner,
    // Compatibility fields for the existing member race card.
    candidate_id: row.fec_candidate_id ?? row.candidacy_id,
    incumbent_challenge: null,
    total_receipts: row.total_receipts == null ? null : Number(row.total_receipts),
    first_file_date: null,
    last_file_date: null,
  };
}

async function getStateAuthorityRace(
  stateCode: string,
  office: "H" | "S",
  district: number | null,
  electionYear: number,
  includeInactive = false,
  senateRace?: SenateRaceIdentity
) {
  const expectedSenateClass =
    senateRace?.senateClass ?? regularSenateClassForElectionYear(electionYear);
  const expectedElectionType = senateRace?.electionType ?? "regular";
  const contestResult = await db.execute(sql`
    SELECT c.contest_id, c.title, c.state_code, c.office, c.district,
           c.senate_class, c.election_type, c.coverage_status,
           c.certified_through, c.next_expected_event,
           s.authority_name, s.source_url, s.source_kind
    FROM election_contests c
    JOIN election_sources s ON s.source_id = c.primary_source_id
    WHERE c.election_cycle = ${electionYear}
      AND c.state_code = ${stateCode}
      AND c.office = ${office}
      AND (
        (${office} = 'H' AND c.district IS NOT DISTINCT FROM ${district}) OR
        (${office} = 'S' AND c.senate_class = ${expectedSenateClass}
          AND c.election_type = ${expectedElectionType})
      )
    ORDER BY CASE c.coverage_status WHEN 'verified_ballot' THEN 1 WHEN 'verification_pending' THEN 2 ELSE 3 END
    LIMIT 1
  `);
  const contest = contestResult.rows[0] as
    | {
        contest_id: string;
        title: string;
        state_code: string;
        office: "H" | "S";
        district: number | null;
        senate_class: 1 | 2 | 3 | null;
        election_type: "regular" | "special";
        coverage_status: "verified_ballot" | "verification_pending" | "fec_only";
        certified_through: string | null;
        next_expected_event: string | null;
        authority_name: string;
        source_url: string;
      }
    | undefined;
  if (!contest || contest.coverage_status === "fec_only") return null;

  const candidateResult = await db.execute(sql`
    SELECT ca.candidacy_id, ca.person_id, p.display_name AS name, ca.party,
           ca.current_status, ca.is_active, ca.fec_candidate_id,
           fec.total_receipts,
           ARRAY(
             SELECT bl.party_label
             FROM candidacy_ballot_lines bl
             WHERE bl.candidacy_id = ca.candidacy_id
             ORDER BY bl.ballot_order NULLS LAST, bl.party_label
           ) AS ballot_lines,
           primary_result.total_votes, primary_result.is_winner,
           primary_result.result_status
    FROM candidacies ca
    JOIN candidate_people p ON p.person_id = ca.person_id
    LEFT JOIN election_candidates fec ON fec.candidate_id = ca.fec_candidate_id
    LEFT JOIN LATERAL (
      SELECT r.total_votes, r.is_winner, r.result_status
      FROM election_results r
      JOIN election_stages st ON st.stage_id = r.stage_id
      WHERE r.candidacy_id = ca.candidacy_id AND st.stage_kind = 'primary'
      ORDER BY st.election_date DESC, st.sequence_number DESC
      LIMIT 1
    ) primary_result ON true
    WHERE ca.contest_id = ${contest.contest_id}
      AND (${includeInactive} OR ca.is_active = true)
    ORDER BY ca.is_active DESC, primary_result.is_winner DESC NULLS LAST,
             fec.total_receipts DESC NULLS LAST, p.display_name
  `);
  const candidates = (candidateResult.rows as RawRaceCandidate[]).map(mapVerifiedCandidate);
  return {
    contestId: contest.contest_id,
    title: contest.title,
    stateCode: contest.state_code,
    office: contest.office,
    district: contest.district,
    senateClass: contest.senate_class,
    electionType: contest.election_type,
    coverage: contest.coverage_status,
    sourceKind: "state_election_authority" as const,
    sourceName: contest.authority_name,
    sourceUrl: contest.source_url,
    certifiedThrough: contest.certified_through,
    nextExpectedEvent: contest.next_expected_event,
    hasData: candidates.length > 0,
    candidates,
  };
}

async function getFecRace(
  stateCode: string,
  office: "H" | "S",
  district: number | null,
  electionYear: number,
  senateRace?: SenateRaceIdentity
): Promise<RaceCandidateResult> {
  const regularClass = regularSenateClassForElectionYear(electionYear);
  const senateClass = senateRace?.senateClass ?? regularClass;
  const electionType = senateRace?.electionType ?? "regular";
  const exactFecAttributionAvailable =
    office === "H" ||
    (electionType === "regular" && senateClass === regularClass);
  const rows = await db.execute(sql`
    SELECT candidate_id, name, party, office, state_code, district,
           incumbent_challenge, total_receipts, first_file_date, last_file_date
    FROM election_candidates
    WHERE state_code = ${stateCode}
      AND office = ${office}
      AND election_year = ${electionYear}
      AND (${office} = 'S' OR district IS NOT DISTINCT FROM ${district})
    ORDER BY total_receipts DESC NULLS LAST, name ASC
  `);
  const total = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM election_candidates
    WHERE election_year = ${electionYear} AND office = ${office}
  `);
  const state = STATE_BY_CODE[stateCode];
  const contestId = office === "H"
    ? houseContestId(stateCode, district ?? 0, electionYear)
    : senateContestId(
        stateCode,
        senateClass ?? regularClass ?? 2,
        electionType,
        electionYear
      );
  const candidates = exactFecAttributionAvailable
    ? (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    candidacyId: `fec-${row.candidate_id as string}`,
    personId: null,
    name: row.name as string,
    party: row.party as string | null,
    status:
      row.incumbent_challenge === "I"
        ? "filed_as_incumbent"
        : row.incumbent_challenge === "O"
          ? "open_seat_filer"
          : "fec_filer",
    isActive: true,
    ballotLines: [],
    fecCandidateId: row.candidate_id as string,
    totalReceipts: row.total_receipts == null ? null : Number(row.total_receipts),
    resultStatus: null,
    primaryVotes: null,
    primaryWinner: null,
    candidate_id: row.candidate_id as string,
    incumbent_challenge: row.incumbent_challenge,
    total_receipts: row.total_receipts == null ? null : Number(row.total_receipts),
    first_file_date: row.first_file_date,
    last_file_date: row.last_file_date,
      }))
    : [];
  const resolvedSenateClass = office === "S" ? senateClass : null;
  return {
    contestId,
    title:
      office === "S"
        ? `${state?.name ?? stateCode} U.S. Senate, Class ${resolvedSenateClass}${electionType === "special" ? " special election" : ""}`
        : `${state?.name ?? stateCode} U.S. House ${district ? `District ${district}` : "At-Large"}`,
    stateCode,
    office,
    district,
    senateClass: resolvedSenateClass,
    electionType,
    coverage: "fec_only",
    sourceKind: "fec_form_2",
    sourceName: "Federal Election Commission",
    sourceUrl: fecCandidateUrl(stateCode, office, district),
    certifiedThrough: null,
    nextExpectedEvent: null,
    coverageNote: exactFecAttributionAvailable
      ? undefined
      : "The current FEC fallback cannot safely distinguish filers for this special Senate election from the state's other Senate contest, so it is withheld.",
    hasData:
      exactFecAttributionAvailable &&
      Number((total.rows[0] as { n?: number } | undefined)?.n ?? 0) > 0,
    candidates,
  };
}

export async function getRaceCandidates(
  stateCodeInput: string,
  office: "H" | "S",
  district: number | null,
  electionYear = 2026,
  senateRace?: SenateRaceIdentity
) {
  const stateCode = stateCodeInput.toUpperCase();
  try {
    const stateRace = await getStateAuthorityRace(
      stateCode,
      office,
      district,
      electionYear,
      false,
      senateRace
    );
    if (stateRace) return stateRace;
  } catch (error) {
    if (!isMissingElectionSchema(error)) throw error;
  }
  return getFecRace(stateCode, office, district, electionYear, senateRace);
}

async function knownSpecialSenateRaces(
  stateCode: string,
  senateClass: 1 | 2 | 3,
  electionYear: number
): Promise<SenateRaceIdentity[]> {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT senate_class, election_type
      FROM election_contests
      WHERE election_cycle = ${electionYear}
        AND state_code = ${stateCode}
        AND office = 'S'
        AND senate_class = ${senateClass}
        AND election_type = 'special'
    `);
    return result.rows.map(() => ({ senateClass, electionType: "special" as const }));
  } catch (error) {
    if (!isMissingElectionSchema(error)) throw error;
    return [];
  }
}

/** Return only contests for the member's physical House district or Senate class. */
export async function getMemberSeatRaces(
  stateCodeInput: string,
  seat: MemberSeat,
  electionYear = 2026
): Promise<RaceCandidateResult[]> {
  const stateCode = stateCodeInput.toUpperCase();
  if (seat.office === "H") {
    return [await getRaceCandidates(stateCode, "H", seat.district, electionYear)];
  }
  const selectors: SenateRaceIdentity[] = [];
  if (regularSenateClassForElectionYear(electionYear) === seat.senateClass) {
    selectors.push({ senateClass: seat.senateClass, electionType: "regular" });
  }
  selectors.push(
    ...(await knownSpecialSenateRaces(stateCode, seat.senateClass, electionYear))
  );
  return Promise.all(
    selectors.map((selector) =>
      getRaceCandidates(stateCode, "S", null, electionYear, selector)
    )
  );
}

export async function getRaceByContestId(contestId: string) {
  const parsed = parseContestId(contestId);
  if (!parsed) return null;
  try {
    const race = await getStateAuthorityRace(
      parsed.stateCode,
      parsed.office,
      parsed.district,
      parsed.cycle,
      true,
      parsed.office === "S"
        ? {
            senateClass: parsed.senateClass as 1 | 2 | 3,
            electionType: parsed.electionType,
          }
        : undefined
    );
    if (race && race.contestId === contestId) return race;
  } catch (error) {
    if (!isMissingElectionSchema(error)) throw error;
  }
  if (parsed.electionType === "special") return null;
  return getFecRace(
    parsed.stateCode,
    parsed.office,
    parsed.district,
    parsed.cycle,
    parsed.office === "S"
      ? {
          senateClass: parsed.senateClass as 1 | 2 | 3,
          electionType: parsed.electionType,
        }
      : undefined
  );
}

export type PublishedCandidateResearch = {
  candidacyId: string;
  siteUrl: string;
  verifiedSourceUrl: string;
  claims: Array<{
    claimId: string;
    claimType: string;
    claimText: string;
    sourceUrl: string;
    sourceQuote: string;
  }>;
  priorService: Array<{
    serviceId: string;
    officeTitle: string;
    jurisdiction: string | null;
    startedOn: string | null;
    endedOn: string | null;
    sourceUrl: string;
    sourceQuote: string;
  }>;
};

export async function getPublishedCampaignResearch(contestId: string) {
  try {
    const [sites, claims, service] = await Promise.all([
      db.execute(sql`
        SELECT site.candidacy_id, site.site_url, site.verified_source_url
        FROM candidate_campaign_sites site
        JOIN candidacies ca ON ca.candidacy_id = site.candidacy_id
        WHERE ca.contest_id = ${contestId}
          AND site.verification_status = 'verified'
          AND site.site_url IS NOT NULL
          AND site.verified_source_url IS NOT NULL
      `),
      db.execute(sql`
        SELECT claim.claim_id, claim.candidacy_id, claim.claim_type,
               claim.claim_text, claim.source_url, claim.source_quote
        FROM candidate_site_claims claim
        JOIN candidacies ca ON ca.candidacy_id = claim.candidacy_id
        WHERE ca.contest_id = ${contestId}
          AND claim.review_status = 'verified'
        ORDER BY claim.claim_type, claim.claim_text
      `),
      db.execute(sql`
        SELECT service.service_id, ca.candidacy_id, service.office_title,
               service.jurisdiction, service.started_on, service.ended_on,
               service.source_url, service.source_quote
        FROM candidate_prior_service service
        JOIN candidacies ca ON ca.person_id = service.person_id
        WHERE ca.contest_id = ${contestId}
          AND service.verification_status = 'verified'
        ORDER BY service.started_on NULLS LAST, service.office_title
      `),
    ]);
    const byCandidacy = new Map<string, PublishedCandidateResearch>();
    for (const row of sites.rows as Array<Record<string, unknown>>) {
      byCandidacy.set(row.candidacy_id as string, {
        candidacyId: row.candidacy_id as string,
        siteUrl: row.site_url as string,
        verifiedSourceUrl: row.verified_source_url as string,
        claims: [],
        priorService: [],
      });
    }
    for (const row of claims.rows as Array<Record<string, unknown>>) {
      byCandidacy.get(row.candidacy_id as string)?.claims.push({
        claimId: row.claim_id as string,
        claimType: row.claim_type as string,
        claimText: row.claim_text as string,
        sourceUrl: row.source_url as string,
        sourceQuote: row.source_quote as string,
      });
    }
    for (const row of service.rows as Array<Record<string, unknown>>) {
      byCandidacy.get(row.candidacy_id as string)?.priorService.push({
        serviceId: row.service_id as string,
        officeTitle: row.office_title as string,
        jurisdiction: row.jurisdiction as string | null,
        startedOn: row.started_on as string | null,
        endedOn: row.ended_on as string | null,
        sourceUrl: row.source_url as string,
        sourceQuote: row.source_quote as string,
      });
    }
    return byCandidacy;
  } catch (error) {
    if (!isMissingElectionSchema(error)) throw error;
    return new Map<string, PublishedCandidateResearch>();
  }
}

export type RaceIndexItem = {
  contestId: string;
  title: string;
  stateCode: string;
  stateName: string;
  office: "H" | "S";
  district: number | null;
  coverage: "verified_ballot" | "verification_pending" | "fec_only";
  activeCandidates: number;
  nextExpectedEvent: string | null;
};

export async function getRaceIndex(): Promise<RaceIndexItem[]> {
  const fecResult = await db.execute(sql`
    SELECT state_code, office, district, COUNT(*)::int AS n
    FROM election_candidates
    WHERE election_year = 2026
    GROUP BY state_code, office, district
  `);
  const fecCounts = new Map(
    (fecResult.rows as Array<{ state_code: string; office: string; district: number | null; n: number }>).map(
      (row) => [`${row.state_code}|${row.office}|${row.district ?? ""}`, Number(row.n)]
    )
  );
  const verified = new Map<string, RaceIndexItem>();
  try {
    const result = await db.execute(sql`
      SELECT c.contest_id, c.title, c.state_code, c.office, c.district,
             c.coverage_status, c.next_expected_event,
             COUNT(ca.candidacy_id) FILTER (WHERE ca.is_active)::int AS active_candidates
      FROM election_contests c
      LEFT JOIN candidacies ca ON ca.contest_id = c.contest_id
      WHERE c.election_cycle = 2026
      GROUP BY c.contest_id
    `);
    for (const row of result.rows as Array<Record<string, unknown>>) {
      verified.set(row.contest_id as string, {
        contestId: row.contest_id as string,
        title: row.title as string,
        stateCode: row.state_code as string,
        stateName: STATE_BY_CODE[row.state_code as string]?.name ?? (row.state_code as string),
        office: row.office as "H" | "S",
        district: row.district as number | null,
        coverage: row.coverage_status as RaceIndexItem["coverage"],
        activeCandidates: Number(row.active_candidates ?? 0),
        nextExpectedEvent: row.next_expected_event as string | null,
      });
    }
  } catch (error) {
    if (!isMissingElectionSchema(error)) throw error;
  }

  const races: RaceIndexItem[] = [];
  for (const state of STATES) {
    for (let district = state.numDistricts === 1 ? 0 : 1; district <= state.numDistricts; district++) {
      const contestId = houseContestId(state.code, district);
      races.push(
        verified.get(contestId) ?? {
          contestId,
          title: `${state.name} U.S. House ${district === 0 ? "At-Large" : `District ${district}`}`,
          stateCode: state.code,
          stateName: state.name,
          office: "H",
          district,
          coverage: "fec_only",
          activeCandidates: fecCounts.get(`${state.code}|H|${district}`) ?? 0,
          nextExpectedEvent: null,
        }
      );
      if (state.numDistricts === 1) break;
    }
    if (CLASS_TWO_STATES.has(state.code)) {
      const contestId = senateContestId(state.code, 2);
      races.push(
        verified.get(contestId) ?? {
          contestId,
          title: `${state.name} U.S. Senate, Class 2`,
          stateCode: state.code,
          stateName: state.name,
          office: "S",
          district: null,
          coverage: "fec_only",
          activeCandidates: fecCounts.get(`${state.code}|S|`) ?? 0,
          nextExpectedEvent: null,
        }
      );
    }
  }
  for (const [contestId, race] of verified) {
    if (!races.some((candidate) => candidate.contestId === contestId)) races.push(race);
  }
  return races.sort((a, b) => a.stateName.localeCompare(b.stateName) || a.office.localeCompare(b.office) || (a.district ?? 0) - (b.district ?? 0));
}

export async function getStateRaceIndex(stateCode: string) {
  const normalized = stateCode.toUpperCase();
  return (await getRaceIndex()).filter((race) => race.stateCode === normalized);
}

export async function getElectionCoverageMatrix(): Promise<StateRaceCoverage[]> {
  try {
    const result = await db.execute(sql`
      SELECT st.code, st.name, s.coverage_status, s.authority_name,
             s.source_url, s.adapter_key, s.last_success_at,
             s.next_expected_event,
             COUNT(c.contest_id)::int AS total_contests,
             COUNT(c.contest_id) FILTER (WHERE c.coverage_status = 'verified_ballot')::int AS verified_contests
      FROM states st
      LEFT JOIN election_sources s ON s.state_code = st.code
      LEFT JOIN election_contests c ON c.state_code = st.code AND c.election_cycle = 2026
      GROUP BY st.code, st.name, s.source_id
      ORDER BY st.name
    `);
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      stateCode: row.code as string,
      stateName: row.name as string,
      coverage: (row.coverage_status ?? "adapter_pending") as StateRaceCoverage["coverage"],
      authorityName: (row.authority_name as string | null) ?? `${row.name as string} election authority`,
      sourceUrl: (row.source_url as string | null) ?? FEC_STATE_OFFICE_DIRECTORY,
      adapterKey: row.adapter_key as string | null,
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at as string).toISOString() : null,
      nextExpectedEvent: row.next_expected_event as string | null,
      verifiedContests: Number(row.verified_contests ?? 0),
      totalContests: Number(row.total_contests ?? 0),
    }));
  } catch (error) {
    if (!isMissingElectionSchema(error)) throw error;
    return ELECTION_SOURCE_REGISTRY.filter((source) => source.stateCode).map((source) => ({
      stateCode: source.stateCode!,
      stateName: STATE_BY_CODE[source.stateCode!]?.name ?? source.stateCode!,
      coverage: "adapter_pending",
      authorityName: source.authorityName,
      sourceUrl: source.sourceUrl,
      adapterKey: source.adapterKey,
      lastSuccessAt: null,
      nextExpectedEvent: source.nextExpectedEvent,
      verifiedContests: 0,
      totalContests: 0,
    }));
  }
}

export async function getOverdueElectionCertifications() {
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT c.state_code, c.title, st.election_date,
             COALESCE(s.certification_window_days, 21)::int AS expectation_days
      FROM election_stages st
      JOIN election_contests c ON c.contest_id = st.contest_id
      JOIN election_sources s ON s.source_id = st.source_id
      WHERE st.result_status = 'unofficial'
        AND st.election_date + COALESCE(s.certification_window_days, 21) * interval '1 day' < CURRENT_DATE
      ORDER BY st.election_date, c.state_code, c.title
    `);
    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      stateCode: row.state_code as string,
      title: row.title as string,
      electionDate: row.election_date as string,
      expectationDays: Number(row.expectation_days),
    }));
  } catch (error) {
    if (!isMissingElectionSchema(error)) throw error;
    return [];
  }
}

export async function getCandidateResearchHealth() {
  try {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM candidate_campaign_sites WHERE verification_status = 'verified') AS verified_sites,
        (SELECT COUNT(*)::int FROM candidate_campaign_sites WHERE verification_status = 'blocked') AS blocked_sites,
        (SELECT COUNT(*)::int FROM candidate_campaign_sites WHERE verification_status = 'verified' AND crawl_error IS NOT NULL) AS crawl_errors,
        (SELECT COUNT(*)::int FROM candidate_site_claims WHERE review_status = 'needs_review') AS pending_claims,
        (SELECT COUNT(*)::int FROM candidate_site_claims WHERE review_status = 'verified') AS verified_claims,
        (SELECT COUNT(*)::int FROM candidate_prior_service WHERE verification_status = 'needs_review') AS pending_service,
        (SELECT COUNT(*)::int FROM candidate_prior_service WHERE verification_status = 'verified') AS verified_service
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return {
      verifiedSites: Number(row?.verified_sites ?? 0),
      blockedSites: Number(row?.blocked_sites ?? 0),
      crawlErrors: Number(row?.crawl_errors ?? 0),
      pendingClaims: Number(row?.pending_claims ?? 0),
      verifiedClaims: Number(row?.verified_claims ?? 0),
      pendingService: Number(row?.pending_service ?? 0),
      verifiedService: Number(row?.verified_service ?? 0),
    };
  } catch (error) {
    if (!isMissingElectionSchema(error)) throw error;
    return {
      verifiedSites: 0,
      blockedSites: 0,
      crawlErrors: 0,
      pendingClaims: 0,
      verifiedClaims: 0,
      pendingService: 0,
      verifiedService: 0,
    };
  }
}

export async function getRaceExportRows() {
  try {
    const result = await db.execute(sql`
      SELECT c.contest_id, c.state_code, c.office, c.district, c.senate_class,
             ca.candidacy_id, p.display_name AS name, ca.party,
             ca.current_status AS status, ca.is_active, c.coverage_status AS coverage,
             s.authority_name AS source_name, s.source_url,
             ca.fec_candidate_id, fec.total_receipts,
             primary_result.total_votes AS primary_votes,
             primary_result.is_winner AS primary_winner,
             primary_result.result_status
      FROM election_contests c
      JOIN election_sources s ON s.source_id = c.primary_source_id
      JOIN candidacies ca ON ca.contest_id = c.contest_id
      JOIN candidate_people p ON p.person_id = ca.person_id
      LEFT JOIN election_candidates fec ON fec.candidate_id = ca.fec_candidate_id
      LEFT JOIN LATERAL (
        SELECT r.total_votes, r.is_winner, r.result_status
        FROM election_results r
        JOIN election_stages st ON st.stage_id = r.stage_id
        WHERE r.candidacy_id = ca.candidacy_id AND st.stage_kind = 'primary'
        ORDER BY st.election_date DESC, st.sequence_number DESC
        LIMIT 1
      ) primary_result ON true
      WHERE c.election_cycle = 2026 AND c.coverage_status <> 'fec_only'

      UNION ALL

      SELECT
        CASE WHEN fec.office = 'H'
          THEN '2026-' || fec.state_code || '-H' || COALESCE(fec.district, 0)::text
          ELSE '2026-' || fec.state_code || '-S2'
        END AS contest_id,
        fec.state_code, fec.office, fec.district, CASE WHEN fec.office = 'S' THEN 2 ELSE NULL END AS senate_class,
        'fec-' || fec.candidate_id AS candidacy_id, fec.name, fec.party,
        'fec_filer' AS status, true AS is_active, 'fec_only' AS coverage,
        'Federal Election Commission' AS source_name,
        'https://www.fec.gov/data/candidates/' AS source_url,
        fec.candidate_id AS fec_candidate_id, fec.total_receipts,
        NULL::bigint AS primary_votes, NULL::boolean AS primary_winner,
        NULL::text AS result_status
      FROM election_candidates fec
      WHERE fec.election_year = 2026
        AND NOT EXISTS (
          SELECT 1 FROM election_contests c
          WHERE c.election_cycle = fec.election_year
            AND c.state_code = fec.state_code
            AND c.office = fec.office
            AND c.coverage_status <> 'fec_only'
            AND (
              (fec.office = 'H' AND c.district IS NOT DISTINCT FROM fec.district) OR
              (fec.office = 'S' AND c.senate_class = 2 AND c.election_type = 'regular')
            )
        )
      ORDER BY state_code, office, district NULLS FIRST, name
    `);
    return result.rows as Record<string, unknown>[];
  } catch (error) {
    if (!isMissingElectionSchema(error)) throw error;
    const fallback = await db.execute(sql`
      SELECT
        CASE WHEN office = 'H'
          THEN '2026-' || state_code || '-H' || COALESCE(district, 0)::text
          ELSE '2026-' || state_code || '-S2'
        END AS contest_id,
        state_code, office, district,
        CASE WHEN office = 'S' THEN 2 ELSE NULL END AS senate_class,
        'fec-' || candidate_id AS candidacy_id, name, party,
        'fec_filer' AS status, true AS is_active, 'fec_only' AS coverage,
        'Federal Election Commission' AS source_name,
        'https://www.fec.gov/data/candidates/' AS source_url,
        candidate_id AS fec_candidate_id, total_receipts,
        NULL::bigint AS primary_votes, NULL::boolean AS primary_winner,
        NULL::text AS result_status
      FROM election_candidates
      WHERE election_year = 2026
      ORDER BY state_code, office, district NULLS FIRST, name
    `);
    return fallback.rows as Record<string, unknown>[];
  }
}
