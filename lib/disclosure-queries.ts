import { db } from "./db";
import { disclosureFilings, stockTransactions, members } from "./schema";
import { desc, eq, sql } from "drizzle-orm";

export interface MemberTransaction {
  id: number;
  filingId: number;
  rowIndex: number;
  ownerCode: string | null;
  assetDescription: string;
  ticker: string | null;
  txType: string;
  txDate: string | null;
  amountRange: string;
  amountMin: number | null;
  amountMax: number | null;
  filedLate: boolean | null;
  needsReview: boolean | null;
  pdfUrl: string;
  filedDate: string | null;
  chamber: string;
}

export async function getMemberTransactions(
  bioguideId: string
): Promise<MemberTransaction[]> {
  return db
    .select({
      id: stockTransactions.id,
      filingId: stockTransactions.filingId,
      rowIndex: stockTransactions.rowIndex,
      ownerCode: stockTransactions.ownerCode,
      assetDescription: stockTransactions.assetDescription,
      ticker: stockTransactions.ticker,
      txType: stockTransactions.txType,
      txDate: stockTransactions.txDate,
      amountRange: stockTransactions.amountRange,
      amountMin: stockTransactions.amountMin,
      amountMax: stockTransactions.amountMax,
      filedLate: stockTransactions.filedLate,
      needsReview: stockTransactions.needsReview,
      pdfUrl: disclosureFilings.pdfUrl,
      filedDate: disclosureFilings.filedDate,
      chamber: disclosureFilings.chamber,
    })
    .from(stockTransactions)
    .innerJoin(
      disclosureFilings,
      eq(stockTransactions.filingId, disclosureFilings.id)
    )
    .where(eq(stockTransactions.bioguideId, bioguideId))
    .orderBy(desc(stockTransactions.txDate));
}

export interface MemberDisclosureSummary {
  totalTransactions: number;
  totalFilings: number;
  buyCount: number;
  sellCount: number;
  lateCount: number;
  estimatedMin: number;
  estimatedMax: number;
  earliestTrade: string | null;
  latestTrade: string | null;
}

export async function getMemberDisclosureSummary(
  bioguideId: string
): Promise<MemberDisclosureSummary> {
  const [[row], [filingRow]] = await Promise.all([
    db
      .select({
        totalTransactions: sql<number>`COUNT(*)::int`,
        buyCount: sql<number>`COUNT(*) FILTER (WHERE ${stockTransactions.txType} = 'P')::int`,
        sellCount: sql<number>`COUNT(*) FILTER (WHERE ${stockTransactions.txType} LIKE 'S%')::int`,
        lateCount: sql<number>`COUNT(*) FILTER (WHERE ${stockTransactions.filedLate} = true)::int`,
        estimatedMin: sql<number>`COALESCE(SUM(${stockTransactions.amountMin}), 0)::bigint`,
        estimatedMax: sql<number>`COALESCE(SUM(COALESCE(${stockTransactions.amountMax}, ${stockTransactions.amountMin})), 0)::bigint`,
        earliestTrade: sql<string | null>`MIN(${stockTransactions.txDate})`,
        latestTrade: sql<string | null>`MAX(${stockTransactions.txDate})`,
      })
      .from(stockTransactions)
      .where(eq(stockTransactions.bioguideId, bioguideId)),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(disclosureFilings)
      .where(eq(disclosureFilings.bioguideId, bioguideId)),
  ]);

  return {
    totalTransactions: row?.totalTransactions ?? 0,
    totalFilings: filingRow?.count ?? 0,
    buyCount: row?.buyCount ?? 0,
    sellCount: row?.sellCount ?? 0,
    lateCount: row?.lateCount ?? 0,
    estimatedMin: Number(row?.estimatedMin ?? 0),
    estimatedMax: Number(row?.estimatedMax ?? 0),
    earliestTrade: row?.earliestTrade ?? null,
    latestTrade: row?.latestTrade ?? null,
  };
}

export interface TradesHomeSummary {
  totalTrades: number;
  totalFilings: number;
  houseMembers: number;
  senateMembers: number;
  topMembers: Array<{
    bioguideId: string;
    fullName: string;
    party: string;
    stateCode: string;
    chamber: string;
    txCount: number;
  }>;
  monthly: Array<{ month: string; dem: number; rep: number; ind: number }>;
  windowStart: string | null;
  windowEnd: string | null;
  earliestFiling: string | null;
  latestFiling: string | null;
  activeCollectionStart: string | null;
  stragglerFilingCount: number;
}

