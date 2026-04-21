import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  events,
  members,
  bills,
  billSponsorships,
  votes,
  votePositions,
  syncLog,
} from "../../lib/schema";
import { sql, eq, and, desc, isNotNull } from "drizzle-orm";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  console.log("Generating events from existing data...");

  let count = 0;

  // 1. Generate events from bill sponsorships
  console.log("  Processing bill introductions...");
  const sponsorships = await db
    .select({
      bioguideId: billSponsorships.bioguideId,
      billId: bills.billId,
      title: bills.title,
      billType: bills.billType,
      billNumber: bills.billNumber,
      introducedDate: bills.introducedDate,
      stateCode: members.stateCode,
      fullName: members.fullName,
      role: billSponsorships.role,
    })
    .from(billSponsorships)
    .innerJoin(bills, eq(billSponsorships.billId, bills.billId))
    .innerJoin(members, eq(billSponsorships.bioguideId, members.bioguideId))
    .where(
      and(
        eq(billSponsorships.role, "sponsor"),
        isNotNull(bills.introducedDate)
      )
    )
    .orderBy(desc(bills.introducedDate))
    .limit(500); // recent 500

  for (const s of sponsorships) {
    await db
      .insert(events)
      .values({
        eventType: "bill_introduced",
        bioguideId: s.bioguideId,
        stateCode: s.stateCode,
        title: `${s.fullName} introduced ${s.billType.toUpperCase()} ${s.billNumber}`,
        description: s.title,
        relatedId: s.billId,
        eventDate: s.introducedDate!,
      })
      .onConflictDoNothing();
    count++;
  }

  // 2. Generate events from votes (recent notable votes)
  console.log("  Processing votes...");
  const recentVotes = await db
    .select({
      voteId: votes.voteId,
      chamber: votes.chamber,
      voteDate: votes.voteDate,
      question: votes.question,
      description: votes.description,
      result: votes.result,
      yeas: votes.yeas,
      nays: votes.nays,
    })
    .from(votes)
    .orderBy(desc(votes.voteDate))
    .limit(100);

  for (const v of recentVotes) {
    // Find members who voted on this and create per-state events
    const positions = await db
      .select({
        bioguideId: votePositions.bioguideId,
        position: votePositions.position,
        stateCode: members.stateCode,
        fullName: members.fullName,
      })
      .from(votePositions)
      .innerJoin(members, eq(votePositions.bioguideId, members.bioguideId))
      .where(eq(votePositions.voteId, v.voteId));

    // Group by state for state-level events
    const byState = new Map<string, typeof positions>();
    for (const p of positions) {
      if (!byState.has(p.stateCode)) byState.set(p.stateCode, []);
      byState.get(p.stateCode)!.push(p);
    }

    for (const [stateCode, statePositions] of byState) {
      const yeas = statePositions.filter((p) => p.position === "yea").length;
      const nays = statePositions.filter((p) => p.position === "nay").length;
      const total = statePositions.length;

      const chamberLabel = v.chamber === "house" ? "House" : "Senate";
      const desc = v.description || v.question || "Vote";

      let title: string;
      if (yeas === total) {
        title = `${chamberLabel} vote: delegation voted unanimously Yea on ${desc}`;
      } else if (nays === total) {
        title = `${chamberLabel} vote: delegation voted unanimously Nay on ${desc}`;
      } else {
        title = `${chamberLabel} vote: ${yeas} Yea, ${nays} Nay on ${desc}`;
      }

      await db
        .insert(events)
        .values({
          eventType: "vote_cast",
          bioguideId: null,
          stateCode,
          title,
          description: `${v.result} (${v.yeas}-${v.nays})`,
          relatedId: v.voteId,
          eventDate: v.voteDate,
        })
        .onConflictDoNothing();
      count++;
    }
  }

  console.log(`Done. Generated ${count} events.`);
}

main().catch((err) => {
  console.error("Failed to generate events:", err);
  process.exit(1);
});
