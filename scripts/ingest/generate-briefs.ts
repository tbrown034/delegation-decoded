import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  delegationBriefs,
  members,
  states,
  bills,
  billSponsorships,
  campaignFinance,
  votes,
  votePositions,
  committeeAssignments,
  committees,
} from "../../lib/schema";
import { sql, eq, and, desc, count, inArray } from "drizzle-orm";
import { STATES } from "../../lib/states";

function fmt(n: number | null): string {
  if (!n) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

async function generateBrief(
  db: ReturnType<typeof drizzle>,
  stateCode: string,
  stateName: string
) {
  // Get delegation
  const delegation = await db
    .select({
      bioguideId: members.bioguideId,
      fullName: members.fullName,
      party: members.party,
      chamber: members.chamber,
    })
    .from(members)
    .where(and(eq(members.stateCode, stateCode), eq(members.inOffice, true)));

  if (delegation.length === 0) return null;

  const senators = delegation.filter((m) => m.chamber === "senate");
  const reps = delegation.filter((m) => m.chamber === "house");
  const dems = delegation.filter((m) => m.party === "Democrat").length;
  const gop = delegation.filter((m) => m.party === "Republican").length;

  // Bills sponsored by this delegation
  const bioguideIds = delegation.map((m) => m.bioguideId);
  const sponsoredBills = await db
    .select({ count: count() })
    .from(billSponsorships)
    .where(
      and(
        eq(billSponsorships.role, "sponsor"),
        inArray(billSponsorships.bioguideId, bioguideIds)
      )
    );
  const totalSponsored = sponsoredBills[0]?.count || 0;

  // Top sponsors
  const topSponsors = await db
    .select({
      fullName: members.fullName,
      count: count(),
    })
    .from(billSponsorships)
    .innerJoin(members, eq(billSponsorships.bioguideId, members.bioguideId))
    .where(
      and(
        eq(billSponsorships.role, "sponsor"),
        inArray(billSponsorships.bioguideId, bioguideIds)
      )
    )
    .groupBy(members.fullName)
    .orderBy(desc(count()))
    .limit(3);

  // Finance totals
  const financeData = await db
    .select({
      totalReceipts: campaignFinance.totalReceipts,
      totalPac: campaignFinance.totalPac,
      smallIndividual: campaignFinance.smallIndividual,
      electionCycle: campaignFinance.electionCycle,
    })
    .from(campaignFinance)
    .where(inArray(campaignFinance.bioguideId, bioguideIds))
    .orderBy(desc(campaignFinance.electionCycle));

  // Get most recent cycle per member
  const latestCycleFinance = new Map<string, (typeof financeData)[0]>();
  for (const f of financeData) {
    // Just sum most recent entries
  }
  let totalRaised = 0;
  let totalPac = 0;
  let totalSmall = 0;
  const seenCycles = new Set<string>();
  for (const f of financeData) {
    const key = `${f.electionCycle}`;
    if (!seenCycles.has(key)) {
      totalRaised += f.totalReceipts || 0;
      totalPac += f.totalPac || 0;
      totalSmall += f.smallIndividual || 0;
    }
  }

  // Vote participation
  const voteCount = await db
    .select({ count: count() })
    .from(votePositions)
    .where(inArray(votePositions.bioguideId, bioguideIds));
  const totalVotes = voteCount[0]?.count || 0;

  // Committee seats count
  const committeeSeatCount = await db
    .select({ count: count() })
    .from(committeeAssignments)
    .where(inArray(committeeAssignments.bioguideId, bioguideIds));

  // Leadership roles
  const leadershipRoles = await db
    .select({
      fullName: members.fullName,
      committeeName: committees.name,
      role: committeeAssignments.role,
    })
    .from(committeeAssignments)
    .innerJoin(members, eq(committeeAssignments.bioguideId, members.bioguideId))
    .innerJoin(
      committees,
      eq(committeeAssignments.committeeId, committees.committeeId)
    )
    .where(
      and(
        inArray(committeeAssignments.bioguideId, bioguideIds),
        inArray(committeeAssignments.role, ["chair", "ranking_member", "vice_chair"]),
        sql`${committees.parentId} IS NULL`
      )
    );

  // Build the brief
  const lines: string[] = [];

  // Composition
  const partyDesc =
    dems === gop
      ? "evenly split between parties"
      : dems > gop
        ? `majority Democrat (${dems}D-${gop}R)`
        : `majority Republican (${gop}R-${dems}D)`;
  lines.push(
    `${stateName}'s delegation has ${senators.length} senator${senators.length !== 1 ? "s" : ""} and ${reps.length} representative${reps.length !== 1 ? "s" : ""}, ${partyDesc}.`
  );

  // Legislative activity
  if (totalSponsored > 0) {
    lines.push(
      `The delegation has sponsored ${totalSponsored} bills in the 119th Congress.`
    );
    if (topSponsors.length > 0) {
      const topNames = topSponsors
        .map((s) => `${s.fullName} (${s.count})`)
        .join(", ");
      lines.push(`Most active sponsors: ${topNames}.`);
    }
  }

  // Finance
  if (totalRaised > 0) {
    const pacPct =
      totalRaised > 0 ? ((totalPac / totalRaised) * 100).toFixed(0) : "0";
    lines.push(
      `Across the delegation, members have reported ${fmt(totalRaised)} in total receipts, with ${pacPct}% from PACs.`
    );
  }

  // Votes
  if (totalVotes > 0) {
    lines.push(
      `${totalVotes.toLocaleString()} individual vote positions have been recorded across the delegation.`
    );
  }

  // Committee leadership
  if (leadershipRoles.length > 0) {
    const roleDescs = leadershipRoles.map(
      (r) =>
        `${r.fullName} (${r.role?.replace("_", " ")} of ${r.committeeName})`
    );
    lines.push(
      `Committee leadership: ${roleDescs.join("; ")}.`
    );
  }

  // Committee coverage
  const seats = committeeSeatCount[0]?.count || 0;
  if (seats > 0) {
    lines.push(
      `The delegation holds ${seats} committee and subcommittee assignments.`
    );
  }

  const summary = lines.join(" ");
  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000)
    .toISOString()
    .split("T")[0];

  const stats = JSON.stringify({
    members: delegation.length,
    senators: senators.length,
    representatives: reps.length,
    democrat: dems,
    republican: gop,
    billsSponsored: totalSponsored,
    totalRaised,
    totalVotes,
    committeeSeats: seats,
    leadershipRoles: leadershipRoles.length,
  });

  await db.insert(delegationBriefs).values({
    stateCode,
    periodStart: weekAgo,
    periodEnd: today,
    summary,
    stats,
  });

  return summary;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  console.log("Generating delegation briefs for all states...");

  // Clear old briefs
  await db.delete(delegationBriefs);

  let count = 0;
  for (const state of STATES) {
    const result = await generateBrief(db, state.code, state.name);
    if (result) {
      count++;
      if (count % 10 === 0) console.log(`  ${count} briefs generated...`);
    }
  }

  console.log(`Done. Generated ${count} delegation briefs.`);
}

main().catch((err) => {
  console.error("Failed to generate briefs:", err);
  process.exit(1);
});
