import {
  findMembersByName,
  getMembersByState,
  getMemberVoteSummary,
  getMemberFinance,
  getMemberTopContributors,
  getMemberFinanceCommittees,
  getMemberCommittees,
  getMemberTerms,
  getMemberSeatRaces,
  getPublishedCampaignResearch,
  getPublishedMemberBiography,
  getRaceCandidates,
  searchMemberVotes,
  searchMemberBills,
} from "./queries";
import { STATE_BY_CODE } from "./states";
import {
  memberSeatLabel,
  resolveMemberSeat,
  type MemberSeat,
} from "./elections/member-seat";
import type { RaceCandidateResult } from "./elections/types";
import type { PublishedCandidateResearch } from "./elections/queries";

export type AskScope =
  | { type: "state"; stateCode: string; district: number | null }
  | {
      type: "member";
      stateCode: string;
      bioguideId: string;
      seat: MemberSeat;
    }
  // No location set: the reader can ask about any sitting member. find_members
  // resolves who they mean; allowedMemberIds holds the full current roster so
  // only real, sitting lawmakers are ever readable.
  | { type: "national" };

export interface AskToolContext {
  scope: AskScope;
  allowedMemberIds: ReadonlySet<string>;
}

export interface ToolTraceEntry {
  tool: string;
  input: Record<string, unknown>;
}

export interface AskToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  terminal?: boolean;
}

