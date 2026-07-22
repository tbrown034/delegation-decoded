import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, csvRow } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function GET() {
  const result = await db.execute(sql`
    SELECT bioguide_id, full_name, first_name, last_name, party, state_code,
      chamber, district, in_office, website_url, phone, fec_candidate_id,
      updated_at
    FROM members
    WHERE in_office = true
    ORDER BY state_code, chamber DESC, district NULLS FIRST, last_name
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
  return new Response(stream, { headers: csvHeaders("dd-current-members.csv") });
}
