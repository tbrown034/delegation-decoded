import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, csvRow } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function GET() {
  const result = await db.execute(sql`
    SELECT candidate_id AS fec_candidate_id, name, party, office, state_code,
      district, election_year, incumbent_challenge, candidate_status,
      has_raised_funds, total_receipts, first_file_date, last_file_date,
      fec_load_date
    FROM election_candidates
    WHERE election_year = 2026
    ORDER BY state_code, office, district NULLS FIRST, name
  `);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(csvRow(HEADER)));
      for (const row of result.rows as Record<string, unknown>[]) {
        controller.enqueue(encoder.encode(csvRow(HEADER.map((key) => row[key]))));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: csvHeaders("dd-2026-fec-filers.csv") });
}