const objectSchema = (
  properties: Record<string, unknown>,
  required = Object.keys(properties)
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const tools: AskToolDefinition[] = [
  {
    name: "get_delegation",
    description:
      "Get the current congressional delegation for the page's state. Use this for roster, party, chamber, and district questions.",
    inputSchema: objectSchema({
      state_code: { type: "string", description: "The page's two-letter state code." },
    }),
  },
  {
    name: "get_member_votes",
    description:
      "Get a scoped member's roll-call votes and totals from House Clerk and Senate XML. For topic questions, pass topic to search the member's full ingested vote history; with every filter null it returns the most recent votes.",
    inputSchema: objectSchema({
      bioguide_id: { type: "string" },
      topic: {
        type: ["string", "null"],
        description:
          "Keyword(s) searched over vote question, description, and linked bill title and policy area. Null for most-recent votes.",
      },
      date_from: {
        type: ["string", "null"],
        description: "Earliest vote date, YYYY-MM-DD, or null.",
      },
      date_to: {
        type: ["string", "null"],
        description: "Latest vote date, YYYY-MM-DD, or null.",
      },
      congress: {
        type: ["integer", "null"],
        description: "Congress number (118 or 119), or null for all ingested.",
      },
      limit: { type: ["integer", "null"] },
    }),
  },
  {
    name: "get_member_finance",
    description:
      "Get a scoped member's FEC campaign-finance totals, linked committees (including any leadership PAC), and top contributors by donor employer. Pass cycle for one election cycle; null returns recent cycles.",
    inputSchema: objectSchema({
      bioguide_id: { type: "string" },
      cycle: {
        type: ["integer", "null"],
        description: "Even election year, e.g. 2026, or null for recent cycles.",
      },
    }),
  },
  {
    name: "get_member_bills",
    description:
      "Get legislation a scoped member sponsored or cosponsored from Congress.gov. For topic questions, pass topic or policy_area to search the member's full sponsorship history; with every filter null it returns the most recent bills.",
    inputSchema: objectSchema({
      bioguide_id: { type: "string" },
      topic: {
        type: ["string", "null"],
        description:
          "Keyword(s) searched over bill title and policy area. Null for most-recent bills.",
      },
      policy_area: {
        type: ["string", "null"],
        description:
          "Congress.gov policy area, e.g. Health or Immigration, or null.",
      },
      congress: {
        type: ["integer", "null"],
        description: "Congress number (118 or 119), or null for all ingested.",
      },
      role: {
        anyOf: [
          { type: "string", enum: ["sponsor", "cosponsor"] },
          { type: "null" },
        ],
        description: "Restrict to sponsored or cosponsored bills, or null for both.",
      },
      date_from: {
        type: ["string", "null"],
        description: "Earliest introduced date, YYYY-MM-DD, or null.",
      },
      date_to: {
        type: ["string", "null"],
        description: "Latest introduced date, YYYY-MM-DD, or null.",
      },
      limit: { type: ["integer", "null"] },
    }),
  },
  {
    name: "get_member_terms",
    description:
      "Get a scoped member's congressional terms. Use for tenure and whether the seat is up in 2026.",
    inputSchema: objectSchema({ bioguide_id: { type: "string" } }),
  },
  {
    name: "get_member_biography",
    description:
      "Get human-reviewed biography facts extracted from a scoped lawmaker's official House or Senate website. These are statements from the lawmaker's official biography, not independent verification.",
    inputSchema: objectSchema({ bioguide_id: { type: "string" } }),
  },
  {
    name: "get_race_candidates",
    description:
      "Get the current 2026 candidate field for a race in the page's state. Covered states use state election-authority records; uncovered states return a clearly labeled FEC Form 2 filing fallback.",
    inputSchema: objectSchema({
      state_code: { type: "string" },
      office: { type: "string", enum: ["H", "S"] },
      district: { type: ["integer", "null"] },
      senate_class: {
        anyOf: [
          { type: "integer", enum: [1, 2, 3] },
          { type: "null" },
        ],
      },
      election_type: {
        anyOf: [
          { type: "string", enum: ["regular", "special"] },
          { type: "null" },
        ],
      },
    }),
  },
  {
    name: "get_member_committees",
    description:
      "Get a scoped member's current committee and subcommittee assignments and leadership roles.",
    inputSchema: objectSchema({ bioguide_id: { type: "string" } }),
  },
  {
    name: "find_members",
    description:
      "Search sitting members of Congress by name across all 50 states. Use this first when no location is set to resolve who the reader means, then read that member's records with the get_member_* tools using the returned bioguide_id. Optionally pass a two-letter state_code to restrict the search.",
    inputSchema: objectSchema({
      query: {
        type: "string",
        description: "A member name or partial name, e.g. \"Ocasio-Cortez\" or \"Warren\".",
      },
      state_code: {
        type: ["string", "null"],
        description: "Two-letter state code to restrict the search, or null for all states.",
      },
    }),
  },
  {
    name: "submit_answer",
    description:
      "Finish every request with the grounded answer. Call only after retrieving every record needed. Never return the answer as ordinary text.",
    inputSchema: objectSchema({
      status: {
        type: "string",
        enum: ["answered", "not_found", "out_of_scope", "declined"],
      },
      answer: { type: "string" },
    }),
    terminal: true,
  },
];

export function getAskTools(scope: AskScope): AskToolDefinition[] {
  return tools
    .filter((tool) => {
      // find_members only exists nationally; member pages keep a fixed roster
      // and never expose get_delegation.
      if (tool.name === "find_members") return scope.type === "national";
      if (tool.name === "get_delegation") return scope.type !== "member";
      return true;
    })
    .map((tool) =>
      scope.type === "member" && tool.name === "get_race_candidates"
        ? {
            ...tool,
            description: `Get the current 2026 candidate field only for this member's ${memberSeatLabel(scope.seat)}. The server selects the exact district or Senate class and regular/special contest; no race arguments are accepted.`,
            inputSchema: objectSchema({}),
          }
        : tool
    );
}

export function getAskToolsForQuestion(scope: AskScope, question: string) {
  const normalized = question.toLowerCase();
  const routingText = normalized.replace(/\belection cycle\b/g, "cycle");
  const selected = new Set<string>(["submit_answer"]);
  const routes: Array<[RegExp, string]> = [
    [/\b(vote|voted|voting|roll[ -]?call)\b/, "get_member_votes"],
    [/\b(bill|bills|legislation|legislative|sponsor|cosponsor)\b/, "get_member_bills"],
    [/\b(finance|fundrais(?:e|es|ing)|rais(?:e|es|ed)|money|cash|donor|contributor|pac)\b/, "get_member_finance"],
    [/\b(committee|committees|subcommittee|assignment)\b/, "get_member_committees"],
    [/\b(term|terms|tenure|served|service|seat up|reelection|re-election)\b/, "get_member_terms"],
    [/\b(bio|biography|background|career|education|occupation|who is)\b/, "get_member_biography"],
    [/\b(race|candidate|candidates|challenger|running|primary|election)\b/, "get_race_candidates"],
  ];
  for (const [pattern, name] of routes) {
    if (pattern.test(routingText)) selected.add(name);
  }
  const hasRetrieval = [...selected].some((name) => name !== "submit_answer");
  if (
    scope.type === "state" &&
    (!hasRetrieval || /\b(who|senator|representative|delegation|roster|member|district)\b/.test(normalized))
  ) {
    selected.add("get_delegation");
  }
  // National questions must resolve who the reader means before reading
  // records, and a bare roster question ("who represents Texas") answers
  // straight from get_delegation. Both stay available every turn.
  if (scope.type === "national") {
    selected.add("find_members");
    selected.add("get_delegation");
  }
  if (!hasRetrieval && scope.type === "member" && /\b(record|work|done|about|overview)\b/.test(normalized)) {
    for (const name of [
      "get_member_votes",
      "get_member_bills",
      "get_member_finance",
      "get_member_committees",
      "get_member_terms",
      "get_member_biography",
    ]) {
      selected.add(name);
    }
  }
  return getAskTools(scope).filter((tool) => selected.has(tool.name));
}

const clamp = (n: unknown, def: number, max: number) => {
  if (n === -1) return def;
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.min(Math.max(v, 1), max);
};

const truncate = (s: string | null, len = 200) =>
  s && s.length > len ? `${s.slice(0, len)}...` : s;

const BIOGUIDE_RE = /^[A-Z][0-9]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUnsetAskFilter(value: unknown) {
  if (value == null || value === -1) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "null" ||
    normalized === '""' ||
    normalized.includes("antml")
  );
}

