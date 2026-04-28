import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, csvRow } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADER = [
  "filing_id",
  "doc_id",
  "chamber",
  "bioguide_id",
  "first_name",
  "last_name",
  "state_code",
  "district",
  "party",
  "filing_type",
  "filed_date",
  "parse_status",
  "parse_confidence",
  "page_count",
  "tx_count",
  "pdf_url",
];

export async function GET() {
  const result = await db.execute(sql`
    SELECT
      df.id            AS filing_id,
      df.doc_id        AS doc_id,
      df.chamber       AS chamber,
      m.bioguide_id    AS bioguide_id,
      m.first_name     AS first_name,
      m.last_name      AS last_name,
      m.state_code     AS state_code,
      m.district       AS district,
      m.party          AS party,
      df.filing_type   AS filing_type,
      to_char(df.filed_date, 'YYYY-MM-DD') AS filed_date,
      df.parse_status  AS parse_status,
      df.parse_confidence AS parse_confidence,
      df.page_count    AS page_count,
      (SELECT COUNT(*) FROM stock_transactions st WHERE st.filing_id = df.id)::int AS tx_count,
      df.pdf_url       AS pdf_url
    FROM disclosure_filings df
    JOIN members m ON m.bioguide_id = df.bioguide_id
    ORDER BY df.filed_date DESC NULLS LAST, df.id DESC
  `);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(csvRow(HEADER)));
      for (const r of result.rows as Record<string, unknown>[]) {
        controller.enqueue(
          enc.encode(
            csvRow([
              r.filing_id,
              r.doc_id,
              r.chamber,
              r.bioguide_id,
              r.first_name,
              r.last_name,
              r.state_code,
              r.district,
              r.party,
              r.filing_type,
              r.filed_date,
              r.parse_status,
              r.parse_confidence,
              r.page_count,
              r.tx_count,
              r.pdf_url,
            ])
          )
        );
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: csvHeaders("dd-filings.csv") });
}
