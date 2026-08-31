import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, csvRow } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 10_000;

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
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        controller.enqueue(enc.encode(csvRow(HEADER)));
        // Keyset cursor over the export's own sort order (filed_date DESC
        // NULLS LAST, id DESC). NULL filed_date sorts last under DESC, so
        // coalescing it to -infinity makes the cursor comparison agree with
        // the ORDER BY. 'infinity' / int4 max is the first-page sentinel.
        let lastFiledDate = "infinity";
        let lastFilingId = 2_147_483_647;
        while (true) {
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
              COALESCE(tx.tx_count, 0) AS tx_count,
              df.pdf_url       AS pdf_url,
              COALESCE(df.filed_date, '-infinity'::date)::text AS sort_filed_date
            FROM disclosure_filings df
            JOIN members m ON m.bioguide_id = df.bioguide_id
            LEFT JOIN (
              SELECT st.filing_id, COUNT(*)::int AS tx_count
              FROM stock_transactions st
              GROUP BY st.filing_id
            ) tx ON tx.filing_id = df.id
            WHERE COALESCE(df.filed_date, '-infinity'::date) < ${lastFiledDate}::date
               OR (COALESCE(df.filed_date, '-infinity'::date) = ${lastFiledDate}::date
                   AND df.id < ${lastFilingId})
            ORDER BY COALESCE(df.filed_date, '-infinity'::date) DESC, df.id DESC
            LIMIT ${BATCH_SIZE}
          `);
          const rows = result.rows as Record<string, unknown>[];
          for (const r of rows) {
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
          if (rows.length < BATCH_SIZE) break;
          const last = rows[rows.length - 1];
          lastFiledDate = String(last.sort_filed_date);
          lastFilingId = Number(last.filing_id);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, { headers: csvHeaders("dd-filings.csv") });
}
