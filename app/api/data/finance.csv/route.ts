import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { csvHeaders, keysetCsvStream } from "@/lib/csv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 10_000;

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

export async function GET(request: Request) {
  // Keyset cursor over the export's own sort order. cf.id breaks ties on
  // (cycle, last_name, first_name), which is not unique on its own, so
  // pagination cannot skip or repeat namesakes in the same cycle.
  // A cycle above any real one is the before-the-first-row sentinel.
  let lastCycle = 999_999;
  let lastLastName = "";
  let lastFirstName = "";
  let lastFinanceId = 0;
  const stream = keysetCsvStream({
    header: HEADER,
    batchSize: BATCH_SIZE,
    signal: request.signal,
    nextBatch: async () => {
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
          to_char(cf.last_filing_date, 'YYYY-MM-DD') AS last_filing_date,
          cf.id                  AS finance_id
        FROM campaign_finance cf
        JOIN members m ON m.bioguide_id = cf.bioguide_id
        WHERE cf.election_cycle < ${lastCycle}
           OR (cf.election_cycle = ${lastCycle} AND m.last_name > ${lastLastName})
           OR (cf.election_cycle = ${lastCycle} AND m.last_name = ${lastLastName}
               AND m.first_name > ${lastFirstName})
           OR (cf.election_cycle = ${lastCycle} AND m.last_name = ${lastLastName}
               AND m.first_name = ${lastFirstName} AND cf.id > ${lastFinanceId})
        ORDER BY cf.election_cycle DESC, m.last_name ASC, m.first_name ASC, cf.id ASC
        LIMIT ${BATCH_SIZE}
      `);
      const rows = result.rows as Record<string, unknown>[];
      if (rows.length === BATCH_SIZE) {
        const last = rows[rows.length - 1];
        lastCycle = Number(last.election_cycle);
        lastLastName = String(last.last_name);
        lastFirstName = String(last.first_name);
        lastFinanceId = Number(last.finance_id);
      }
      return rows.map((r) => [r.bioguide_id, r.first_name, r.last_name, r.state_code, r.district, r.party, r.chamber, r.fec_candidate_id, r.election_cycle, r.total_receipts, r.total_disbursements, r.cash_on_hand, r.total_individual, r.total_pac, r.small_individual, r.last_filing_date]);
    },
  });

  return new Response(stream, { headers: csvHeaders("dd-finance.csv") });
}
