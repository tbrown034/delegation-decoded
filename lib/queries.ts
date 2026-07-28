import { db } from "./db";
import {
  states,
  members,
  terms,
  committees,
  committeeAssignments,
  bills,
  billSponsorships,
  campaignFinance,
  topContributors,
  financeCommittees,
  committeeFinance,
  votes,
  votePositions,
  events,
  delegationBriefs,
  pressReleases,
  stockTransactions,
  disclosureFilings,
  syncLog,
} from "./schema";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { firstNameForms, initialismSurname } from "./member-names";
export {
  getMemberSeatRaces,
  getPublishedCampaignResearch,
  getRaceCandidates,
} from "./elections/queries";
export { getPublishedMemberBiography } from "./biography-queries";

// ─── State queries ───────────────────────────────────────────────────────────

export async function getAllStatesWithCounts() {
  const [rows, partyRows] = await Promise.all([
    db
      .select({
        code: states.code,
        name: states.name,
        numDistricts: states.numDistricts,
        memberCount: count(members.bioguideId),
      })
      .from(states)
      .leftJoin(
        members,
        and(eq(members.stateCode, states.code), eq(members.inOffice, true))
      )
      .groupBy(states.code, states.name, states.numDistricts)
      .orderBy(states.name),
    db
      .select({
        stateCode: members.stateCode,
        party: members.party,
        count: count(members.bioguideId),
      })
      .from(members)
      .where(eq(members.inOffice, true))
      .groupBy(members.stateCode, members.party),
  ]);

  const partyMap = new Map<
    string,
    { democrat: number; republican: number; independent: number }
  >();
  for (const row of partyRows) {
    if (!partyMap.has(row.stateCode)) {
      partyMap.set(row.stateCode, {
        democrat: 0,
        republican: 0,
        independent: 0,
      });
    }
    const entry = partyMap.get(row.stateCode)!;
    if (row.party === "Democrat") entry.democrat = row.count;
    else if (row.party === "Republican") entry.republican = row.count;
    else entry.independent = row.count;
  }

  return rows.map((r) => ({
    ...r,
    parties: partyMap.get(r.code) || {
      democrat: 0,
      republican: 0,
      independent: 0,
    },
  }));
}

export async function getStateByCode(code: string) {
  const [state] = await db
    .select()
    .from(states)
    .where(eq(states.code, code.toUpperCase()))
    .limit(1);
  return state || null;
}

// ─── Member queries ──────────────────────────────────────────────────────────

export async function getMembersByState(stateCode: string) {
  return db
    .select()
    .from(members)
    .where(
      and(
        eq(members.stateCode, stateCode.toUpperCase()),
        eq(members.inOffice, true)
      )
    )
    .orderBy(members.chamber, members.lastName);
}

export async function getMemberByBioguideId(bioguideId: string) {
  const [member] = await db
    .select()
    .from(members)
    .where(eq(members.bioguideId, bioguideId))
    .limit(1);
  return member || null;
}

export async function getMemberTerms(bioguideId: string) {
  return db
    .select()
    .from(terms)
    .where(eq(terms.bioguideId, bioguideId))
    .orderBy(desc(terms.startDate));
}

