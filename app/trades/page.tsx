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

interface TradeRow {
  id: number;
  txDate: string | null;
  txType: string;
  amountMin: number | null;
  amountMax: number | null;
}

async function loadRows(): Promise<{
  rows: MemberRow[];
  trades: Map<string, TradeRow[]>;
  domain: [string, string] | null;
  totals: { members: number; trades: number; filings: number };
  monthlyAll: { month: string; count: number }[];
  latestByMember: Map<string, string>;
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

  const trades = new Map<string, TradeRow[]>();
  const latestByMember = new Map<string, string>();
  const monthBuckets = new Map<string, number>();
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
      const prev = latestByMember.get(r.bioguideId);
      if (!prev || r.txDate > prev) latestByMember.set(r.bioguideId, r.txDate);
      const month = r.txDate.slice(0, 7);
      monthBuckets.set(month, (monthBuckets.get(month) ?? 0) + 1);
    }
  }

  const monthlyAll = [...monthBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

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
    monthlyAll,
    latestByMember,
  };
}

const PARTY_DOT: Record<string, string> = {
  Democrat: "bg-blue-600",
  Republican: "bg-red-600",
  Independent: "bg-purple-500",
};

const PARTY_TINT: Record<string, string> = {
  Democrat: "bg-blue-50/60 dark:bg-blue-950/30",
  Republican: "bg-red-50/60 dark:bg-red-950/30",
  Independent: "bg-purple-50/60 dark:bg-purple-950/30",
};

const PARTY_RAIL: Record<string, string> = {
  Democrat: "border-l-blue-500",
  Republican: "border-l-red-500",
  Independent: "border-l-purple-500",
};

export default async function TradesLandingPage() {
  const {
    rows,
    trades,
    domain,
    totals,
    monthlyAll,
    latestByMember,
  } = await loadRows();

  const topTrader = rows[0];

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
          the House Clerk and Senate eFD portals. Each mark is one disclosed
          trade, colored by the member&rsquo;s party.
          {topTrader && (
            <>
              {" "}
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {topTrader.fullName}
              </span>{" "}
              leads the list with{" "}
              <span className="font-mono">{topTrader.txCount}</span>{" "}
              transactions.
            </>
          )}
        </p>
      </header>

      <section className="mb-8 grid grid-cols-3 gap-3 border-y border-neutral-200 py-5 dark:border-neutral-800">
        <HeroStat label="Members trading" value={totals.members} />
        <HeroStat label="Disclosed trades" value={totals.trades} />
        <HeroStat label="PTR filings" value={totals.filings} />
      </section>

      {monthlyAll.length > 0 && domain && (
        <section className="mb-6">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="font-mono text-[10px] uppercase tracking-wide text-neutral-500">
              All disclosed trades, by month
            </h2>
            <Link
              href="/trades/methodology"
              className="font-mono text-[10px] uppercase tracking-wide text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              How this is built →
            </Link>
          </div>
          <AggregateHistogram data={monthlyAll} domain={domain} />
        </section>
      )}

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-300 p-8 text-sm text-neutral-500 dark:border-neutral-700">
          No disclosure data ingested yet. Run{" "}
          <code className="font-mono">scripts/ingest/disclosures-house.ts</code>{" "}
          to populate.
        </div>
      ) : (
        <section>
          <div className="mb-1 grid grid-cols-[2fr_0.6fr_0.9fr_2.5fr] items-end gap-x-4 border-b border-neutral-200 pb-1 font-mono text-[10px] uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
            <span>Member</span>
            <span>Trades</span>
            <span>Latest</span>
            <span>Swim lane</span>
          </div>
          {domain && <SwimLaneAxis domain={domain} />}
          <ul>
            {rows.map((r, i) => {
              const memberTrades = trades.get(r.bioguideId) ?? [];
              const latest = latestByMember.get(r.bioguideId);
              const isTop = i === 0;
              const tint = isTop ? PARTY_TINT[r.party] || "" : "";
              const rail = isTop
                ? `border-l-2 ${PARTY_RAIL[r.party] || "border-l-neutral-400"}`
                : "border-l-2 border-l-transparent";
              return (
                <li
                  key={r.bioguideId}
                  className={`grid grid-cols-[2fr_0.6fr_0.9fr_2.5fr] items-center gap-x-4 border-b border-neutral-100 py-2 pl-2 dark:border-neutral-900 ${tint} ${rail}`}
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
                  <span className="font-mono text-xs text-neutral-700 dark:text-neutral-300">
                    {r.txCount}
                  </span>
                  <span className="font-mono text-[11px] text-neutral-500">
                    {latest ?? "—"}
                  </span>
                  <TradeSparkline
                    trades={memberTrades}
                    domain={domain ?? undefined}
                    party={r.party}
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-4 font-mono text-[10px] text-neutral-500">
            Marks colored by party · size = log of disclosed amount range ·
            hollow = purchase, filled = sale
          </p>
        </section>
      )}
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-serif text-3xl font-semibold tracking-tight">
        {value.toLocaleString()}
      </div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </div>
    </div>
  );
}

function SwimLaneAxis({ domain }: { domain: [string, string] }) {
  const minT = new Date(domain[0]).getTime();
  const maxT = new Date(domain[1]).getTime();
  const range = Math.max(maxT - minT, 86_400_000);
  const startYear = new Date(domain[0]).getUTCFullYear();
  const endYear = new Date(domain[1]).getUTCFullYear();
  const ticks: { pct: number; year: number }[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const t = new Date(`${y}-01-01`).getTime();
    if (t < minT || t > maxT) continue;
    ticks.push({ pct: ((t - minT) / range) * 100, year: y });
  }
  return (
    <div className="grid grid-cols-[2fr_0.6fr_0.9fr_2.5fr] items-end gap-x-4 pb-1">
      <span />
      <span />
      <span />
      <div className="relative h-4">
        {ticks.map((t) => (
          <span
            key={t.year}
            className="absolute -translate-x-1/2 font-mono text-[10px] text-neutral-400"
            style={{ left: `${t.pct}%` }}
          >
            {t.year}
          </span>
        ))}
      </div>
    </div>
  );
}

function AggregateHistogram({
  data,
  domain,
}: {
  data: { month: string; count: number }[];
  domain: [string, string];
}) {
  const width = 1000;
  const height = 64;
  const padX = 4;
  const padY = 8;
  const minT = new Date(domain[0]).getTime();
  const maxT = new Date(domain[1]).getTime();
  const range = Math.max(maxT - minT, 86_400_000);
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const barW = Math.max(
    2,
    (width - padX * 2) / Math.max(1, monthsBetween(domain[0], domain[1]))
  );
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Trades per month across all members"
    >
      <line
        x1={padX}
        x2={width - padX}
        y1={height - padY}
        y2={height - padY}
        stroke="#e5e5e5"
      />
      {data.map((d) => {
        const t = new Date(`${d.month}-01`).getTime();
        const x = padX + ((t - minT) / range) * (width - padX * 2);
        const h = ((height - padY * 2) * d.count) / maxCount;
        return (
          <rect
            key={d.month}
            x={x - barW / 2}
            y={height - padY - h}
            width={barW}
            height={h}
            fill="#737373"
            fillOpacity={0.8}
          />
        );
      })}
    </svg>
  );
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}
