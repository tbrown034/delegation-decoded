import { config } from "dotenv";
config({ path: ".env.local" });
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { committees, committeeAssignments, syncLog } from "../../lib/schema";
import { sql } from "drizzle-orm";
import {
  fetchCommittees,
  fetchCommitteeMembership,
} from "../lib/unitedstates";

const CURRENT_CONGRESS = 119;

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  const [syncEntry] = await db
    .insert(syncLog)
    .values({
      source: "unitedstates",
      entityType: "committees",
      status: "running",
    })
    .returning();

  try {
    console.log("Fetching committees from @unitedstates...");
    const committeeData = await fetchCommittees();

    console.log(`Processing ${committeeData.length} committees...`);

    let committeeCount = 0;
    for (const c of committeeData) {
      const id =
        c.thomas_id ||
        c.house_committee_id ||
        c.senate_committee_id ||
        "";
      if (!id) continue;

      await db
        .insert(committees)
        .values({
          committeeId: id,
          name: c.name,
          chamber: c.type,
          parentId: null,
          url: c.url || null,
        })
        .onConflictDoUpdate({
          target: committees.committeeId,
          set: {
            name: sql`excluded.name`,
            chamber: sql`excluded.chamber`,
            url: sql`excluded.url`,
          },
        });
      committeeCount++;

      // Process subcommittees
      if (c.subcommittees) {
        for (const sub of c.subcommittees) {
          const subId = `${id}${sub.thomas_id}`;
          await db
            .insert(committees)
            .values({
              committeeId: subId,
              name: sub.name,
              chamber: c.type,
              parentId: id,
              url: null,
            })
            .onConflictDoUpdate({
              target: committees.committeeId,
              set: {
                name: sql`excluded.name`,
                chamber: sql`excluded.chamber`,
                parentId: sql`excluded.parent_id`,
              },
            });
          committeeCount++;
        }
      }
    }

    console.log(`Ingested ${committeeCount} committees. Fetching memberships...`);

    const membership = await fetchCommitteeMembership();
    let assignmentCount = 0;

    for (const [committeeId, memberList] of Object.entries(membership)) {
      for (const m of memberList) {
        if (!m.bioguide) continue;

        const role =
          m.title === "Chair" || m.title === "Chairman"
            ? "chair"
            : m.title === "Ranking Member"
              ? "ranking_member"
              : m.title === "Vice Chair" || m.title === "Vice Chairman"
                ? "vice_chair"
                : "member";

        try {
          await db
            .insert(committeeAssignments)
            .values({
              bioguideId: m.bioguide,
              committeeId,
              role,
              congress: CURRENT_CONGRESS,
            })
            .onConflictDoNothing();
          assignmentCount++;
        } catch {
          // Skip if foreign key violation (member not in our DB)
        }
      }
    }

    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsCount: committeeCount + assignmentCount,
      })
      .where(sql`id = ${syncEntry.id}`);

    console.log(
      `Done. ${committeeCount} committees, ${assignmentCount} assignments.`
    );
  } catch (err) {
    await db
      .update(syncLog)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(sql`id = ${syncEntry.id}`);
    throw err;
  }
}

main().catch((err) => {
  console.error("Failed to ingest committees:", err);
  process.exit(1);
});
