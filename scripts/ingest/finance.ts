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
// FEC allows 1,000 req/hr. We make 1-2 requests per member.
// With 537 members, we need to be careful. 600ms delay = ~6000 req/hr theoretical
// but we only do 1 request at a time, so effective rate is ~100/min = safe.
const DELAY_MS = 600;

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
    // Get members who have FEC IDs
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

    // Check which members already have finance data
    const existingFinance = await db
      .select({ bioguideId: campaignFinance.bioguideId })
      .from(campaignFinance);
    const hasFinance = new Set(existingFinance.map((r) => r.bioguideId));

    // Only process members missing data
    const toProcess = membersWithFec.filter(
      (m) => !hasFinance.has(m.bioguideId)
    );

    console.log(
      `${membersWithFec.length} members with FEC IDs, ${hasFinance.size} already have data, ${toProcess.length} to process`
    );

    if (toProcess.length === 0) {
      console.log("All members have finance data. Nothing to do.");
      await db
        .update(syncLog)
        .set({
          status: "success",
          completedAt: new Date(),
          recordsCount: 0,
        })
        .where(sql`id = ${syncEntry.id}`);
      return;
    }

    let financeCount = 0;
    let contributorCount = 0;
    let errors = 0;
    let rateLimitHits = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const member = toProcess[i];
      const fecId = member.fecCandidateId!;

      try {
        // Fetch financial totals only (skip contributors to halve request count)
        const financials = await fetchCandidateFinancials(fecId);

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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429")) {
          rateLimitHits++;
          // Longer backoff on rate limit
          console.log(
            `  Rate limited at member ${i + 1}/${toProcess.length}. Waiting 30s...`
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

      // Progress logging
      if ((i + 1) % 25 === 0 || i === toProcess.length - 1) {
        console.log(
          `  ${i + 1}/${toProcess.length} processed — ${financeCount} records, ${errors} errors, ${rateLimitHits} rate limits`
        );
      }

      await new Promise((r) => setTimeout(r, DELAY_MS));
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
      `Done. ${financeCount} finance records, ${errors} errors, ${rateLimitHits} rate limit hits.`
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
