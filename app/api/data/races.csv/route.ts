import { csvHeaders, csvRow } from "@/lib/csv";
import { getRaceExportRows } from "@/lib/elections/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HEADER = [
  "contest_id",
  "state_code",
  "office",
  "district",
  "senate_class",
  "candidacy_id",
  "name",
  "party",
  "status",
  "is_active",
  "coverage",
  "source_name",
  "source_url",
  "fec_candidate_id",
  "total_receipts",
  "primary_votes",
  "primary_winner",
  "result_status",
];

export async function GET() {
  const rows = await getRaceExportRows();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(csvRow(HEADER)));
      for (const row of rows) {
        controller.enqueue(encoder.encode(csvRow(HEADER.map((key) => row[key]))));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: csvHeaders("dd-2026-race-candidates.csv") });
}
