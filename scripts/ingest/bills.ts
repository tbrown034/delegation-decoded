import "../lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  bills,
  billSponsorships,
  syncLog,
  members,
  ingestCursors,
} from "../../lib/schema";
import { sql, eq, and, desc } from "drizzle-orm";
import {
  fetchBillsPage,
  fetchBillDetail,
  fetchCosponsors,
} from "../lib/congress-api";

// Defaults to the current 119th Congress in incremental mode. Pass
// --congress=118 (or BACKFILL_CONGRESS=118) for a resumable full scan of a
// closed congress: it walks the list in stable updateDate-ascending order,
// persists the page offset in ingest_cursors after each page, and stops at
// the detail-fetch cap so one run stays inside a GitHub Actions window.
function resolveTarget() {
  const arg = process.argv.find((a) => a.startsWith("--congress="));
  const raw = arg ? arg.split("=")[1] : process.env.BACKFILL_CONGRESS;
  const congress = raw ? parseInt(raw, 10) : 119;
  if (!Number.isInteger(congress) || congress < 110 || congress > 130) {
    throw new Error(`Invalid congress: ${raw}`);
  }
  return { congress, backfill: congress !== 119 };
}

const BATCH_SIZE = 250;
const DETAIL_DELAY_MS = 200;
// Max new bills to ingest per run. Keeps GitHub Actions under 45 min.
// Existing bills that just need updates are fast (skip detail fetch).
const MAX_NEW_BILLS = 2000;
// Backfill cap: detail requests per run (each new bill costs 1-2 requests).
const MAX_DETAIL_FETCHES = 3000;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.CONGRESS_API_KEY)
    throw new Error("CONGRESS_API_KEY is required");

  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  const { congress: CONGRESS, backfill } = resolveTarget();
  const entityType = backfill ? `bills_backfill_${CONGRESS}` : "bills";
  console.log(`Target: ${CONGRESS}th Congress${backfill ? " (backfill)" : ""}`);

  const [syncEntry] = await db
    .insert(syncLog)
    .values({ source: "congress_gov", entityType, status: "running" })
    .returning();

  try {
    // Get all current member bioguide IDs
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

    // Incremental mode (daily runs only): fetch bills updated since the last
    // successful sync, minus a 1-day buffer. Backfills always run a full scan
    // in stable ascending order and resume from a persisted page offset.
    let fromDateTime: string | undefined;
    if (!backfill) {
      const [lastSync] = await db
        .select({ completedAt: syncLog.completedAt })
        .from(syncLog)
        .where(
          sql`${syncLog.source} = 'congress_gov' AND ${syncLog.entityType} = 'bills' AND ${syncLog.status} = 'success' AND ${syncLog.recordsCount} > 0`
        )
        .orderBy(desc(syncLog.completedAt))
        .limit(1);
      if (lastSync?.completedAt) {
        const since = new Date(lastSync.completedAt);
        since.setDate(since.getDate() - 1);
        fromDateTime = since.toISOString().replace(/\.\d{3}Z/, "Z");
        console.log(`Incremental mode: fetching bills updated since ${fromDateTime}`);
      } else {
        console.log("Full scan mode: no previous successful sync found");
      }
    }

    const cursorKey = `bills-${CONGRESS}-offset`;
    let startOffset = 0;
    if (backfill) {
      const [row] = await db
        .select({ cursor: ingestCursors.cursor })
        .from(ingestCursors)
        .where(
          and(
            eq(ingestCursors.source, "congress_gov"),
            eq(ingestCursors.key, cursorKey)
          )
        )
        .limit(1);
      startOffset = row ? parseInt(row.cursor, 10) || 0 : 0;
      if (startOffset > 0) console.log(`Resuming backfill at offset ${startOffset}`);
    }

    console.log(
      `${memberIds.size} members tracked, ${existingBillIds.size} bills already in DB`
    );

    let offset = startOffset;
    let detailFetches = 0;
    let totalProcessed = 0;
    let billsIngested = 0;
    let billsUpdated = 0;
    let sponsorshipsIngested = 0;
    let hasMore = true;

    while (hasMore) {
      const { bills: billList, total } = await fetchBillsPage(
        CONGRESS,
        offset,
        BATCH_SIZE,
        fromDateTime,
        backfill ? "updateDate+asc" : "updateDate+desc"
      );

      if (billList.length === 0) {
        if (backfill) console.log("  Backfill complete — no more bills to scan.");
        break;
      }
      if (offset === startOffset)
        console.log(
          `  ${total} bills ${fromDateTime ? "updated since last sync" : "total in " + CONGRESS + "th Congress"}`
        );

      for (const b of billList) {
        totalProcessed++;

        const candidateId = `${b.type.toLowerCase()}-${b.number}-${CONGRESS}`;
        const isExisting = existingBillIds.has(candidateId);

        // For existing bills, update latest action without re-fetching detail
        if (isExisting && b.latestAction) {
          await db
            .update(bills)
            .set({
              latestActionDate: b.latestAction.actionDate || null,
              latestActionText: b.latestAction.text || null,
              updatedAt: new Date(),
            })
            .where(sql`${bills.billId} = ${candidateId}`);
          billsUpdated++;
          continue;
        }

        // For new bills, fetch full detail
        if (isExisting) continue; // already have it, no update needed

        let detail;
        try {
          detail = await fetchBillDetail(CONGRESS, b.type, b.number);
          detailFetches++;
          await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
        } catch (err) {
          console.log(`  Skipping ${b.type}${b.number}: ${err}`);
          continue;
        }

        const billData = detail.bill;
        const sponsors = billData.sponsors || [];

        const relevantSponsors = sponsors.filter((s) =>
          memberIds.has(s.bioguideId)
        );
        if (relevantSponsors.length === 0) continue;

        const billId = candidateId;

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
        existingBillIds.add(billId);

        // Upsert sponsors
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

        // Fetch cosponsors
        if (billData.cosponsors && billData.cosponsors.count > 0) {
          try {
            const cosponsors = await fetchCosponsors(
              CONGRESS,
              b.type,
              b.number
            );
            detailFetches++;
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
            // Non-fatal
          }
        }

        if (billsIngested % 25 === 0 && billsIngested > 0) {
          console.log(
            `  ${billsIngested} new bills (${billsUpdated} updated, scanned ${totalProcessed})`
          );
        }

        if (billsIngested >= MAX_NEW_BILLS) {
          console.log(`  Reached new bill limit of ${MAX_NEW_BILLS}. Stopping.`);
          hasMore = false;
          break;
        }

        if (backfill && detailFetches >= MAX_DETAIL_FETCHES) {
          console.log(
            `  Reached detail-fetch cap of ${MAX_DETAIL_FETCHES}. Re-run to resume from the cursor.`
          );
          hasMore = false;
          break;
        }
      }

      // Only advance (and persist) the offset after a fully processed page —
      // a mid-page stop resumes on the same page next run.
      if (hasMore) {
        offset += BATCH_SIZE;
        if (backfill) {
          await db
            .insert(ingestCursors)
            .values({
              source: "congress_gov",
              key: cursorKey,
              cursor: String(offset),
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [ingestCursors.source, ingestCursors.key],
              set: {
                cursor: sql`excluded.cursor`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
        }
        hasMore = billList.length === BATCH_SIZE;
      }
    }

    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsCount: billsIngested + billsUpdated,
      })
      .where(sql`id = ${syncEntry.id}`);

    console.log(
      `Done. ${billsIngested} new bills, ${billsUpdated} updated, ${sponsorshipsIngested} sponsorships (scanned ${totalProcessed}).`
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
