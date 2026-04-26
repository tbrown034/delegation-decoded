import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  members,
  stockTransactions,
  disclosureFilings,
} from "@/lib/schema";
import { eq, sql, desc } from "drizzle-orm";
import { TradeSparkline } from "@/components/trade-sparkline";

export const metadata: Metadata = {
  title: "Trades — Delegation Decoded",
  description:
    "Stock trades disclosed by members of Congress under the STOCK Act.",
};

interface MemberRow {
  bioguideId: string;
  fullName: string;
  party: string;
  stateCode: string;
  chamber: string;
  txCount: number;
}

async function loadRows(): Promise<{
  rows: MemberRow[];
  trades: Map<
    string,
    Array<{
      id: number;
      txDate: string | null;
      txType: string;
      amountMin: number | null;
      amountMax: number | null;
    }>
  >;
  domain: [string, string] | null;
  totals: { members: number; trades: number; filings: number };
}> {
  const memberRows = await db
    .select({
      bioguideId: members.bioguideId,
      fullName: members.fullName,
      party: members.party,
      stateCode: members.stateCode,
      chamber: members.chamber,
      txCount: sql<number>`COUNT(${stockTransactions.id})::int`,
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

  const tradeRows = await db
    .select({
      id: stockTransactions.id,
      bioguideId: stockTransactions.bioguideId,
      txDate: stockTransactions.txDate,
      txType: stockTransactions.txType,
      amountMin: stockTransactions.amountMin,
      amountMax: stockTransactions.amountMax,
    })
    .from(stockTransactions);

  const trades = new Map<
    string,
    Array<{
      id: number;
      txDate: string | null;
      txType: string;
      amountMin: number | null;
      amountMax: number | null;
    }>
  >();
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const r of tradeRows) {
    const arr = trades.get(r.bioguideId) ?? [];
    arr.push({
      id: r.id,
      txDate: r.txDate,
      txType: r.txType,
      amountMin: r.amountMin,
      amountMax: r.amountMax,
    });
    trades.set(r.bioguideId, arr);
    if (r.txDate) {
      if (!minDate || r.txDate < minDate) minDate = r.txDate;
      if (!maxDate || r.txDate > maxDate) maxDate = r.txDate;
    }
  }

  const [totals] = await db
    .select({
      members: sql<number>`COUNT(DISTINCT ${stockTransactions.bioguideId})::int`,
      trades: sql<number>`COUNT(${stockTransactions.id})::int`,
    })
    .from(stockTransactions);

  const [filingTotals] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(disclosureFilings);

  return {
    rows: memberRows,
    trades,
    domain: minDate && maxDate ? [minDate, maxDate] : null,
    totals: {
      members: totals?.members ?? 0,
      trades: totals?.trades ?? 0,
      filings: filingTotals?.count ?? 0,
    },
  };
}

const PARTY_DOT: Record<string, string> = {
  Democrat: "bg-blue-600",
  Republican: "bg-red-600",
  Independent: "bg-purple-500",
};

export default async function TradesLandingPage() {
  const { rows, trades, domain, totals } = await loadRows();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-8 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">
          Disclosures · Trades
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold leading-tight tracking-tight">
          Stock trades disclosed by members of Congress.
        </h1>
        <p className="mt-3 text-base text-neutral-700 dark:text-neutral-300">
          Periodic Transaction Reports filed under the STOCK Act, parsed from
          the House Clerk and Senate eFD portals. Each dot is a single
          disclosed trade.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-neutral-600 dark:text-neutral-400">
          <span>
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
              {totals.members}
            </span>{" "}
            members
          </span>
          <span>
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
              {totals.trades.toLocaleString()}
            </span>{" "}
            trades
          </span>
          <span>
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
              {totals.filings.toLocaleString()}
            </span>{" "}
            filings
          </span>
          <Link
            href="/trades/methodology"
            className="ml-auto underline hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            How this is built →
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-300 p-8 text-sm text-neutral-500 dark:border-neutral-700">
          No disclosure data ingested yet. Run{" "}
          <code className="font-mono">scripts/ingest/disclosures-house.ts</code>{" "}
          to populate.
        </div>
      ) : (
        <section>
          <div className="mb-2 grid grid-cols-[2fr_1fr_2.5fr] items-end gap-x-4 border-b border-neutral-200 pb-1 font-mono text-[10px] uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
            <span>Member</span>
            <span>Trades</span>
            <span>
              Timeline{" "}
              {domain && `(${domain[0].slice(0, 4)}–${domain[1].slice(0, 4)})`}
            </span>
          </div>
          <ul>
            {rows.map((r) => {
              const memberTrades = trades.get(r.bioguideId) ?? [];
              return (
                <li
                  key={r.bioguideId}
                  className="grid grid-cols-[2fr_1fr_2.5fr] items-center gap-x-4 border-b border-neutral-100 py-2 dark:border-neutral-900"
                >
                  <Link
                    href={`/trades/${r.bioguideId}`}
                    className="flex items-center gap-2 truncate text-sm hover:underline"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${PARTY_DOT[r.party] || "bg-neutral-400"}`}
                      aria-hidden
                    />
                    <span className="truncate font-medium">{r.fullName}</span>
                    <span className="font-mono text-[11px] text-neutral-500">
                      {r.stateCode}
                      {r.chamber === "house" ? "-H" : "-S"}
                    </span>
                  </Link>
                  <span className="font-mono text-xs text-neutral-600 dark:text-neutral-400">
                    {r.txCount}
                  </span>
                  <TradeSparkline
                    trades={memberTrades}
                    domain={domain ?? undefined}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
