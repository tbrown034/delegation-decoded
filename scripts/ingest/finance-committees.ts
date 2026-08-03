import "../lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  financeCommittees,
  committeeFinance,
  topContributors,
  syncLog,
} from "../../lib/schema";
import { sql } from "drizzle-orm";
import {
  fecBudget,
  fetchCandidateCommittees,
  fetchCommitteeTotals,
  fetchTopContributorsByEmployer,
} from "../lib/fec-api";
import { isReportableEmployer } from "../lib/fec-mapping";

// Pacing lives in scripts/lib/fec-api.ts, which throttles from the gateway's
// own x-ratelimit headers. This script used to set its own 600ms delay from a
// guess at the quota; that guess ran ~100x over the published ceiling and is
// what drove the run into a 429/retry loop until the job timed out.
//
// This crawl is the heaviest FEC consumer: roughly five requests per member
// (committee list, totals per committee, one or two by-employer calls) across
// the full sitting roster. It is not guaranteed to finish the roster inside
// one job window, so it is built to stop cleanly and resume, rather than to
// run to completion. Members are processed stalest-first, so whatever a run
// does not reach is simply first in line next time.
const CURRENT_CYCLE = 2026;

// Wall-clock budget. Set below the workflow's job timeout so the script exits
// on its own terms — a killed run strands a 'running' sync_log row and loses
// the attempt bookkeeping for whichever member was mid-flight.
const RUN_BUDGET_MS = Number(process.env.FINANCE_RUN_BUDGET_MS ?? 45 * 60 * 1000);

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

  const startedAt = Date.now();

  try {
    // Stalest first, never-attempted before that. This ordering IS the resume
    // mechanism: an interrupted run leaves its unreached members with the
    // oldest last_attempt_at, so the next run starts exactly where this one
    // ran out of clock instead of re-walking the same first N members.
    const queued = (await db.execute(sql`
      SELECT m.bioguide_id, m.fec_candidate_id, m.full_name, s.last_attempt_at
      FROM members m
      LEFT JOIN finance_sync_state s ON s.bioguide_id = m.bioguide_id
      WHERE m.in_office = true AND m.fec_candidate_id IS NOT NULL
      ORDER BY s.last_attempt_at ASC NULLS FIRST, m.bioguide_id ASC
    `)) as unknown as {
      rows: {
        bioguide_id: string;
        fec_candidate_id: string;
        full_name: string;
        last_attempt_at: string | null;
      }[];
    };
    const membersWithFec = queued.rows.map((row) => ({
      bioguideId: row.bioguide_id,
      fecCandidateId: row.fec_candidate_id,
      fullName: row.full_name,
      lastAttemptAt: row.last_attempt_at,
    }));

    // Members with no contributor rows also get the prior cycle on first run.
    const existingContribs = await db
      .select({ bioguideId: topContributors.bioguideId })
      .from(topContributors);
    const hasContribs = new Set(existingContribs.map((r) => r.bioguideId));

    const neverAttempted = membersWithFec.filter((m) => !m.lastAttemptAt).length;
    console.log(
      `${membersWithFec.length} members with FEC IDs queued stalest-first (${neverAttempted} never attempted)`
    );
    console.log(
      `Run budget ${Math.round(RUN_BUDGET_MS / 60000)} min; will stop cleanly and resume next run.`
    );

    // Records the attempt whatever the outcome. Keying resumption off written
    // rows would starve the queue: a member whose FEC lookup legitimately
    // returns no committees writes nothing and would stay permanently "stale".
    const markAttempt = (
      bioguideId: string,
      status: "ok" | "empty" | "error",
      errorMessage?: string
    ) =>
      db.execute(sql`
        INSERT INTO finance_sync_state (bioguide_id, last_attempt_at, last_status, error_message)
        VALUES (${bioguideId}, now(), ${status}, ${errorMessage ?? null})
        ON CONFLICT (bioguide_id) DO UPDATE SET
          last_attempt_at = now(),
          last_status = EXCLUDED.last_status,
          error_message = EXCLUDED.error_message
      `);

    let committeeCount = 0;
    let cycleRowCount = 0;
    let contributorCount = 0;
    let errors = 0;
    let processed = 0;
    let stoppedEarly = false;

    for (let i = 0; i < membersWithFec.length; i++) {
      if (Date.now() - startedAt >= RUN_BUDGET_MS) {
        stoppedEarly = true;
        console.log(
          `  Run budget reached after ${processed} members; ${membersWithFec.length - i} remain for the next run.`
        );
        break;
      }
      const member = membersWithFec[i];
      const fecId = member.fecCandidateId!;

      try {
        const committees = await fetchCandidateCommittees(fecId);

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
            const top = rows
              .filter(
                (r) => r.total && r.total > 0 && isReportableEmployer(r.employer)
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
        await markAttempt(
          member.bioguideId,
          committees.length > 0 ? "ok" : "empty"
        );
        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // No retry-in-place here. The client already backs off on 429 and
        // paces from the gateway's own budget, so a 429 reaching this point
        // means the window is genuinely exhausted. Retrying the same member
        // (the old `i--`) burned the run's remaining clock on one row; marking
        // the attempt and moving on keeps the queue advancing, and the stale
        // ordering brings this member back to the front next run.
        await markAttempt(member.bioguideId, "error", msg.slice(0, 300));
        processed++;
        errors++;
        if (errors <= 10) {
          console.log(
            `  Error for ${member.fullName} (${fecId}): ${msg.slice(0, 100)}`
          );
        }
      }

      if ((i + 1) % 25 === 0 || i === membersWithFec.length - 1) {
        const budget = fecBudget();
        const elapsed = Math.round((Date.now() - startedAt) / 60000);
        console.log(
          `  ${i + 1}/${membersWithFec.length} processed — ${committeeCount} committees, ${cycleRowCount} cycle rows, ${contributorCount} contributors, ${errors} errors` +
            ` [${elapsed}m elapsed, FEC budget ${budget.remaining ?? "?"}/${budget.limit ?? "?"}]`
        );
      }
    }

    // A budget-limited stop is a success, not a failure: the queue advanced and
    // the next run resumes from the new stalest member. Only surfacing it as a
    // distinct record count would hide it, so say so in the log line too.
    const [{ stale_count: staleCount } = { stale_count: 0 }] = (
      (await db.execute(sql`
        SELECT COUNT(*)::int AS stale_count
        FROM members m
        LEFT JOIN finance_sync_state s ON s.bioguide_id = m.bioguide_id
        WHERE m.in_office = true
          AND m.fec_candidate_id IS NOT NULL
          AND (s.last_attempt_at IS NULL OR s.last_attempt_at < now() - interval '7 days')
      `)) as unknown as { rows: { stale_count: number }[] }
    ).rows;

    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsCount: committeeCount + cycleRowCount + contributorCount,
      })
      .where(sql`id = ${syncEntry.id}`);

    console.log(
      `Done${stoppedEarly ? " (budget-limited)" : ""}. ${processed} members attempted, ` +
        `${committeeCount} committees, ${cycleRowCount} cycle rows, ${contributorCount} contributor rows, ${errors} errors.`
    );
    console.log(
      `${staleCount} members still unattempted or older than 7 days.`
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
