import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, csvRow } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADER = [
  "bioguide_id",
  "first_name",
  "last_name",
  "state_code",
  "district",
  "party",
  "chamber",
  "fec_candidate_id",
  "election_cycle",
  "total_receipts",
  "total_disbursements",
  "cash_on_hand",
  "total_individual",
  "total_pac",
  "small_individual",
  "last_filing_date",
];

export async function GET() {
  const result = await db.execute(sql`
    SELECT
      m.bioguide_id    AS bioguide_id,
      m.first_name     AS first_name,
      m.last_name      AS last_name,
      m.state_code     AS state_code,
      m.district       AS district,
      m.party          AS party,
      m.chamber        AS chamber,
      cf.fec_candidate_id    AS fec_candidate_id,
      cf.election_cycle      AS election_cycle,
      cf.total_receipts      AS total_receipts,
      cf.total_disbursements AS total_disbursements,
      cf.cash_on_hand        AS cash_on_hand,
      cf.total_individual    AS total_individual,
      cf.total_pac           AS total_pac,
      cf.small_individual    AS small_individual,
      to_char(cf.last_filing_date, 'YYYY-MM-DD') AS last_filing_date
    FROM campaign_finance cf
    JOIN members m ON m.bioguide_id = cf.bioguide_id
    ORDER BY cf.election_cycle DESC, m.last_name ASC, m.first_name ASC
  `);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(csvRow(HEADER)));
      for (const r of result.rows as Record<string, unknown>[]) {
        controller.enqueue(
          enc.encode(
            csvRow([
              r.bioguide_id,
              r.first_name,
              r.last_name,
              r.state_code,
              r.district,
              r.party,
              r.chamber,
              r.fec_candidate_id,
              r.election_cycle,
              r.total_receipts,
              r.total_disbursements,
              r.cash_on_hand,
              r.total_individual,
              r.total_pac,
              r.small_individual,
              r.last_filing_date,
            ])
          )
        );
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: csvHeaders("dd-finance.csv") });
}