// Filter parsing is fail-soft: a bad filter value returns an { error } the
// model can read and correct on the next call, never a thrown request failure.
function parseDateFilter(value: unknown, label: string) {
  if (isUnsetAskFilter(value)) return { ok: undefined };
  if (typeof value !== "string" || !DATE_RE.test(value.trim())) {
    return { error: `${label} must be a YYYY-MM-DD date.` };
  }
  return { ok: value.trim() };
}

function parseCongressFilter(value: unknown) {
  if (isUnsetAskFilter(value)) return { ok: undefined };
  if (value === 118 || value === 119) return { ok: value };
  return { error: "congress must be 118 or 119." };
}

function parseCycleFilter(value: unknown) {
  if (isUnsetAskFilter(value)) return { ok: undefined };
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value % 2 === 0 &&
    value >= 1988 &&
    value <= 2026
  ) {
    return { ok: value };
  }
  return { error: "cycle must be an even election year between 1988 and 2026." };
}

function parseRoleFilter(
  value: unknown
): { ok: "sponsor" | "cosponsor" | undefined } | { error: string } {
  if (value === "sponsor" || value === "cosponsor") return { ok: value };
  if (isUnsetAskFilter(value)) return { ok: undefined };
  return { error: "role must be sponsor or cosponsor." };
}

function parseTopicFilter(value: unknown) {
  if (isUnsetAskFilter(value)) return undefined;
  if (typeof value !== "string") return undefined;
  return value.trim().slice(0, 80) || undefined;
}

function scopedBioguide(input: Record<string, unknown>, context: AskToolContext) {
  const id =
    typeof input.bioguide_id === "string"
      ? input.bioguide_id.trim().toUpperCase()
      : "";
  if (!BIOGUIDE_RE.test(id)) {
    return { error: "Invalid member identifier. Use an identifier from the page roster." };
  }
  if (!context.allowedMemberIds.has(id)) {
    return { error: "That member is outside this page's delegation scope." };
  }
  return id;
}

