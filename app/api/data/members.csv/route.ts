import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, keysetCsvStream } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 10_000;

const HEADER = [
  "bioguide_id",
  "full_name",
  "first_name",
  "last_name",
  "party",
  "state_code",
  "chamber",
  "district",
  "in_office",
  "website_url",
  "phone",
  "fec_candidate_id",
  "updated_at",
];

export async function GET(request: Request) {
  // Keyset cursor over the export's own sort order. `district NULLS
  // FIRST` means NULL (senators) sorts below every district, so -1
  // stands in for it — no real district is negative. bioguide_id breaks
  // ties. Empty strings / -1 are the before-the-first-row sentinel.
  let lastState = "";
  let lastChamber = "";
  let lastDistrict = -1;
  let lastLastName = "";
  let lastBioguideId = "";
  const stream = keysetCsvStream({
    header: HEADER,
    batchSize: BATCH_SIZE,
    signal: request.signal,
    nextBatch: async () => {
      const result = await db.execute(sql`
        SELECT bioguide_id, full_name, first_name, last_name, party, state_code,
          chamber, district, in_office, website_url, phone, fec_candidate_id,
          updated_at, COALESCE(district, -1) AS sort_district
        FROM members
        WHERE in_office = true
          AND (
            state_code > ${lastState}
            OR (state_code = ${lastState} AND chamber < ${lastChamber})
            OR (state_code = ${lastState} AND chamber = ${lastChamber}
                AND COALESCE(district, -1) > ${lastDistrict})
            OR (state_code = ${lastState} AND chamber = ${lastChamber}
                AND COALESCE(district, -1) = ${lastDistrict} AND last_name > ${lastLastName})
            OR (state_code = ${lastState} AND chamber = ${lastChamber}
                AND COALESCE(district, -1) = ${lastDistrict} AND last_name = ${lastLastName}
                AND bioguide_id > ${lastBioguideId})
          )
        ORDER BY state_code, chamber DESC, COALESCE(district, -1), last_name, bioguide_id
        LIMIT ${BATCH_SIZE}
      `);
      const rows = result.rows as Record<string, unknown>[];
      if (rows.length === BATCH_SIZE) {
        const last = rows[rows.length - 1];
        lastState = String(last.state_code);
        lastChamber = String(last.chamber);
        lastDistrict = Number(last.sort_district);
        lastLastName = String(last.last_name);
        lastBioguideId = String(last.bioguide_id);
      }
      return rows.map((row) => HEADER.map((key) => row[key]));
    },
  });
  return new Response(stream, { headers: csvHeaders("dd-current-members.csv") });
}
