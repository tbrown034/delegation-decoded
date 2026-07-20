import "../lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { electionCandidates, syncLog } from "../../lib/schema";
import { sql } from "drizzle-orm";
import { fetchCandidates, fetchCandidateTotals } from "../lib/fec-api";

// 2026 election candidates from FEC statements of candidacy (Form 2).
// Statutory candidates only (candidate_status=C, has_raised_funds=true) —
// the filter that drops paper filers and prior-cycle records rolled forward.
// FEC filing is not ballot access: state filing deadlines and primaries
// decide who actually appears on ballots. Surfaces must say so.

const ELECTION_YEAR = 2026;

// CANDIDATE_OFFICES=S limits the sweep (useful under DEMO_KEY rate limits;
// the read path guards per-office, so a partial load never misreports the
// other chamber as having no filers).
const OFFICES = (process.env.CANDIDATE_OFFICES ?? "H,S")
  .split(",")
  .map((o) => o.trim().toUpperCase())
  .filter((o): o is "H" | "S" => o === "H" || o === "S");

function parseDistrict(office: string, district: string | null): number | null {
  if (office === "S") return null;
  if (district == null) return null;
  const n = parseInt(district, 10);
  return Number.isFinite(n) ? n : null;
}

// FEC names arrive as "ANDREWS, ANNIE" / "SMITH, JOHN A JR". Flip around the
// first comma and title-case for display, preserving Mc/Mac/O' prefixes,
// hyphenated names, and suffixes. The FEC candidate_id always links back to
// the raw source record.
const KEEP_UPPER = new Set(["II", "III", "IV", "JR", "SR", "MD", "DDS"]);

function titleWord(w: string): string {
  if (KEEP_UPPER.has(w.toUpperCase())) {
    const u = w.toUpperCase();
    return u === "JR" ? "Jr." : u === "SR" ? "Sr." : u;
  }
  return w
    .toLowerCase()
    .split(/([-'])/)
    .map((part) =>
      part === "-" || part === "'"
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join("")
    .replace(/^Mc(\w)/, (_, c: string) => `Mc${c.toUpperCase()}`);
}

function normalizeCandidateName(raw: string): string {
  const commaAt = raw.indexOf(",");
  const flipped =
    commaAt === -1
      ? raw
      : `${raw.slice(commaAt + 1).trim()} ${raw.slice(0, commaAt).trim()}`;
  return flipped.split(/\s+/).map(titleWord).join(" ");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (!process.env.FEC_API_KEY) throw new Error("FEC_API_KEY is required");

  const client = neon(process.env.DATABASE_URL);
  const db = drizzle(client);

  const [syncEntry] = await db
    .insert(syncLog)
    .values({
      source: "fec",
      entityType: "candidates",
      status: "running",
    })
    .returning();

  try {
    let count = 0;
    for (const office of OFFICES) {
      console.log(`Fetching ${ELECTION_YEAR} ${office} candidates...`);
      const [candidates, totals] = await Promise.all([
        fetchCandidates(ELECTION_YEAR, office),
        fetchCandidateTotals(ELECTION_YEAR, office),
      ]);
      console.log(
        `  ${candidates.length} statutory candidates, ${totals.size} with totals`
      );

      for (const c of candidates) {
        if (!c.candidate_id || !c.state) continue;
        await db
          .insert(electionCandidates)
          .values({
            candidateId: c.candidate_id,
            name: normalizeCandidateName(c.name),
            party: c.party_full || c.party || null,
            office,
            stateCode: c.state,
            district: parseDistrict(office, c.district),
            electionYear: ELECTION_YEAR,
            incumbentChallenge: c.incumbent_challenge || null,
            candidateStatus: c.candidate_status || null,
            hasRaisedFunds: c.has_raised_funds ?? null,
            totalReceipts: totals.get(c.candidate_id) ?? null,
            firstFileDate: c.first_file_date || null,
            lastFileDate: c.last_file_date || null,
            fecLoadDate: c.load_date ? c.load_date.slice(0, 10) : null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: electionCandidates.candidateId,
            set: {
              name: sql`excluded.name`,
              party: sql`excluded.party`,
              office: sql`excluded.office`,
              stateCode: sql`excluded.state_code`,
              district: sql`excluded.district`,
              electionYear: sql`excluded.election_year`,
              incumbentChallenge: sql`excluded.incumbent_challenge`,
              candidateStatus: sql`excluded.candidate_status`,
              hasRaisedFunds: sql`excluded.has_raised_funds`,
              totalReceipts: sql`excluded.total_receipts`,
              firstFileDate: sql`excluded.first_file_date`,
              lastFileDate: sql`excluded.last_file_date`,
              fecLoadDate: sql`excluded.fec_load_date`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
        count++;
        if (count % 100 === 0) console.log(`  Upserted ${count}...`);
      }
    }

    await db
      .update(syncLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsCount: count,
      })
      .where(sql`id = ${syncEntry.id}`);

    console.log(`Done. Ingested ${count} candidates for ${ELECTION_YEAR}.`);
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
  console.error("Failed to ingest candidates:", err);
  process.exit(1);
});