function raceToolPayload(
  result: RaceCandidateResult,
  sitting: Awaited<ReturnType<typeof getMembersByState>>,
  research: Map<string, PublishedCandidateResearch> = new Map()
) {
  const isWashingtonTopTwo = result.stateCode === "WA";
  const identity = {
    contest_id: result.contestId,
    office: result.office,
    district: result.district,
    senate_class: result.senateClass,
    election_type: result.electionType,
  };
  if (!result.hasData) {
    return {
      ...identity,
      source: result.sourceName,
      source_url: result.sourceUrl,
      coverage: "not_loaded",
      records: [],
      note:
        result.coverageNote ??
        "Candidate data is not loaded. Do not infer that nobody is running.",
    };
  }
  const sittingFecIds = new Set(
    sitting.map((member) => member.fecCandidateId).filter(Boolean)
  );
  const sittingNameKeys = new Set(
    sitting.map(
      (member) =>
        `${member.firstName?.[0]?.toLowerCase() ?? ""}|${member.lastName?.toLowerCase() ?? ""}`
    )
  );
  const isSitting = (candidate: { candidate_id: string; name: string }) => {
    if (sittingFecIds.has(candidate.candidate_id)) return true;
    const parts = candidate.name.trim().split(/\s+/);
    if (parts.length < 2) return false;
    return sittingNameKeys.has(
      `${parts[0][0].toLowerCase()}|${parts[parts.length - 1].toLowerCase()}`
    );
  };
  return {
    ...identity,
    source: result.sourceName,
    source_url: result.sourceUrl,
    coverage: result.coverage,
    certified_through: result.certifiedThrough,
    note:
      result.coverageNote ??
      (result.coverage === "verified_ballot"
        ? "State-authority ballot records."
        : result.coverage === "verification_pending"
          ? "State-authority records are available, but certification or the final complete ballot list is pending. Preserve that qualification."
          : "FEC filing fallback, not a ballot or proof that a candidate remains in the race."),
    ...(isWashingtonTopTwo
      ? {
          election_method: "top_two_primary",
          party_interpretation:
            "Washington ballot labels are each candidate's party preference, not a party nomination or verified affiliation. Say 'Democratic preference,' 'Republican preference,' and so on; never shorten these to 'Democrat' or 'Republican.'",
        }
      : {}),
    current_officeholders: sitting.map((member) => member.fullName),
    records: result.candidates.map((candidate) => {
      const profile = research.get(candidate.candidacyId);
      return {
        name: candidate.name,
        ...(isWashingtonTopTwo
          ? { party_preference: candidate.party }
          : { party: candidate.party }),
        ballot_lines: candidate.ballotLines,
        status:
          result.coverage !== "fec_only"
            ? candidate.status
            : candidate.incumbent_challenge === "I"
              ? isSitting(candidate)
                ? "incumbent"
                : "filed as incumbent but no longer in office"
              : candidate.incumbent_challenge === "O"
                ? "open-seat candidate"
                : "challenger",
        total_raised: candidate.total_receipts,
        first_filed: candidate.first_file_date,
        fec_candidate_id: candidate.candidate_id,
        primary_votes: candidate.primaryVotes,
        primary_result_status: candidate.resultStatus,
        campaign_site: profile?.siteUrl ?? null,
        campaign_biography:
          profile?.claims
            .filter((claim) => claim.claimType === "biography")
            .map((claim) => ({
              fact: claim.claimText,
              source_url: claim.sourceUrl,
            })) ?? [],
        verified_prior_service:
          profile?.priorService.map((service) => ({
            office: service.officeTitle,
            jurisdiction: service.jurisdiction,
            started_on: service.startedOn,
            ended_on: service.endedOn,
            source_url: service.sourceUrl,
          })) ?? [],
      };
    }),
  };
}

