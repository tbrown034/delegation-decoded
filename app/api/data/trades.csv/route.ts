import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, keysetCsvStream } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 10_000;

const HEADER = [
  "tx_id",
  "filing_id",
  "doc_id",
  "chamber",
  "bioguide_id",
  "first_name",
  "last_name",
  "state_code",
  "district",
  "party",
  "owner",
  "asset_description",
  "ticker",
  "asset_type",
  "tx_type",
  "tx_date",
  "notified_date",
  "amount_range",
  "amount_min",
  "amount_max",
  "filed_late",
  "cap_gains_over_200",
  "needs_review",
  "confidence",
  "filed_date",
  "source_pdf_url",
];

export async function GET(request: Request) {
  // Keyset cursor over the export's own sort order (tx_date DESC NULLS
  // LAST, id ASC). NULL tx_date sorts last under DESC, so coalescing it
  // to -infinity makes the cursor comparison agree with the ORDER BY.
  // 'infinity' / 0 is the before-the-first-row sentinel.
  let lastTxDate = "infinity";
  let lastTxId = 0;
  const stream = keysetCsvStream({
    header: HEADER,
    batchSize: BATCH_SIZE,
    signal: request.signal,
    nextBatch: async () => {
      const result = await db.execute(sql`
        SELECT
          st.id           AS tx_id,
          st.filing_id    AS filing_id,
          df.doc_id       AS doc_id,
          df.chamber      AS chamber,
          m.bioguide_id   AS bioguide_id,
          m.first_name    AS first_name,
          m.last_name     AS last_name,
          m.state_code    AS state_code,
          m.district      AS district,
          m.party         AS party,
          st.owner_code   AS owner,
          st.asset_description AS asset_description,
          st.ticker       AS ticker,
          st.asset_type   AS asset_type,
          st.tx_type      AS tx_type,
          to_char(st.tx_date, 'YYYY-MM-DD')        AS tx_date,
          to_char(st.notified_date, 'YYYY-MM-DD')  AS notified_date,
          st.amount_range AS amount_range,
          st.amount_min   AS amount_min,
          st.amount_max   AS amount_max,
          st.filed_late   AS filed_late,
          st.cap_gains_over_200 AS cap_gains_over_200,
          st.needs_review AS needs_review,
          st.confidence   AS confidence,
          to_char(df.filed_date, 'YYYY-MM-DD')     AS filed_date,
          df.pdf_url      AS pdf_url,
          COALESCE(st.tx_date, '-infinity'::date)::text AS sort_tx_date
        FROM stock_transactions st
        JOIN disclosure_filings df ON df.id = st.filing_id
        JOIN members m             ON m.bioguide_id = st.bioguide_id
        WHERE COALESCE(st.tx_date, '-infinity'::date) < ${lastTxDate}::date
           OR (COALESCE(st.tx_date, '-infinity'::date) = ${lastTxDate}::date
               AND st.id > ${lastTxId})
        ORDER BY COALESCE(st.tx_date, '-infinity'::date) DESC, st.id ASC
        LIMIT ${BATCH_SIZE}
      `);
      const rows = result.rows as Record<string, unknown>[];
      if (rows.length === BATCH_SIZE) {
        const last = rows[rows.length - 1];
        lastTxDate = String(last.sort_tx_date);
        lastTxId = Number(last.tx_id);
      }
      return rows.map((r) => [r.tx_id, r.filing_id, r.doc_id, r.chamber, r.bioguide_id, r.first_name, r.last_name, r.state_code, r.district, r.party, r.owner, r.asset_description, r.ticker, r.asset_type, r.tx_type, r.tx_date, r.notified_date, r.amount_range, r.amount_min, r.amount_max, r.filed_late, r.cap_gains_over_200, r.needs_review, r.confidence, r.filed_date, r.pdf_url]);
    },
  });

  return new Response(stream, { headers: csvHeaders("dd-trades.csv") });
}