export async function getTradesHomeSummary(): Promise<TradesHomeSummary> {
  // Anchor the chart to active collection: the first month where >=5 PTRs were
  // filed. We do have a handful of pre-2026 stragglers (5 PTRs scattered across
  // 2025) but those are late-filed amendments, not continuous coverage —
  // showing them stretches the chart over a 16-month window with 11 near-empty
  // months that read as "Congress wasn't trading" when the truth is "we
  // weren't collecting yet."
  const [
    [totals],
    [filingTotals],
    topMembers,
    monthlyRows,
    activeStartResult,
    stragglerResult,
  ] = await Promise.all([
    db
      .select({
        totalTrades: sql<number>`COUNT(*)::int`,
        houseMembers: sql<number>`COUNT(DISTINCT ${stockTransactions.bioguideId}) FILTER (WHERE ${members.chamber} = 'house')::int`,
        senateMembers: sql<number>`COUNT(DISTINCT ${stockTransactions.bioguideId}) FILTER (WHERE ${members.chamber} = 'senate')::int`,
      })
      .from(stockTransactions)
      .innerJoin(members, eq(members.bioguideId, stockTransactions.bioguideId)),
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
        earliest: sql<string | null>`to_char(MIN(${disclosureFilings.filedDate}), 'YYYY-MM-DD')`,
        latest: sql<string | null>`to_char(MAX(${disclosureFilings.filedDate}), 'YYYY-MM-DD')`,
      })
      .from(disclosureFilings),
    db
      .select({
        bioguideId: members.bioguideId,
        fullName: members.fullName,
        party: members.party,
        stateCode: members.stateCode,
        chamber: members.chamber,
        txCount: sql<number>`COUNT(${stockTransactions.id})::int`,
      })
      .from(members)
      .innerJoin(stockTransactions, eq(stockTransactions.bioguideId, members.bioguideId))
      .groupBy(members.bioguideId, members.fullName, members.party, members.stateCode, members.chamber)
      .orderBy(desc(sql`COUNT(${stockTransactions.id})`))
      .limit(5),
    db.execute(sql`
      WITH active_months AS (
        SELECT DATE_TRUNC('month', filed_date)::date AS m
        FROM disclosure_filings
        WHERE filed_date IS NOT NULL
        GROUP BY 1
        HAVING COUNT(*) >= 5
      ),
      window_bounds AS (
        SELECT MIN(m) AS start_month FROM active_months
      )
      SELECT
        TO_CHAR(DATE_TRUNC('month', t.tx_date), 'YYYY-MM') AS month,
        COUNT(*) FILTER (WHERE m.party = 'Democrat')::int AS dem,
        COUNT(*) FILTER (WHERE m.party = 'Republican')::int AS rep,
        COUNT(*) FILTER (WHERE m.party NOT IN ('Democrat','Republican'))::int AS ind
      FROM stock_transactions t
      JOIN members m ON m.bioguide_id = t.bioguide_id
      CROSS JOIN window_bounds w
      WHERE t.tx_date IS NOT NULL
        AND t.tx_date >= w.start_month - INTERVAL '1 month'
        AND t.tx_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
      GROUP BY 1 ORDER BY 1
    `),
    db.execute(sql`
      WITH active_months AS (
        SELECT DATE_TRUNC('month', filed_date)::date AS m
        FROM disclosure_filings
        WHERE filed_date IS NOT NULL
        GROUP BY 1
        HAVING COUNT(*) >= 5
      )
      SELECT to_char(MIN(m), 'YYYY-MM') AS m FROM active_months
    `),
    db.execute(sql`
      WITH active_months AS (
        SELECT DATE_TRUNC('month', filed_date)::date AS m
        FROM disclosure_filings
        WHERE filed_date IS NOT NULL
        GROUP BY 1
        HAVING COUNT(*) >= 5
      ),
      cutoff AS (SELECT MIN(m) AS start_month FROM active_months)
      SELECT COUNT(*)::int AS n
      FROM disclosure_filings df, cutoff
      WHERE df.filed_date IS NOT NULL
        AND df.filed_date < cutoff.start_month
    `),
  ]);
  const activeStart = (activeStartResult.rows as { m: string | null }[])[0];

  const monthly = monthlyRows.rows.map((r) => ({
    month: String(r.month),
    dem: Number(r.dem),
    rep: Number(r.rep),
    ind: Number(r.ind),
  }));

  const stragglerRow = (stragglerResult.rows as { n: number }[])[0];

  return {
    totalTrades: totals?.totalTrades ?? 0,
    totalFilings: filingTotals?.count ?? 0,
    houseMembers: totals?.houseMembers ?? 0,
    senateMembers: totals?.senateMembers ?? 0,
    topMembers,
    monthly,
    windowStart: monthly[0]?.month ?? null,
    windowEnd: monthly[monthly.length - 1]?.month ?? null,
    earliestFiling: filingTotals?.earliest ?? null,
    latestFiling: filingTotals?.latest ?? null,
    activeCollectionStart: activeStart?.m ?? null,
    stragglerFilingCount: stragglerRow?.n ?? 0,
  };
}