export async function executeAskTool(
  name: string,
  input: Record<string, unknown>,
  context: AskToolContext
): Promise<unknown> {
  if (name === "submit_answer") return { error: "Terminal tool is handled by the engine." };

  if (name === "find_members") {
    if (context.scope.type !== "national") {
      return { error: "Member search is only available when no location is set." };
    }
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (query.length < 2) {
      return { error: "Provide at least two characters of a member's name." };
    }
    const stateFilter =
      typeof input.state_code === "string" &&
      STATE_BY_CODE[input.state_code.toUpperCase()]
        ? input.state_code.toUpperCase()
        : null;
    const rows = await findMembersByName(query, 12);
    const matched = (
      stateFilter ? rows.filter((m) => m.state_code === stateFilter) : rows
    ).slice(0, 8);
    return {
      source: "current member roster",
      matched: matched.length,
      records: matched.map((m) => ({
        bioguide_id: m.bioguide_id,
        name: m.full_name,
        party: m.party,
        chamber: m.chamber,
        state: m.state_code,
        district: m.district,
      })),
      ...(matched.length === 0
        ? {
            note: "No sitting member matched. Do not guess a name; ask the reader to clarify.",
          }
        : {}),
    };
  }

  if (name === "get_delegation") {
    const stateCode =
      typeof input.state_code === "string" ? input.state_code.toUpperCase() : "";
    if (context.scope.type === "member") {
      return { error: "That state is outside this page's scope." };
    }
    if (context.scope.type === "state" && stateCode !== context.scope.stateCode) {
      return { error: "That state is outside this page's scope." };
    }
    if (context.scope.type === "national" && !STATE_BY_CODE[stateCode]) {
      return { error: "Unknown state. Use a two-letter state code." };
    }
    const rows = await getMembersByState(stateCode);
    return {
      source: "current member roster",
      records: rows.map((m) => ({
        bioguide_id: m.bioguideId,
        name: m.fullName,
        party: m.party,
        chamber: m.chamber,
        district: m.district,
      })),
    };
  }

  if (name === "get_race_candidates") {
    if (context.scope.type === "member") {
      const memberScope = context.scope;
      const [results, delegation] = await Promise.all([
        getMemberSeatRaces(memberScope.stateCode, memberScope.seat),
        getMembersByState(memberScope.stateCode),
      ]);
      const sitting = delegation.filter(
        (member) => member.bioguideId === memberScope.bioguideId
      );
      const research = await Promise.all(
        results.map((result) => getPublishedCampaignResearch(result.contestId))
      );
      return {
        seat: memberSeatLabel(memberScope.seat),
        contests: results.map((result, index) =>
          raceToolPayload(result, sitting, research[index])
        ),
        note:
          results.length > 0
            ? "Only contests for this member's exact district or Senate class are included."
            : "No 2026 contest is registered for this member's exact seat. Do not substitute the state's other Senate seat.",
      };
    }
    const stateCode =
      typeof input.state_code === "string" ? input.state_code.toUpperCase() : "";
    if (context.scope.type === "state" && stateCode !== context.scope.stateCode) {
      return { error: "That race is outside this page's state scope." };
    }
    if (context.scope.type === "national" && !STATE_BY_CODE[stateCode]) {
      return { error: "Unknown state. Use a two-letter state code." };
    }
    const office = input.office === "S" ? "S" : input.office === "H" ? "H" : null;
    const district =
      typeof input.district === "number" && Number.isInteger(input.district)
        ? input.district === -1 ? null : input.district
        : null;
    if (!office) return { error: "Office must be H or S." };
    const senateClass =
      office === "S" &&
      typeof input.senate_class === "number" &&
      [1, 2, 3].includes(input.senate_class)
        ? (input.senate_class as 1 | 2 | 3)
        : null;
    const electionType =
      input.election_type === "special" ? "special" : "regular";
    if (office === "S" && !senateClass) {
      return { error: "A Senate race requires its seat class." };
    }
    const [result, delegation] = await Promise.all([
      getRaceCandidates(
        stateCode,
        office,
        district,
        2026,
        senateClass ? { senateClass, electionType } : undefined
      ),
      getMembersByState(stateCode),
    ]);
    let sitting = delegation.filter(
      (member) =>
        office === "H" &&
        member.chamber === "house" &&
        (member.district ?? 0) === district
    );
    if (office === "S" && senateClass) {
      const resolved = await Promise.all(
        delegation
          .filter((member) => member.chamber === "senate")
          .map(async (member) => ({
            member,
            seat: resolveMemberSeat(member, await getMemberTerms(member.bioguideId)),
          }))
      );
      sitting = resolved
        .filter(
          ({ seat }) =>
            seat?.office === "S" && seat.senateClass === senateClass
        )
        .map(({ member }) => member);
    }
    return raceToolPayload(
      result,
      sitting,
      await getPublishedCampaignResearch(result.contestId)
    );
  }

  const bioguideId = scopedBioguide(input, context);
  if (typeof bioguideId !== "string") return bioguideId;

  switch (name) {
    case "get_member_votes": {
      const dateFrom = parseDateFilter(input.date_from, "date_from");
      if ("error" in dateFrom) return dateFrom;
      const dateTo = parseDateFilter(input.date_to, "date_to");
      if ("error" in dateTo) return dateTo;
      const congress = parseCongressFilter(input.congress);
      if ("error" in congress) return congress;
      const [summary, search] = await Promise.all([
        getMemberVoteSummary(bioguideId),
        searchMemberVotes(bioguideId, {
          topic: parseTopicFilter(input.topic),
          dateFrom: dateFrom.ok,
          dateTo: dateTo.ok,
          congress: congress.ok,
          limit: clamp(input.limit, 10, 25),
        }),
      ]);
      return {
        source: "House Clerk and Senate roll-call XML",
        coverage:
          "119th Congress (2025-present), plus any backfilled earlier congresses; current members only",
        totals: summary,
        matched: search.totalMatched,
        showing: search.records.length,
        records: search.records.map((vote) => ({
          date: vote.vote_date,
          chamber: vote.chamber,
          congress: vote.congress,
          roll: vote.roll_number,
          question: truncate(vote.question),
          description: truncate(vote.description),
          result: vote.result,
          tally: `${vote.yeas}-${vote.nays}`,
          member_position: vote.position,
        })),
      };
    }
    case "get_member_finance": {
      const cycle = parseCycleFilter(input.cycle);
      if ("error" in cycle) return cycle;
      const [finance, contributors, committees] = await Promise.all([
        getMemberFinance(bioguideId, cycle.ok),
        getMemberTopContributors(bioguideId, cycle.ok),
        getMemberFinanceCommittees(bioguideId),
      ]);
      const shown = cycle.ok ? finance : finance.slice(0, 6);
      const COMMITTEE_KINDS: Record<string, string> = {
        P: "principal campaign committee",
        A: "authorized committee",
        D: "leadership PAC",
        J: "joint fundraising committee",
      };
      return {
        source: "FEC campaign-finance filings",
        cycles_on_file: finance.length,
        ...(finance.length > shown.length
          ? {
              note: `Showing the ${shown.length} most recent cycles; pass cycle for older ones.`,
            }
          : {}),
        by_cycle: shown.map((row) => ({
          cycle: row.electionCycle,
          total_receipts: row.totalReceipts,
          individual: row.totalIndividual,
          pac: row.totalPac,
          small_dollar: row.smallIndividual,
        })),
        committees: committees.map((committee) => ({
          name: committee.name,
          kind:
            COMMITTEE_KINDS[committee.designation ?? ""] ?? "other committee",
          total_receipts_2026_cycle: committee.totalReceipts,
        })),
        ...(contributors.length > 0
          ? {
              top_contributors_note:
                "Individual donations aggregated by the donor's reported employer, per FEC Schedule A.",
            }
          : {}),
        top_contributors: contributors.map((row) => ({
          organization: row.contributorName,
          total: row.totalAmount,
          cycle: row.electionCycle,
        })),
      };
    }
    case "get_member_bills": {
      const dateFrom = parseDateFilter(input.date_from, "date_from");
      if ("error" in dateFrom) return dateFrom;
      const dateTo = parseDateFilter(input.date_to, "date_to");
      if ("error" in dateTo) return dateTo;
      const congress = parseCongressFilter(input.congress);
      if ("error" in congress) return congress;
      const role = parseRoleFilter(input.role);
      if ("error" in role) return role;
      const search = await searchMemberBills(bioguideId, {
        topic: parseTopicFilter(input.topic),
        policyArea: parseTopicFilter(input.policy_area),
        congress: congress.ok,
        role: role.ok,
        dateFrom: dateFrom.ok,
        dateTo: dateTo.ok,
        limit: clamp(input.limit, 10, 25),
      });
      return {
        source: "Congress.gov",
        coverage:
          "119th Congress (2025-present), plus any backfilled earlier congresses; bills linked to current members only",
        matched: search.totalMatched,
        showing: search.records.length,
        records: search.records.map((bill) => ({
          bill_id: bill.bill_id,
          label: `${bill.bill_type.toUpperCase()} ${bill.bill_number}`,
          title: truncate(bill.title, 160),
          role: bill.role,
          congress: bill.congress,
          introduced: bill.introduced_date,
          policy_area: bill.policy_area,
          latest_action: truncate(bill.latest_action_text, 160),
        })),
      };
    }
    case "get_member_terms": {
      const rows = await getMemberTerms(bioguideId);
      return {
        source: "current member roster and term records",
        records: rows.map((term) => ({
          chamber: term.chamber,
          state: term.stateCode,
          party: term.party,
          start: term.startDate,
          end: term.endDate,
          is_current: term.isCurrent,
        })),
      };
    }
    case "get_member_biography": {
      const biography = await getPublishedMemberBiography(bioguideId);
      if (!biography || biography.facts.length === 0) {
        return {
          source: "official House or Senate website",
          coverage: "not_loaded",
          records: [],
          note: "No human-reviewed official biography facts are published for this lawmaker yet. Do not fill the gap from model memory.",
        };
      }
      return {
        source: "official House or Senate website",
        source_url: biography.biographyUrl ?? biography.siteUrl,
        characterization:
          "These are statements from the lawmaker's official biography, not independent verification.",
        records: biography.facts.map((fact) => ({
          fact: fact.claimText,
          source_url: fact.sourceUrl,
        })),
      };
    }
    case "get_member_committees": {
      const rows = await getMemberCommittees(bioguideId);
      return {
        source: "committee assignment records",
        records: rows.map((committee) => ({
          committee_id: committee.committeeId,
          name: committee.name,
          chamber: committee.chamber,
          role: committee.role,
          is_subcommittee: committee.parentId != null,
        })),
      };
    }
    default:
      return { error: "Unknown retrieval tool." };
  }
}
