import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { bills, billSponsorships, syncLog, members } from "../../lib/schema";
import { sql, eq } from "drizzle-orm";
import {
  fetchBillsPage,
  fetchBillDetail,
  fetchCosponsors,
} from "../lib/congress-api";

const CONGRESS = 119;
// How many bills to ingest per run. Congress.gov has 15k+ bills.
// For MVP, we fetch bill details only for those sponsored by current members.
const BATCH_SIZE = 250;
const DETAIL_DELAY_MS = 200; // ~5 req/sec to stay under rate limits

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.CONGRESS_API_KEY)
    throw new Error("CONGRESS_API_KEY is required");

  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  const [syncEntry] = await db
    .insert(syncLog)
    .values({ source: "congress_gov", entityType: "bills", status: "running" })
    .returning();

  try {
    // Get all current member bioguide IDs so we can match sponsors
    const currentMembers = await db
      .select({ bioguideId: members.bioguideId })
      .from(members)
      .where(eq(members.inOffice, true));
    const memberIds = new Set(currentMembers.map((m) => m.bioguideId));

    // Get existing bill IDs to skip re-fetching details
    const existingBills = await db
      .select({ billId: bills.billId })
      .from(bills)
      .where(eq(bills.congress, CONGRESS));
    const existingBillIds = new Set(existingBills.map((b) => b.billId));

    console.log(
      `Fetching bills for ${CONGRESS}th Congress (${memberIds.size} members tracked, ${existingBillIds.size} already ingested)...`
    );

    let offset = 0;
    let totalProcessed = 0;
    let billsIngested = 0;
    let sponsorshipsIngested = 0;
    let skipped = 0;
    let hasMore = true;

    while (hasMore) {
      const { bills: billList, total } = await fetchBillsPage(
        CONGRESS,
        offset,
        BATCH_SIZE
      );

      if (billList.length === 0) break;
      if (offset === 0) console.log(`  Total bills in ${CONGRESS}th Congress: ${total}`);

      for (const b of billList) {
        totalProcessed++;

        // Skip bills we already have
        const candidateId = `${b.type.toLowerCase()}-${b.number}-${CONGRESS}`;
        if (existingBillIds.has(candidateId)) {
          skipped++;
          continue;
        }

        // Fetch detail to get sponsor info
        let detail;
        try {
          detail = await fetchBillDetail(CONGRESS, b.type, b.number);
          await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
        } catch (err) {
          console.log(`  Skipping ${b.type}${b.number}: ${err}`);
          continue;
        }

        const billData = detail.bill;
        const sponsors = billData.sponsors || [];

        // Only ingest bills that have at least one sponsor in our member database
        const relevantSponsors = sponsors.filter((s) =>
          memberIds.has(s.bioguideId)
        );
        if (relevantSponsors.length === 0) continue;

        const billId = `${b.type.toLowerCase()}-${b.number}-${CONGRESS}`;

        // Upsert bill
        await db
          .insert(bills)
          .values({
            billId,
            billType: b.type.toLowerCase(),
            billNumber: parseInt(b.number),
            congress: CONGRESS,
            title: billData.title,
            shortTitle: null,
            introducedDate: billData.introducedDate || null,
            latestActionDate: billData.latestAction?.actionDate || null,
            latestActionText: billData.latestAction?.text || null,
            policyArea: billData.policyArea?.name || null,
            billUrl: billData.legislationUrl || null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: bills.billId,
            set: {
              title: sql`excluded.title`,
              latestActionDate: sql`excluded.latest_action_date`,
              latestActionText: sql`excluded.latest_action_text`,
              policyArea: sql`excluded.policy_area`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
        billsIngested++;

        // Upsert sponsor relationships
        for (const s of relevantSponsors) {
          await db
            .insert(billSponsorships)
            .values({
              billId,
              bioguideId: s.bioguideId,
              role: "sponsor",
              cosponsoredDate: null,
            })
            .onConflictDoNothing();
          sponsorshipsIngested++;
        }

        // Fetch and upsert cosponsors (only if count > 0)
        if (billData.cosponsors && billData.cosponsors.count > 0) {
          try {
            const cosponsors = await fetchCosponsors(
              CONGRESS,
              b.type,
              b.number
            );
            await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));

            for (const cs of cosponsors) {
              if (!memberIds.has(cs.bioguideId)) continue;
              await db
                .insert(billSponsorships)
                .values({
                  billId,
                  bioguideId: cs.bioguideId,
                  role: "cosponsor",
                  cosponsoredDate: cs.sponsorshipDate || null,
                })
                .onConflictDoNothing();
              sponsorshipsIngested++;
            }
          } catch {
            // Non-fatal — skip cosponsors for this bill
          }
        }

        if (billsIngested % 25 === 0) {
          console.log(
            `  ${billsIngested} bills ingested (scanned ${totalProcessed}/${total})...`
          );
        }
      }

      offset += BATCH_SIZE;
      hasMore = billList.length === BATCH_SIZE;

      // Safety valve: for first run, cap at a reasonable number
      if (totalProcessed >= 3000) {
        console.log(`  Reached scan limit of ${totalProcessed}. Stopping.`);
        break;
      }
    }

    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsCount: billsIngested,
      })
      .where(sql`id = ${syncEntry.id}`);

    console.log(
      `Done. ${billsIngested} bills, ${sponsorshipsIngested} sponsorships (scanned ${totalProcessed}).`
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
  console.error("Failed to ingest bills:", err);
  process.exit(1);
});