// Name search across every sitting member, for /ask questions about members
// outside the reader's delegation ("how much has AOC raised"). Exact and
// prefix matches outrank substring hits; ILIKE keeps it migration-free.
export async function findMembersByName(query: string, limit = 8) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const prefix = `${q}%`;

  // 193 of 537 sitting members store a middle initial or middle name, so a
  // contiguous "%adam schiff%" never matches "Adam B. Schiff" — and readers
  // type "Adam Schiff", "Bernie Sanders", "Chuck Schumer". Match the first and
  // last tokens against their own columns as well. First name is a prefix test
  // so Bernie/Bernard and Chuck/Charles still miss, but every middle-initial
  // member is reachable; nickname mapping is a separate problem.
  const tokens = q.split(/\s+/).filter(Boolean);
  const lastToken = tokens.length > 1 ? `${tokens[tokens.length - 1]}%` : null;
  // "Chuck" must reach "Charles E. Schumer"; the roster stores legal names.
  // Built as an explicit OR list rather than a bound text[] — Drizzle renders a
  // JS array into the template as a string and Postgres rejects it.
  const firstForms =
    tokens.length > 1 ? firstNameForms(tokens[0]).map((f) => `${f}%`) : [];
  const firstNameMatch =
    firstForms.length > 0 && lastToken
      ? sql`(${sql.join(
          firstForms.map((f) => sql`LOWER(first_name) LIKE ${f}`),
          sql` OR `
        )}) AND LOWER(last_name) LIKE ${lastToken}`
      : sql`false`;
  // A bare "AOC" carries no surname token of its own.
  const initialism = tokens.length === 1 ? initialismSurname(q) : null;
  const initialismMatch = initialism
    ? sql`LOWER(last_name) LIKE ${`${initialism}%`}`
    : sql`false`;

  const rows = (await db.execute(sql`
    SELECT bioguide_id, full_name, party, state_code, district, chamber,
      CASE
        WHEN LOWER(full_name) = ${q} THEN 100
        WHEN LOWER(last_name) = ${q} THEN 95
        WHEN ${firstNameMatch} THEN 90
        WHEN LOWER(full_name) LIKE ${prefix} THEN 80
        WHEN LOWER(last_name) LIKE ${prefix} THEN 75
        ELSE 50
      END AS rank
    FROM members
    WHERE in_office = true
      AND (
        LOWER(full_name) LIKE ${like}
        OR LOWER(last_name) LIKE ${like}
        OR ${firstNameMatch}
        OR ${initialismMatch}
      )
    ORDER BY rank DESC, last_name ASC
    LIMIT ${Math.min(Math.max(limit, 1), 12)}
  `)) as unknown as {
    rows: {
      bioguide_id: string;
      full_name: string;
      party: string;
      state_code: string;
      district: number | null;
      chamber: string;
    }[];
  };
  return rows.rows ?? [];
}

// ─── Committee queries ───────────────────────────────────────────────────────

export async function getMemberCommittees(bioguideId: string) {
  return db
    .select({
      committeeId: committees.committeeId,
      name: committees.name,
      chamber: committees.chamber,
      role: committeeAssignments.role,
      parentId: committees.parentId,
    })
    .from(committeeAssignments)
    .innerJoin(
      committees,
      eq(committeeAssignments.committeeId, committees.committeeId)
    )
    .where(eq(committeeAssignments.bioguideId, bioguideId))
    .orderBy(committees.name);
}

export async function getStateCommitteeCoverage(stateCode: string) {
  return db
    .select({
      committeeId: committees.committeeId,
      committeeName: committees.name,
      committeeChamber: committees.chamber,
      memberName: members.fullName,
      memberParty: members.party,
      bioguideId: members.bioguideId,
      role: committeeAssignments.role,
    })
    .from(committeeAssignments)
    .innerJoin(
      committees,
      eq(committeeAssignments.committeeId, committees.committeeId)
    )
    .innerJoin(
      members,
      eq(committeeAssignments.bioguideId, members.bioguideId)
    )
    .where(
      and(
        eq(members.stateCode, stateCode.toUpperCase()),
        eq(members.inOffice, true),
        sql`${committees.parentId} IS NULL` // top-level committees only
      )
    )
    .orderBy(committees.name);
}

// ─── Bill queries ────────────────────────────────────────────────────────────

export async function getMemberBills(bioguideId: string, limit = 20) {
  return db
    .select({
      billId: bills.billId,
      billType: bills.billType,
      billNumber: bills.billNumber,
      congress: bills.congress,
      title: bills.title,
      introducedDate: bills.introducedDate,
      latestActionDate: bills.latestActionDate,
      latestActionText: bills.latestActionText,
      policyArea: bills.policyArea,
      billUrl: bills.billUrl,
      role: billSponsorships.role,
    })
    .from(billSponsorships)
    .innerJoin(bills, eq(billSponsorships.billId, bills.billId))
    .where(eq(billSponsorships.bioguideId, bioguideId))
    .orderBy(desc(bills.introducedDate))
    .limit(limit);
}

