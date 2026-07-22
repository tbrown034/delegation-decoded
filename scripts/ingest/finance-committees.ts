import "../lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  members,
  financeCommittees,
  committeeFinance,
  topContributors,
  syncLog,
} from "../../lib/schema";
import { sql, eq, and, isNotNull } from "drizzle-orm";
import {
  fetchCandidateCommittees,
  fetchCommitteeTotals,
  fetchTopContributorsByEmployer,
} from "../lib/fec-api";

// FEC allows 1,000 req/hr. Per member: 1 committee-list request, 1 totals
// request per committee (~2), and 1-2 by-employer requests for the principal
// committee. 600ms spacing keeps the effective rate near 100/min.
const DELAY_MS = 600;
const CURRENT_CYCLE = 2026;

// Employer strings that are FEC reporting categories, not organizations.
// Keeping them would make "Retired" the top contributor for most members.
const NON_EMPLOYERS = new Set([
  "RETIRED",
  "NOT EMPLOYED",
  "UNEMPLOYED",
  "SELF-EMPLOYED",
  "SELF EMPLOYED",
  "SELF",
  "NONE",
  "N/A",
  "INFORMATION REQUESTED",
  "INFORMATION REQUESTED PER BEST EFFORTS",
  "HOMEMAKER",
]);

const delay = () => new Promise((r) => setTimeout(r, DELAY_MS));

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.FEC_API_KEY) throw new Error("FEC_API_KEY is required");

  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  const [syncEntry] = await db
    .insert(syncLog)
    .values({
      source: "fec",
      entityType: "finance_committees",
      status: "running",
    })
    .returning();

  try {
    const membersWithFec = await db
      .select({
        bioguideId: members.bioguideId,
        fecCandidateId: members.fecCandidateId,
        fullName: members.fullName,
      })
      .from(members)
      .where(and(eq(members.inOffice, true), isNotNull(members.fecCandidateId)));

    // Members with no contributor rows also get the prior cycle on first run.
    const existingContribs = await db
      .select({ bioguideId: topContributors.bioguideId })
      .from(topContributors);
    const hasContribs = new Set(existingContribs.map((r) => r.bioguideId));

    console.log(`${membersWithFec.length} members with FEC IDs to process`);

    let committeeCount = 0;
    let cycleRowCount = 0;
    let contributorCount = 0;
    let errors = 0;

    for (let i = 0; i < membersWithFec.length; i++) {
      const member = membersWithFec[i];
      const fecId = member.fecCandidateId!;

      try {
        const committees = await fetchCandidateCommittees(fecId);
        await delay();

        for (const committee of committees) {
          if (!committee.committee_id || !committee.name) continue;
          const cycles = (committee.cycles ?? []).filter(Number.isFinite);
          await db
            .insert(financeCommittees)
            .values({
              committeeId: committee.committee_id,
              bioguideId: member.bioguideId,
              fecCandidateId: fecId,
              name: committee.name,
              designation: committee.designation?.slice(0, 1) ?? null,
              committeeType: committee.committee_type?.slice(0, 1) ?? null,
              firstCycle: cycles.length > 0 ? Math.min(...cycles) : null,
              lastCycle: cycles.length > 0 ? Math.max(...cycles) : null,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: financeCommittees.committeeId,
              set: {
                bioguideId: sql`excluded.bioguide_id`,
                fecCandidateId: sql`excluded.fec_candidate_id`,
                name: sql`excluded.name`,
                designation: sql`excluded.designation`,
                committeeType: sql`excluded.committee_type`,
                firstCycle: sql`excluded.first_cycle`,
                lastCycle: sql`excluded.last_cycle`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
          committeeCount++;

          const totals = await fetchCommitteeTotals(committee.committee_id);
          await delay();
          for (const t of totals) {
            if (!t.cycle) continue;
            await db
              .insert(committeeFinance)
              .values({
                committeeId: committee.committee_id,
                electionCycle: t.cycle,
                totalReceipts: Math.round(t.receipts || 0),
                totalDisbursements: Math.round(t.disbursements || 0),
                cashOnHand: Math.round(t.last_cash_on_hand_end_period || 0),
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [
                  committeeFinance.committeeId,
                  committeeFinance.electionCycle,
                ],
                set: {
                  totalReceipts: sql`excluded.total_receipts`,
                  totalDisbursements: sql`excluded.total_disbursements`,
                  cashOnHand: sql`excluded.cash_on_hand`,
                  updatedAt: sql`excluded.updated_at`,
                },
              });
            cycleRowCount++;
          }
        }

        // Top contributors by donor employer, principal committee only.
        const principal = committees.find((c) => c.designation === "P");
        if (principal) {
          const cyclesToFetch = hasContribs.has(member.bioguideId)
            ? [CURRENT_CYCLE]
            : [CURRENT_CYCLE, CURRENT_CYCLE - 2];
          for (const cycle of cyclesToFetch) {
            const rows = await fetchTopContributorsByEmployer(
              principal.committee_id,
              cycle
            );
            await delay();
            const top = rows
              .filter(
                (r) =>
                  r.employer &&
                  r.total &&
                  r.total > 0 &&
                  !NON_EMPLOYERS.has(r.employer.trim().toUpperCase())
              )
              .slice(0, 10);
            for (const row of top) {
              await db
                .insert(topContributors)
                .values({
                  bioguideId: member.bioguideId,
                  electionCycle: cycle,
                  contributorName: row.employer!.trim(),
                  contributorType: "employer",
                  totalAmount: Math.round(row.total!),
                  updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                  target: [
                    topContributors.bioguideId,
                    topContributors.electionCycle,
                    topContributors.contributorName,
                  ],
                  set: {
                    totalAmount: sql`excluded.total_amount`,
                    contributorType: sql`excluded.contributor_type`,
                    updatedAt: sql`excluded.updated_at`,
                  },
                });
              contributorCount++;
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429")) {
          console.log(
            `  Rate limited at member ${i + 1}/${membersWithFec.length}. Waiting 30s...`
          );
          await new Promise((r) => setTimeout(r, 30000));
          i--; // Retry this member
          continue;
        }
        errors++;
        if (errors <= 10) {
          console.log(
            `  Error for ${member.fullName} (${fecId}): ${msg.slice(0, 100)}`
          );
        }
      }

      if ((i + 1) % 25 === 0 || i === membersWithFec.length - 1) {
        console.log(
          `  ${i + 1}/${membersWithFec.length} processed — ${committeeCount} committees, ${cycleRowCount} cycle rows, ${contributorCount} contributors, ${errors} errors`
        );
      }
    }

    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsCount: committeeCount + cycleRowCount + contributorCount,
      })
      .where(sql`id = ${syncEntry.id}`);

    console.log(
      `Done. ${committeeCount} committees, ${cycleRowCount} cycle rows, ${contributorCount} contributor rows, ${errors} errors.`
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
  console.error("Failed to ingest finance committees:", err);
  process.exit(1);
});
