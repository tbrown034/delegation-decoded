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
  const [row] = await db
    .select({
      totalTransactions: sql<number>`COUNT(*)::int`,
      buyCount: sql<number>`COUNT(*) FILTER (WHERE ${stockTransactions.txType} = 'P')::int`,
      sellCount: sql<number>`COUNT(*) FILTER (WHERE ${stockTransactions.txType} LIKE 'S%')::int`,
      lateCount: sql<number>`COUNT(*) FILTER (WHERE ${stockTransactions.filedLate} = true)::int`,
      estimatedMin: sql<number>`COALESCE(SUM(${stockTransactions.amountMin}), 0)::bigint`,
      estimatedMax: sql<number>`COALESCE(SUM(${stockTransactions.amountMax}), 0)::bigint`,
      earliestTrade: sql<string | null>`MIN(${stockTransactions.txDate})`,
      latestTrade: sql<string | null>`MAX(${stockTransactions.txDate})`,
    })
    .from(stockTransactions)
    .where(eq(stockTransactions.bioguideId, bioguideId));

  const [filingRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(disclosureFilings)
    .where(eq(disclosureFilings.bioguideId, bioguideId));

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

export async function getMembersWithDisclosures() {
  return db
    .select({
      bioguideId: members.bioguideId,
      fullName: members.fullName,
      party: members.party,
      stateCode: members.stateCode,
      chamber: members.chamber,
      transactionCount: sql<number>`COUNT(${stockTransactions.id})::int`,
    })
    .from(members)
    .innerJoin(
      stockTransactions,
      eq(stockTransactions.bioguideId, members.bioguideId)
    )
    .groupBy(
      members.bioguideId,
      members.fullName,
      members.party,
      members.stateCode,
      members.chamber
    )
    .orderBy(desc(sql`COUNT(${stockTransactions.id})`));
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
}

export async function getTradesHomeSummary(): Promise<TradesHomeSummary> {
  const [totals] = await db
    .select({
      totalTrades: sql<number>`COUNT(*)::int`,
      houseMembers: sql<number>`COUNT(DISTINCT ${stockTransactions.bioguideId}) FILTER (WHERE ${members.chamber} = 'house')::int`,
      senateMembers: sql<number>`COUNT(DISTINCT ${stockTransactions.bioguideId}) FILTER (WHERE ${members.chamber} = 'senate')::int`,
    })
    .from(stockTransactions)
    .innerJoin(members, eq(members.bioguideId, stockTransactions.bioguideId));

  const [filingTotals] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(disclosureFilings);

  const topMembers = await db
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
    .limit(5);

  const monthlyRows = await db.execute(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('month', t.tx_date), 'YYYY-MM') AS month,
      COUNT(*) FILTER (WHERE m.party = 'Democrat')::int AS dem,
      COUNT(*) FILTER (WHERE m.party = 'Republican')::int AS rep,
      COUNT(*) FILTER (WHERE m.party NOT IN ('Democrat','Republican'))::int AS ind
    FROM stock_transactions t
    JOIN members m ON m.bioguide_id = t.bioguide_id
    WHERE t.tx_date IS NOT NULL
      AND t.tx_date >= (CURRENT_DATE - INTERVAL '14 months')
      AND t.tx_date <= CURRENT_DATE
    GROUP BY 1 ORDER BY 1
  `);

  const monthly = monthlyRows.rows.map((r) => ({
    month: String(r.month),
    dem: Number(r.dem),
    rep: Number(r.rep),
    ind: Number(r.ind),
  }));

  return {
    totalTrades: totals?.totalTrades ?? 0,
    totalFilings: filingTotals?.count ?? 0,
    houseMembers: totals?.houseMembers ?? 0,
    senateMembers: totals?.senateMembers ?? 0,
    topMembers,
    monthly,
  };
}

export async function getTickerHolders(ticker: string) {
  return db
    .select({
      bioguideId: members.bioguideId,
      fullName: members.fullName,
      party: members.party,
      stateCode: members.stateCode,
      transactionCount: sql<number>`COUNT(*)::int`,
      buyCount: sql<number>`COUNT(*) FILTER (WHERE ${stockTransactions.txType} = 'P')::int`,
      sellCount: sql<number>`COUNT(*) FILTER (WHERE ${stockTransactions.txType} LIKE 'S%')::int`,
      latestTrade: sql<string | null>`MAX(${stockTransactions.txDate})`,
    })
    .from(stockTransactions)
    .innerJoin(members, eq(members.bioguideId, stockTransactions.bioguideId))
    .where(eq(stockTransactions.ticker, ticker.toUpperCase()))
    .groupBy(
      members.bioguideId,
      members.fullName,
      members.party,
      members.stateCode
    )
    .orderBy(desc(sql`COUNT(*)`));
}
