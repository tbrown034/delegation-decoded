import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, keysetCsvStream } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 10_000;

const HEADER = [
  "fec_candidate_id",
  "name",
  "party",
  "office",
  "state_code",
  "district",
  "election_year",
  "incumbent_challenge",
  "candidate_status",
  "has_raised_funds",
  "total_receipts",
  "first_file_date",
  "last_file_date",
  "fec_load_date",
];

export async function GET(request: Request) {
  // Keyset cursor over the export's own sort order. `district NULLS
  // FIRST` means NULL (Senate) sorts below every district, so -1 stands
  // in for it — at-large is 0 and no real district is negative.
  // candidate_id breaks ties on same-named filers in one race.
  let lastState = "";
  let lastOffice = "";
  let lastDistrict = -1;
  let lastName = "";
  let lastCandidateId = "";
  const stream = keysetCsvStream({
    header: HEADER,
    batchSize: BATCH_SIZE,
    signal: request.signal,
    nextBatch: async () => {
      const result = await db.execute(sql`
        SELECT candidate_id AS fec_candidate_id, name, party, office, state_code,
          district, election_year, incumbent_challenge, candidate_status,
          has_raised_funds, total_receipts, first_file_date, last_file_date,
          fec_load_date, COALESCE(district, -1) AS sort_district
        FROM election_candidates
        WHERE election_year = 2026
          AND (
            state_code > ${lastState}
            OR (state_code = ${lastState} AND office > ${lastOffice})
            OR (state_code = ${lastState} AND office = ${lastOffice}
                AND COALESCE(district, -1) > ${lastDistrict})
            OR (state_code = ${lastState} AND office = ${lastOffice}
                AND COALESCE(district, -1) = ${lastDistrict} AND name > ${lastName})
            OR (state_code = ${lastState} AND office = ${lastOffice}
                AND COALESCE(district, -1) = ${lastDistrict} AND name = ${lastName}
                AND candidate_id > ${lastCandidateId})
          )
        ORDER BY state_code, office, COALESCE(district, -1), name, candidate_id
        LIMIT ${BATCH_SIZE}
      `);
      const rows = result.rows as Record<string, unknown>[];
      if (rows.length === BATCH_SIZE) {
        const last = rows[rows.length - 1];
        lastState = String(last.state_code);
        lastOffice = String(last.office);
        lastDistrict = Number(last.sort_district);
        lastName = String(last.name);
        lastCandidateId = String(last.fec_candidate_id);
      }
      return rows.map((row) => HEADER.map((key) => row[key]));
    },
  });
  return new Response(stream, { headers: csvHeaders("dd-2026-fec-filers.csv") });
}
