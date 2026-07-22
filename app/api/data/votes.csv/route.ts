import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, csvRow } from "@/lib/csv";

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

export async function GET() {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        controller.enqueue(encoder.encode(csvRow(HEADER)));
        let lastPositionId = 0;
        while (true) {
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
          for (const row of rows) {
            controller.enqueue(
              encoder.encode(csvRow(HEADER.map((key) => row[key])))
            );
          }
          if (rows.length < BATCH_SIZE) break;
          lastPositionId = Number(rows[rows.length - 1].position_id);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, { headers: csvHeaders("dd-roll-call-positions.csv") });
}
