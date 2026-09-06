import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, keysetCsvStream } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 10_000;

const HEADER = [
  "vote_id",
  "vote_date",
  "chamber",
  "congress",
  "session",
  "roll_number",
  "question",
  "description",
  "result",
  "bill_id",
  "yeas",
  "nays",
  "present",
  "not_voting",
  "bioguide_id",
  "member_name",
  "party",
  "state_code",
  "district",
  "position",
];

export async function GET(request: Request) {
  let lastPositionId = 0;
  const stream = keysetCsvStream({
    header: HEADER,
    batchSize: BATCH_SIZE,
    signal: request.signal,
    nextBatch: async () => {
      const result = await db.execute(sql`
        SELECT vp.id AS position_id, v.vote_id, v.vote_date, v.chamber,
          v.congress, v.session, v.roll_number, v.question, v.description,
          v.result, v.bill_id, v.yeas, v.nays, v.present, v.not_voting,
          vp.bioguide_id, m.full_name AS member_name, m.party,
          m.state_code, m.district, vp.position
        FROM vote_positions vp
        JOIN votes v ON v.vote_id = vp.vote_id
        JOIN members m ON m.bioguide_id = vp.bioguide_id
        WHERE vp.id > ${lastPositionId}
        ORDER BY vp.id
        LIMIT ${BATCH_SIZE}
      `);
      const rows = result.rows as Record<string, unknown>[];
      if (rows.length === BATCH_SIZE) {
        lastPositionId = Number(rows[rows.length - 1].position_id);
      }
      return rows.map((row) => HEADER.map((key) => row[key]));
    },
  });
  return new Response(stream, { headers: csvHeaders("dd-roll-call-positions.csv") });
}
