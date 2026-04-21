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
  syncLog,
} from "./schema";
import { eq, and, desc, sql, count, sum } from "drizzle-orm";

// ─── State queries ───────────────────────────────────────────────────────────

export async function getAllStatesWithCounts() {
  const rows = await db
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
    .orderBy(states.name);

  // Get party breakdowns per state
  const partyRows = await db
    .select({
      stateCode: members.stateCode,
      party: members.party,
      count: count(members.bioguideId),
    })
    .from(members)
    .where(eq(members.inOffice, true))
    .groupBy(members.stateCode, members.party);

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

export async function getMemberBillCount(bioguideId: string) {
  const [sponsored] = await db
    .select({ count: count() })
    .from(billSponsorships)
    .where(
      and(
        eq(billSponsorships.bioguideId, bioguideId),
        eq(billSponsorships.role, "sponsor")
      )
    );
  const [cosponsored] = await db
    .select({ count: count() })
    .from(billSponsorships)
    .where(
      and(
        eq(billSponsorships.bioguideId, bioguideId),
        eq(billSponsorships.role, "cosponsor")
      )
    );
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

export async function getMemberFinance(bioguideId: string) {
  return db
    .select()
    .from(campaignFinance)
    .where(eq(campaignFinance.bioguideId, bioguideId))
    .orderBy(desc(campaignFinance.electionCycle));
}

export async function getMemberTopContributors(
  bioguideId: string,
  cycle?: number
) {
  let query = db
    .select()
    .from(topContributors)
    .where(eq(topContributors.bioguideId, bioguideId))
    .orderBy(desc(topContributors.totalAmount))
    .limit(10);
  return query;
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

export async function getTotalMemberCount() {
  const [result] = await db
    .select({ count: count(members.bioguideId) })
    .from(members)
    .where(eq(members.inOffice, true));
  return result?.count || 0;
}