export interface BillSearchOpts {
  topic?: string;
  policyArea?: string;
  congress?: number;
  role?: "sponsor" | "cosponsor";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface BillSearchRow {
  bill_id: string;
  bill_type: string;
  bill_number: number;
  congress: number;
  title: string;
  introduced_date: string | null;
  latest_action_text: string | null;
  policy_area: string | null;
  role: string;
  total_matched: number;
}

// Same idea as searchMemberVotes: the member's full sponsorship history with
// optional topic, policy-area, congress, role, and date filters.
export async function searchMemberBills(
  bioguideId: string,
  opts: BillSearchOpts = {}
) {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
  const conditions = [sql`bs.bioguide_id = ${bioguideId}`];
  const words = (opts.topic ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  for (const word of words) {
    const like = `%${word}%`;
    conditions.push(
      sql`(b.title || ' ' || COALESCE(b.policy_area, '')) ILIKE ${like}`
    );
  }
  if (opts.policyArea) {
    conditions.push(sql`b.policy_area ILIKE ${`%${opts.policyArea}%`}`);
  }
  if (opts.congress) conditions.push(sql`b.congress = ${opts.congress}`);
  if (opts.role) conditions.push(sql`bs.role = ${opts.role}`);
  if (opts.dateFrom) conditions.push(sql`b.introduced_date >= ${opts.dateFrom}`);
  if (opts.dateTo) conditions.push(sql`b.introduced_date <= ${opts.dateTo}`);

  const result = (await db.execute(sql`
    SELECT b.bill_id, b.bill_type, b.bill_number, b.congress, b.title,
           b.introduced_date, b.latest_action_text, b.policy_area,
           bs.role, COUNT(*) OVER ()::int AS total_matched
    FROM bill_sponsorships bs
    JOIN bills b ON bs.bill_id = b.bill_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY b.introduced_date DESC NULLS LAST
    LIMIT ${limit}
  `)) as unknown as { rows: BillSearchRow[] };
  const records = result.rows ?? [];
  return { totalMatched: records[0]?.total_matched ?? 0, records };
}

export async function getMemberBillCount(bioguideId: string) {
  const [[sponsored], [cosponsored]] = await Promise.all([
    db
      .select({ count: count() })
      .from(billSponsorships)
      .where(
        and(
          eq(billSponsorships.bioguideId, bioguideId),
          eq(billSponsorships.role, "sponsor")
        )
      ),
    db
      .select({ count: count() })
      .from(billSponsorships)
      .where(
        and(
          eq(billSponsorships.bioguideId, bioguideId),
          eq(billSponsorships.role, "cosponsor")
        )
      ),
  ]);
  return {
    sponsored: sponsored?.count || 0,
    cosponsored: cosponsored?.count || 0,
  };
}

export async function getRecentStateBills(stateCode: string, limit = 15) {
  return db
    .select({
      billId: bills.billId,
      billType: bills.billType,
      billNumber: bills.billNumber,
      title: bills.title,
      introducedDate: bills.introducedDate,
      latestActionDate: bills.latestActionDate,
      latestActionText: bills.latestActionText,
      policyArea: bills.policyArea,
      billUrl: bills.billUrl,
      sponsorRole: billSponsorships.role,
      sponsorName: members.fullName,
      sponsorParty: members.party,
      sponsorBioguideId: members.bioguideId,
    })
    .from(billSponsorships)
    .innerJoin(bills, eq(billSponsorships.billId, bills.billId))
    .innerJoin(members, eq(billSponsorships.bioguideId, members.bioguideId))
    .where(
      and(
        eq(members.stateCode, stateCode.toUpperCase()),
        eq(billSponsorships.role, "sponsor")
      )
    )
    .orderBy(desc(bills.introducedDate))
    .limit(limit);
}

// ─── Finance queries ─────────────────────────────────────────────────────────

export async function getMemberFinance(bioguideId: string, cycle?: number) {
  return db
    .select()
    .from(campaignFinance)
    .where(
      cycle
        ? and(
            eq(campaignFinance.bioguideId, bioguideId),
            eq(campaignFinance.electionCycle, cycle)
          )
        : eq(campaignFinance.bioguideId, bioguideId)
    )
    .orderBy(desc(campaignFinance.electionCycle));
}

export async function getMemberTopContributors(
  bioguideId: string,
  cycle?: number
) {
  return db
    .select()
    .from(topContributors)
    .where(
      cycle
        ? and(
            eq(topContributors.bioguideId, bioguideId),
            eq(topContributors.electionCycle, cycle)
          )
        : eq(topContributors.bioguideId, bioguideId)
    )
    .orderBy(desc(topContributors.totalAmount))
    .limit(10);
}

// A member's linked FEC committees (principal, authorized, leadership PAC,
// joint fundraising) with the requested cycle's totals attached.
export async function getMemberFinanceCommittees(
  bioguideId: string,
  cycle = 2026
) {
  return db
    .select({
      committeeId: financeCommittees.committeeId,
      name: financeCommittees.name,
      designation: financeCommittees.designation,
      totalReceipts: committeeFinance.totalReceipts,
      cashOnHand: committeeFinance.cashOnHand,
    })
    .from(financeCommittees)
    .leftJoin(
      committeeFinance,
      and(
        eq(committeeFinance.committeeId, financeCommittees.committeeId),
        eq(committeeFinance.electionCycle, cycle)
      )
    )
    .where(eq(financeCommittees.bioguideId, bioguideId))
    .orderBy(
      financeCommittees.designation,
      desc(committeeFinance.totalReceipts)
    );
}

export async function getStateDelegationFinance(stateCode: string) {
  return db
    .select({
      bioguideId: members.bioguideId,
      fullName: members.fullName,
      party: members.party,
      chamber: members.chamber,
      totalReceipts: campaignFinance.totalReceipts,
      totalIndividual: campaignFinance.totalIndividual,
      totalPac: campaignFinance.totalPac,
      smallIndividual: campaignFinance.smallIndividual,
      electionCycle: campaignFinance.electionCycle,
    })
    .from(members)
    .innerJoin(
      campaignFinance,
      eq(members.bioguideId, campaignFinance.bioguideId)
    )
    .where(
      and(
        eq(members.stateCode, stateCode.toUpperCase()),
        eq(members.inOffice, true)
      )
    )
    .orderBy(desc(campaignFinance.totalReceipts));
}

// ─── Vote queries ────────────────────────────────────────────────────────────

export async function getMemberVoteSummary(bioguideId: string) {
  const rows = await db
    .select({
      position: votePositions.position,
      count: count(),
    })
    .from(votePositions)
    .where(eq(votePositions.bioguideId, bioguideId))
    .groupBy(votePositions.position);

  const summary = { yea: 0, nay: 0, present: 0, notVoting: 0, total: 0 };
  for (const r of rows) {
    if (r.position === "yea") summary.yea = r.count;
    else if (r.position === "nay") summary.nay = r.count;
    else if (r.position === "present") summary.present = r.count;
    else summary.notVoting = r.count;
    summary.total += r.count;
  }
  return summary;
}

export interface VoteSearchOpts {
  topic?: string;
  dateFrom?: string;
  dateTo?: string;
  congress?: number;
  limit?: number;
}

export interface VoteSearchRow {
  vote_id: string;
  chamber: string;
  congress: number;
  roll_number: number;
  vote_date: string;
  question: string | null;
  description: string | null;
  result: string | null;
  yeas: number;
  nays: number;
  position: string;
  total_matched: number;
}

// Searches a member's full ingested roll-call history rather than paging the
// most recent N. Topic words AND together over the vote text plus the linked
// bill's title and policy area; ILIKE is fine because the scan is bounded by
// idx_votepos_member to one member's positions.
export async function searchMemberVotes(
  bioguideId: string,
  opts: VoteSearchOpts = {}
) {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
  const conditions = [sql`vp.bioguide_id = ${bioguideId}`];
  const words = (opts.topic ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  for (const word of words) {
    const like = `%${word}%`;
    conditions.push(
      sql`(COALESCE(v.question, '') || ' ' || COALESCE(v.description, '') || ' ' || COALESCE(b.title, '') || ' ' || COALESCE(b.policy_area, '')) ILIKE ${like}`
    );
  }
  if (opts.dateFrom) conditions.push(sql`v.vote_date >= ${opts.dateFrom}`);
  if (opts.dateTo) conditions.push(sql`v.vote_date <= ${opts.dateTo}`);
  if (opts.congress) conditions.push(sql`v.congress = ${opts.congress}`);

  const result = (await db.execute(sql`
    SELECT v.vote_id, v.chamber, v.congress, v.roll_number, v.vote_date,
           v.question, v.description, v.result, v.yeas, v.nays,
           vp.position, COUNT(*) OVER ()::int AS total_matched
    FROM vote_positions vp
    JOIN votes v ON vp.vote_id = v.vote_id
    LEFT JOIN bills b ON v.bill_id = b.bill_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY v.vote_date DESC, v.roll_number DESC
    LIMIT ${limit}
  `)) as unknown as { rows: VoteSearchRow[] };
  const records = result.rows ?? [];
  return { totalMatched: records[0]?.total_matched ?? 0, records };
}

export async function getMemberRecentVotes(bioguideId: string, limit = 15) {
  return db
    .select({
      voteId: votes.voteId,
      chamber: votes.chamber,
      rollNumber: votes.rollNumber,
      voteDate: votes.voteDate,
      question: votes.question,
      description: votes.description,
      result: votes.result,
      yeas: votes.yeas,
      nays: votes.nays,
      position: votePositions.position,
    })
    .from(votePositions)
    .innerJoin(votes, eq(votePositions.voteId, votes.voteId))
    .where(eq(votePositions.bioguideId, bioguideId))
    .orderBy(desc(votes.voteDate))
    .limit(limit);
}

// ─── Event queries ───────────────────────────────────────────────────────────

export async function getStateEvents(stateCode: string, limit = 15) {
  return db
    .select()
    .from(events)
    .where(eq(events.stateCode, stateCode.toUpperCase()))
    .orderBy(desc(events.eventDate))
    .limit(limit);
}

export async function getRecentEvents(limit = 20) {
  return db
    .select({
      id: events.id,
      eventType: events.eventType,
      title: events.title,
      description: events.description,
      eventDate: events.eventDate,
      stateCode: events.stateCode,
      bioguideId: events.bioguideId,
    })
    .from(events)
    .orderBy(desc(events.eventDate))
    .limit(limit);
}

// ─── Brief queries ───────────────────────────────────────────────────────────

export async function getStateBrief(stateCode: string) {
  const [brief] = await db
    .select()
    .from(delegationBriefs)
    .where(eq(delegationBriefs.stateCode, stateCode.toUpperCase()))
    .orderBy(desc(delegationBriefs.generatedAt))
    .limit(1);
  return brief || null;
}

// ─── Data coverage queries ───────────────────────────────────────────────────

export type CoverageStatus = "good" | "partial" | "none";

export interface MemberCoverage {
  bills: CoverageStatus;
  finance: CoverageStatus;
  votes: CoverageStatus;
  pressReleases: CoverageStatus;
  committees: CoverageStatus;
}

export async function getMemberCoverage(
  bioguideId: string
): Promise<MemberCoverage> {
  const [[billRow], [financeRow], [voteRow], [pressRow], [committeeRow]] =
    await Promise.all([
      db
        .select({ count: count() })
        .from(billSponsorships)
        .where(eq(billSponsorships.bioguideId, bioguideId)),
      db
        .select({ count: count() })
        .from(campaignFinance)
        .where(eq(campaignFinance.bioguideId, bioguideId)),
      db
        .select({ count: count() })
        .from(votePositions)
        .where(eq(votePositions.bioguideId, bioguideId)),
      db
        .select({ count: count() })
        .from(pressReleases)
        .where(eq(pressReleases.bioguideId, bioguideId)),
      db
        .select({ count: count() })
        .from(committeeAssignments)
        .where(eq(committeeAssignments.bioguideId, bioguideId)),
    ]);

  return {
    bills: (billRow?.count || 0) > 0 ? "good" : "none",
    finance: (financeRow?.count || 0) > 0 ? "good" : "none",
    votes: (voteRow?.count || 0) > 0 ? "good" : "none",
    pressReleases:
      (pressRow?.count || 0) > 0
        ? "good"
        : "none", // "none" means no RSS feed found
    committees: (committeeRow?.count || 0) > 0 ? "good" : "none",
  };
}

export type CoverageDetailItem = {
  source: "bills" | "votes" | "committees" | "finance" | "press" | "trades";
  label: string;
  count: number;
  status: "present" | "expected_empty" | "missing";
  description: string;
};

// Reasoned coverage per data source for a single member. Renders the why
// behind a zero count so a casual visitor reads the gap as intentional rather
// than broken.
export async function getMemberCoverageDetail(
  bioguideId: string
): Promise<CoverageDetailItem[]> {
  const [
    [billsRow],
    [voteRow],
    [committeeRow],
    [financeRow],
    [pressRow],
    [tradeRow],
    [filingRow],
    [memberRow],
  ] = await Promise.all([
    db.select({ n: count() }).from(billSponsorships).where(eq(billSponsorships.bioguideId, bioguideId)),
    db.select({ n: count() }).from(votePositions).where(eq(votePositions.bioguideId, bioguideId)),
    db.select({ n: count() }).from(committeeAssignments).where(eq(committeeAssignments.bioguideId, bioguideId)),
    db.select({ n: count() }).from(campaignFinance).where(eq(campaignFinance.bioguideId, bioguideId)),
    db.select({ n: count() }).from(pressReleases).where(eq(pressReleases.bioguideId, bioguideId)),
    db
      .select({ n: count() })
      .from(stockTransactions)
      .where(eq(stockTransactions.bioguideId, bioguideId)),
    db
      .select({ n: count() })
      .from(disclosureFilings)
      .where(eq(disclosureFilings.bioguideId, bioguideId)),
    db
      .select({ fecCandidateId: members.fecCandidateId, chamber: members.chamber })
      .from(members)
      .where(eq(members.bioguideId, bioguideId))
      .limit(1),
  ]);

  const bills = billsRow?.n ?? 0;
  const votes = voteRow?.n ?? 0;
  const committees = committeeRow?.n ?? 0;
  const finance = financeRow?.n ?? 0;
  const press = pressRow?.n ?? 0;
  const trades = tradeRow?.n ?? 0;
  const filings = filingRow?.n ?? 0;

  const items: CoverageDetailItem[] = [
    {
      source: "bills",
      label: "Bills",
      count: bills,
      status: bills > 0 ? "present" : "missing",
      description:
        bills > 0
          ? "Sponsored or cosponsored bills tracked from Congress.gov."
          : "Member has not sponsored or cosponsored any bills in the active Congress.",
    },
    {
      source: "votes",
      label: "Votes",
      count: votes,
      status: votes > 0 ? "present" : "missing",
      description:
        votes > 0
          ? "Roll-call positions parsed from official chamber XML."
          : "No recorded roll-call positions yet — likely a brand-new member or a chamber with sparse recent activity.",
    },
    {
      source: "committees",
      label: "Committees",
      count: committees,
      status: committees > 0 ? "present" : "missing",
      description:
        committees > 0
          ? "Standing assignments from the @unitedstates project."
          : "No committee assignments on record. Verify against the chamber's committee directory.",
    },
    {
      source: "finance",
      label: "Campaign finance",
      count: finance,
      status: finance > 0 ? "present" : memberRow?.fecCandidateId ? "missing" : "expected_empty",
      description:
        finance > 0
          ? "Top-line FEC numbers per election cycle."
          : memberRow?.fecCandidateId
            ? "FEC candidate ID is set but no committee data ingested yet."
            : "No FEC candidate ID linked to this member yet.",
    },
    {
      source: "press",
      label: "Press releases",
      count: press,
      status: press > 0 ? "present" : "expected_empty",
      description:
        press > 0
          ? "Pulled from the member's official RSS feed."
          : "Office does not publish a discoverable RSS feed. Many members of Congress communicate primarily through social media and email lists rather than RSS.",
    },
    {
      source: "trades",
      label: "Stock disclosures — coming feature",
      count: trades,
      status: trades > 0 ? "present" : "expected_empty",
      description:
        trades > 0
          ? `Preview infrastructure has parsed line items from ${filings} PTR filing${filings === 1 ? "" : "s"}; coverage is not yet comprehensive.`
          : "No validated preview rows are loaded for this member. This is not evidence that the member did not file or trade.",
    },
  ];

  return items;
}

export async function getStateCoverage(stateCode: string) {
  const code = stateCode.toUpperCase();
  const membersList = await db
    .select({ bioguideId: members.bioguideId })
    .from(members)
    .where(and(eq(members.stateCode, code), eq(members.inOffice, true)));

  const ids = membersList.map((m) => m.bioguideId);
  if (ids.length === 0) return null;

  const [[pressRows], [financeRows]] = await Promise.all([
    db
      .select({ count: sql<number>`count(DISTINCT ${pressReleases.bioguideId})` })
      .from(pressReleases)
      .where(sql`${pressReleases.bioguideId} IN ${ids}`),
    db
      .select({ count: sql<number>`count(DISTINCT ${campaignFinance.bioguideId})` })
      .from(campaignFinance)
      .where(sql`${campaignFinance.bioguideId} IN ${ids}`),
  ]);

  return {
    totalMembers: ids.length,
    membersWithPressReleases: Number(pressRows?.count || 0),
    membersWithFinance: Number(financeRows?.count || 0),
  };
}

// ─── Press release queries ───────────────────────────────────────────────────

export async function getMemberPressReleases(bioguideId: string, limit = 10) {
  return db
    .select()
    .from(pressReleases)
    .where(eq(pressReleases.bioguideId, bioguideId))
    .orderBy(desc(pressReleases.publishedAt))
    .limit(limit);
}

export async function getMemberPressReleaseCount(bioguideId: string) {
  const [result] = await db
    .select({ count: count() })
    .from(pressReleases)
    .where(eq(pressReleases.bioguideId, bioguideId));
  return result?.count || 0;
}

export async function getStatePressReleases(stateCode: string, limit = 10) {
  return db
    .select({
      id: pressReleases.id,
      title: pressReleases.title,
      url: pressReleases.url,
      publishedAt: pressReleases.publishedAt,
      bioguideId: pressReleases.bioguideId,
      memberName: members.fullName,
      memberParty: members.party,
    })
    .from(pressReleases)
    .innerJoin(members, eq(pressReleases.bioguideId, members.bioguideId))
    .where(
      and(
        eq(members.stateCode, stateCode.toUpperCase()),
        eq(members.inOffice, true)
      )
    )
    .orderBy(desc(pressReleases.publishedAt))
    .limit(limit);
}

// ─── Press analytics queries ─────────────────────────────────────────────────

export async function getStatePressRankings(stateCode: string) {
  return db
    .select({
      bioguideId: members.bioguideId,
      fullName: members.fullName,
      party: members.party,
      chamber: members.chamber,
      releaseCount: count(pressReleases.id),
    })
    .from(members)
    .leftJoin(
      pressReleases,
      eq(members.bioguideId, pressReleases.bioguideId)
    )
    .where(
      and(
        eq(members.stateCode, stateCode.toUpperCase()),
        eq(members.inOffice, true)
      )
    )
    .groupBy(
      members.bioguideId,
      members.fullName,
      members.party,
      members.chamber
    )
    .orderBy(desc(count(pressReleases.id)));
}

export async function getStatePressReleaseTitles(stateCode: string) {
  const rows = await db
    .select({ title: pressReleases.title })
    .from(pressReleases)
    .innerJoin(members, eq(pressReleases.bioguideId, members.bioguideId))
    .where(
      and(
        eq(members.stateCode, stateCode.toUpperCase()),
        eq(members.inOffice, true)
      )
    );
  return rows.map((r) => r.title);
}

export async function getMemberActivityData(bioguideId: string) {
  const [prs, billData, voteData] = await Promise.all([
    db
      .select({
        title: pressReleases.title,
        publishedAt: pressReleases.publishedAt,
        url: pressReleases.url,
      })
      .from(pressReleases)
      .where(eq(pressReleases.bioguideId, bioguideId))
      .orderBy(desc(pressReleases.publishedAt))
      .limit(50),
    db
      .select({
        title: bills.title,
        introducedDate: bills.introducedDate,
        billType: bills.billType,
        billNumber: bills.billNumber,
        role: billSponsorships.role,
      })
      .from(billSponsorships)
      .innerJoin(bills, eq(billSponsorships.billId, bills.billId))
      .where(eq(billSponsorships.bioguideId, bioguideId))
      .orderBy(desc(bills.introducedDate))
      .limit(30),
    db
      .select({
        voteDate: votes.voteDate,
        description: votes.description,
        question: votes.question,
        position: votePositions.position,
        result: votes.result,
      })
      .from(votePositions)
      .innerJoin(votes, eq(votePositions.voteId, votes.voteId))
      .where(eq(votePositions.bioguideId, bioguideId))
      .orderBy(desc(votes.voteDate))
      .limit(30),
  ]);

  return { pressReleases: prs, bills: billData, votes: voteData };
}

// ─── Compare queries ────────────────────────────────────────────────────────

export async function getVotingAgreement(idA: string, idB: string) {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::text AS shared_votes,
      SUM(CASE WHEN a.position = b.position THEN 1 ELSE 0 END)::text AS agreed
    FROM vote_positions a
    JOIN vote_positions b ON a.vote_id = b.vote_id
    WHERE a.bioguide_id = ${idA}
      AND b.bioguide_id = ${idB}
      AND a.position IN ('yea', 'nay')
      AND b.position IN ('yea', 'nay')
  `);
  const row = result.rows[0] as
    | { shared_votes: string; agreed: string }
    | undefined;
  const shared = parseInt(row?.shared_votes || "0", 10);
  const agreed = parseInt(row?.agreed || "0", 10);
  return {
    sharedVotes: shared,
    agreed,
    agreementPct: shared > 0 ? Math.round((agreed / shared) * 100) : 0,
  };
}

export async function getAllMembersForPicker() {
  return db
    .select({
      bioguideId: members.bioguideId,
      fullName: members.fullName,
      party: members.party,
      stateCode: members.stateCode,
      chamber: members.chamber,
      district: members.district,
    })
    .from(members)
    .where(eq(members.inOffice, true))
    .orderBy(members.stateCode, members.lastName);
}

export async function getDelegationBillCount(stateCode: string) {
  const [result] = await db
    .select({ count: count() })
    .from(billSponsorships)
    .innerJoin(members, eq(billSponsorships.bioguideId, members.bioguideId))
    .where(
      and(
        eq(members.stateCode, stateCode.toUpperCase()),
        eq(members.inOffice, true),
        eq(billSponsorships.role, "sponsor")
      )
    );
  return result?.count || 0;
}

export async function getDelegationBillCounts(stateCode: string) {
  return db
    .select({
      bioguideId: members.bioguideId,
      role: billSponsorships.role,
      count: count(),
    })
    .from(billSponsorships)
    .innerJoin(members, eq(billSponsorships.bioguideId, members.bioguideId))
    .where(
      and(
        eq(members.stateCode, stateCode.toUpperCase()),
        eq(members.inOffice, true)
      )
    )
    .groupBy(members.bioguideId, billSponsorships.role);
}

export async function getDelegationVoteSummaries(stateCode: string) {
  return db
    .select({
      bioguideId: members.bioguideId,
      position: votePositions.position,
      count: count(),
    })
    .from(votePositions)
    .innerJoin(members, eq(votePositions.bioguideId, members.bioguideId))
    .where(
      and(
        eq(members.stateCode, stateCode.toUpperCase()),
        eq(members.inOffice, true)
      )
    )
    .groupBy(members.bioguideId, votePositions.position);
}

// ─── Sync queries ────────────────────────────────────────────────────────────

export async function getLatestSync() {
  const [latest] = await db
    .select()
    .from(syncLog)
    .where(eq(syncLog.status, "success"))
    .orderBy(desc(syncLog.completedAt))
    .limit(1);
  return latest || null;
}

export async function getSyncSummary() {
  // Freshness age comes from the most recent successful sync that actually
  // wrote rows (i.e. when the data last changed), but the displayed count is
  // the real table depth — sync_log's records_count is the last run's
  // incremental batch size, which made a 2,811-row finance table render as
  // "1 records" on the homepage.
  // Audit-type rows (e.g. capitoltrades_divergence) aren't data sources,
  // they're meta-checks — exclude them so they don't render in the
  // homepage freshness panel as if they were.
  const [rows, depthRows] = await Promise.all([
    db.execute(sql`
      SELECT DISTINCT ON (source, entity_type)
        source, entity_type, records_count, completed_at
      FROM sync_log
      WHERE status = 'success'
        AND records_count > 0
        AND entity_type <> 'audit'
      ORDER BY source, entity_type, completed_at DESC
    `),
    db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM members WHERE in_office = true) AS members,
        (SELECT COUNT(*) FROM committee_assignments) AS committees,
        (SELECT COUNT(*) FROM bills) AS bills,
        (SELECT COUNT(*) FROM campaign_finance) AS campaign_finance,
        (SELECT COUNT(*) FROM finance_committees) AS finance_committees,
        (SELECT COUNT(*) FROM vote_positions) AS votes,
        (SELECT COUNT(*) FROM press_releases) AS press_releases,
        (SELECT COUNT(*) FROM stock_transactions) AS disclosures,
        (SELECT COUNT(*) FROM stock_transactions) AS ptr,
        (SELECT COUNT(*) FROM election_candidates) AS candidates
    `),
  ]);
  const depths = (depthRows.rows?.[0] ?? {}) as Record<string, unknown>;
  return (
    rows.rows as {
      source: string;
      entity_type: string;
      records_count: number;
      completed_at: string;
    }[]
  ).map((r) => ({
    ...r,
    records_count: Number(depths[r.entity_type] ?? r.records_count),
  }));
}

