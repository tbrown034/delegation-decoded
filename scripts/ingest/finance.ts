import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  members,
  campaignFinance,
  topContributors,
  syncLog,
} from "../../lib/schema";
import { sql, eq, and, isNotNull } from "drizzle-orm";
import {
  fetchCandidateFinancials,
  fetchTopContributors,
} from "../lib/fec-api";

const CURRENT_CYCLE = 2026;
const DELAY_MS = 400; // ~2.5 req/sec, conservative for FEC's 1000/hr limit

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.FEC_API_KEY) throw new Error("FEC_API_KEY is required");

  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  const [syncEntry] = await db
    .insert(syncLog)
    .values({
      source: "fec",
      entityType: "campaign_finance",
      status: "running",
    })
    .returning();

  try {
    // Get members who have FEC candidate IDs
    const membersWithFec = await db
      .select({
        bioguideId: members.bioguideId,
        fecCandidateId: members.fecCandidateId,
        fullName: members.fullName,
      })
      .from(members)
      .where(
        and(eq(members.inOffice, true), isNotNull(members.fecCandidateId))
      );

    console.log(
      `Fetching FEC data for ${membersWithFec.length} members with FEC IDs...`
    );

    let financeCount = 0;
    let contributorCount = 0;
    let errors = 0;

    for (const member of membersWithFec) {
      const fecId = member.fecCandidateId!;

      try {
        // Fetch financial totals
        const financials = await fetchCandidateFinancials(fecId);
        await new Promise((r) => setTimeout(r, DELAY_MS));

        for (const f of financials) {
          if (!f.cycle) continue; // Skip records without a valid cycle
          await db
            .insert(campaignFinance)
            .values({
              bioguideId: member.bioguideId,
              fecCandidateId: fecId,
              electionCycle: f.cycle,
              totalReceipts: Math.round(f.total_receipts || 0),
              totalDisbursements: Math.round(f.total_disbursements || 0),
              cashOnHand: Math.round(f.cash_on_hand_end_period || 0),
              totalIndividual: Math.round(
                f.total_individual_contributions || 0
              ),
              totalPac: Math.round(
                f.other_political_committee_contributions || 0
              ),
              smallIndividual: Math.round(
                f.individual_unitemized_contributions || 0
              ),
              lastFilingDate: f.coverage_end_date || null,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                campaignFinance.fecCandidateId,
                campaignFinance.electionCycle,
              ],
              set: {
                totalReceipts: sql`excluded.total_receipts`,
                totalDisbursements: sql`excluded.total_disbursements`,
                cashOnHand: sql`excluded.cash_on_hand`,
                totalIndividual: sql`excluded.total_individual`,
                totalPac: sql`excluded.total_pac`,
                smallIndividual: sql`excluded.small_individual`,
                lastFilingDate: sql`excluded.last_filing_date`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
          financeCount++;
        }

        // Fetch top contributors for latest cycle
        const contributors = await fetchTopContributors(fecId, CURRENT_CYCLE);
        await new Promise((r) => setTimeout(r, DELAY_MS));

        for (const c of contributors) {
          if (!c.committee_name || !c.total) continue;
          await db
            .insert(topContributors)
            .values({
              bioguideId: member.bioguideId,
              electionCycle: CURRENT_CYCLE,
              contributorName: c.committee_name,
              contributorType: "pac",
              totalAmount: Math.round(c.total),
              updatedAt: new Date(),
            })
            .onConflictDoNothing();
          contributorCount++;
        }
      } catch (err) {
        errors++;
        if (errors <= 5) {
          console.log(
            `  Error for ${member.fullName} (${fecId}): ${err instanceof Error ? err.message : err}`
          );
        }
      }

      if ((financeCount + errors) % 50 === 0) {
        console.log(
          `  Progress: ${financeCount} finance records, ${contributorCount} contributors, ${errors} errors`
        );
      }
    }

    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsCount: financeCount,
      })
      .where(sql`id = ${syncEntry.id}`);

    console.log(
      `Done. ${financeCount} finance records, ${contributorCount} contributors (${errors} errors).`
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
  console.error("Failed to ingest finance data:", err);
  process.exit(1);
});