// Party composition per chamber for the homepage hemicycle. Voting seats
// only: territory and DC delegates sit in the House but do not vote, so the
// 435/100 seat math excludes them. Anything not D or R buckets as
// independent; the remainder against the seat count is shown as vacant.
export async function getChamberComposition() {
  const rows = (await db.execute(sql`
    SELECT chamber, party, COUNT(*)::int AS n
    FROM members
    WHERE in_office = true
      AND state_code NOT IN ('DC', 'AS', 'GU', 'MP', 'PR', 'VI')
    GROUP BY chamber, party
  `)) as unknown as {
    rows: { chamber: string; party: string; n: number }[];
  };

  const empty = () => ({ democrat: 0, republican: 0, independent: 0, vacant: 0 });
  const comp = { house: empty(), senate: empty() };
  for (const r of rows.rows ?? []) {
    const side = r.chamber === "senate" ? comp.senate : comp.house;
    if (r.party === "Democrat") side.democrat += Number(r.n);
    else if (r.party === "Republican") side.republican += Number(r.n);
    else side.independent += Number(r.n);
  }
  comp.house.vacant = Math.max(
    0,
    435 - comp.house.democrat - comp.house.republican - comp.house.independent
  );
  comp.senate.vacant = Math.max(
    0,
    100 - comp.senate.democrat - comp.senate.republican - comp.senate.independent
  );
  return comp;
}

export async function getTotalMemberCount() {
  const [result] = await db
    .select({ count: count(members.bioguideId) })
    .from(members)
    .where(eq(members.inOffice, true));
  return result?.count || 0;
}
