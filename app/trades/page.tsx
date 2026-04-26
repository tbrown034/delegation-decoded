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

const BUY_COLOR = "#16a34a";
const SELL_COLOR = "#dc2626";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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

interface MonthBucket {
  month: string;
  buys: number;
  sells: number;
}

async function loadRows(): Promise<{
  rows: MemberRow[];
  trades: Map<string, TradeRow[]>;
  domain: [string, string] | null;
  totals: {
    members: number;
    trades: number;
    filings: number;
    lateFilings: number;
    latestFiling: string | null;
  };
  monthlyAll: MonthBucket[];
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
  const monthBuckets = new Map<string, { buys: number; sells: number }>();
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
      const bucket = monthBuckets.get(month) ?? { buys: 0, sells: 0 };
      if (r.txType === "P") bucket.buys += 1;
      else bucket.sells += 1;
      monthBuckets.set(month, bucket);
    }
  }

  const monthlyAll = [...monthBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, bucket]) => ({
      month,
      buys: bucket.buys,
      sells: bucket.sells,
    }));

  const [totals] = await db
    .select({
      members: sql<number>`COUNT(DISTINCT ${stockTransactions.bioguideId})::int`,
      trades: sql<number>`COUNT(${stockTransactions.id})::int`,
    })
    .from(stockTransactions);

  const [filingTotals] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      latest: sql<string | null>`MAX(${disclosureFilings.filedDate})::text`,
    })
    .from(disclosureFilings);

  const [lateTotals] = await db
    .select({
      lateCount: sql<number>`COUNT(*)::int`,
    })
    .from(stockTransactions)
    .where(sql`${stockTransactions.filedLate} = true`);

  return {
    rows: memberRows,
    trades,
    domain: minDate && maxDate ? [minDate, maxDate] : null,
    totals: {
      members: totals?.members ?? 0,
      trades: totals?.trades ?? 0,
      filings: filingTotals?.count ?? 0,
      lateFilings: lateTotals?.lateCount ?? 0,
      latestFiling: filingTotals?.latest ?? null,
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

function fmtFilingDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

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
      <header className="mb-6 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">
          Disclosures · Trades
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold leading-tight tracking-tight">
          What is Congress buying and selling?
        </h1>
        <p className="mt-3 text-base text-neutral-700 dark:text-neutral-300">
          Members of Congress must disclose their stock trades, but filings
          are scattered across PDFs and hard to search. Each mark below is one
          trade — green for purchases, red for sales — sized by the disclosed
          amount range.
        </p>
        <p className="mt-2 font-mono text-xs text-neutral-500">
          Most recent filing:{" "}
          <span className="text-neutral-800 dark:text-neutral-200">
            {fmtFilingDate(totals.latestFiling)}
          </span>{" "}
          · Data refreshed weekly
        </p>
      </header>

      <section className="mb-8 flex flex-wrap items-baseline gap-x-8 gap-y-3 border-y border-neutral-200 py-5 dark:border-neutral-800">
        <HeroStat label="members trading" value={totals.members.toLocaleString()} dot={BUY_COLOR} />
        <HeroStat
          label="disclosed trades"
          value={totals.trades.toLocaleString()}
        />
        <HeroStat
          label="PTR filings"
          value={totals.filings.toLocaleString()}
        />
        {totals.lateFilings > 0 && (
          <HeroStat
            label="late filings"
            value={totals.lateFilings.toLocaleString()}
            tone="warn"
          />
        )}
      </section>

      {monthlyAll.length > 0 && domain && (
        <section className="mb-2">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="font-mono text-[10px] uppercase tracking-wide text-neutral-500">
              Disclosed trades, by month
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
            <span>Activity</span>
          </div>
          {domain && <SwimLaneAxis domain={domain} />}
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
            {rows.map((r, i) => {
              const memberTrades = trades.get(r.bioguideId) ?? [];
              const latest = latestByMember.get(r.bioguideId);
              const zebra = i % 2 === 0 ? "bg-neutral-50/50 dark:bg-neutral-900/40" : "";
              return (
                <li
                  key={r.bioguideId}
                  className={`grid grid-cols-[2fr_0.6fr_0.9fr_2.5fr] items-center gap-x-4 px-2 py-2.5 ${zebra}`}
                >
                  <Link
                    href={`/trades/${r.bioguideId}`}
                    className="flex items-center gap-2 truncate text-sm hover:underline"
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${PARTY_DOT[r.party] || "bg-neutral-400"}`}
                      aria-hidden
                    />
                    <span className="truncate font-medium">{r.fullName}</span>
                    <span className="font-mono text-[11px] text-neutral-500">
                      {r.stateCode}
                      {r.chamber === "house" ? "-H" : "-S"}
                    </span>
                  </Link>
                  <span className="font-mono text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                    {r.txCount.toLocaleString()}
                  </span>
                  <span className="font-mono text-[11px] text-neutral-500">
                    {latest ?? "—"}
                  </span>
                  <TradeSparkline
                    trades={memberTrades}
                    domain={domain ?? undefined}
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: BUY_COLOR, opacity: 0.85 }}
              />
              Purchase
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SELL_COLOR, opacity: 0.85 }}
              />
              Sale
            </span>
            <span className="text-neutral-400">
              Mark size = disclosed amount range (log)
            </span>
            {topTrader && (
              <span className="ml-auto text-neutral-400">
                Sorted by trade volume · top:{" "}
                <span className="text-neutral-700 dark:text-neutral-300">
                  {topTrader.fullName} ({topTrader.txCount.toLocaleString()})
                </span>
              </span>
            )}
          </p>
        </section>
      )}
    </div>
  );
}

function HeroStat({
  label,
  value,
  dot,
  tone,
}: {
  label: string;
  value: string;
  dot?: string;
  tone?: "warn";
}) {
  const valueClass =
    tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : "text-neutral-900 dark:text-neutral-100";
  return (
    <div className="flex items-baseline gap-2">
      <span className={`font-serif text-3xl font-semibold tracking-tight ${valueClass}`}>
        {value}
      </span>
      <span className="font-mono text-xs text-neutral-500">{label}</span>
      {dot && (
        <span
          className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: dot }}
          aria-hidden
        />
      )}
      {tone === "warn" && (
        <span
          className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
          aria-hidden
        />
      )}
    </div>
  );
}

function buildMonthTicks(
  domain: [string, string]
): { pct: number; label: string; isYearStart: boolean }[] {
  const minT = new Date(domain[0]).getTime();
  const maxT = new Date(domain[1]).getTime();
  const range = Math.max(maxT - minT, 86_400_000);
  const start = new Date(domain[0]);
  const totalMonths =
    (new Date(domain[1]).getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (new Date(domain[1]).getUTCMonth() - start.getUTCMonth());
  const stride = totalMonths > 18 ? 3 : totalMonths > 6 ? 2 : 1;

  const ticks: { pct: number; label: string; isYearStart: boolean }[] = [];
  let cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  );
  while (cursor.getTime() <= maxT) {
    const t = cursor.getTime();
    if (t >= minT) {
      const m = cursor.getUTCMonth();
      const isYearStart = m === 0;
      const label = isYearStart
        ? `Jan ${cursor.getUTCFullYear()}`
        : MONTH_LABELS[m];
      ticks.push({
        pct: ((t - minT) / range) * 100,
        label,
        isYearStart,
      });
    }
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + stride, 1)
    );
  }
  return ticks;
}

function todayPct(domain: [string, string]): number | null {
  const minT = new Date(domain[0]).getTime();
  const maxT = new Date(domain[1]).getTime();
  const now = Date.now();
  if (now < minT || now > maxT) return null;
  return ((now - minT) / Math.max(maxT - minT, 86_400_000)) * 100;
}

function SwimLaneAxis({ domain }: { domain: [string, string] }) {
  const ticks = buildMonthTicks(domain);
  const today = todayPct(domain);
  return (
    <div className="grid grid-cols-[2fr_0.6fr_0.9fr_2.5fr] items-end gap-x-4 pb-1 pt-2">
      <span />
      <span />
      <span />
      <div className="relative h-4">
        {ticks.map((t) => (
          <span
            key={t.label + t.pct}
            className={`absolute -translate-x-1/2 font-mono text-[10px] ${
              t.isYearStart ? "font-semibold text-neutral-700 dark:text-neutral-300" : "text-neutral-400"
            }`}
            style={{ left: `${t.pct}%` }}
          >
            {t.label}
          </span>
        ))}
        {today !== null && (
          <span
            className="absolute -translate-x-1/2 font-mono text-[9px] text-neutral-500"
            style={{ left: `${today}%`, top: "-14px" }}
          >
            today
          </span>
        )}
      </div>
    </div>
  );
}

function AggregateHistogram({
  data,
  domain,
}: {
  data: MonthBucket[];
  domain: [string, string];
}) {
  const width = 1000;
  const height = 88;
  const padX = 4;
  const padY = 8;
  const minT = new Date(domain[0]).getTime();
  const maxT = new Date(domain[1]).getTime();
  const range = Math.max(maxT - minT, 86_400_000);
  const maxTotal = Math.max(...data.map((d) => d.buys + d.sells), 1);
  const totalMonths = monthsBetween(domain[0], domain[1]);
  const barW = Math.max(2, (width - padX * 2) / Math.max(1, totalMonths));

  const todayMs = Date.now();
  const todayX =
    todayMs >= minT && todayMs <= maxT
      ? padX + ((todayMs - minT) / range) * (width - padX * 2)
      : null;

  const ticks = buildMonthTicks(domain);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Trades per month, stacked by purchase and sale"
    >
      {ticks
        .filter((t) => t.isYearStart)
        .map((t) => (
          <line
            key={`grid-${t.pct}`}
            x1={padX + (t.pct / 100) * (width - padX * 2)}
            x2={padX + (t.pct / 100) * (width - padX * 2)}
            y1={padY}
            y2={height - padY}
            stroke="#ececec"
          />
        ))}
      <line
        x1={padX}
        x2={width - padX}
        y1={height - padY}
        y2={height - padY}
        stroke="#d4d4d4"
      />
      {data.map((d) => {
        const t = new Date(`${d.month}-01`).getTime();
        const x = padX + ((t - minT) / range) * (width - padX * 2);
        const total = d.buys + d.sells;
        const totalH = ((height - padY * 2) * total) / maxTotal;
        const buyH = total > 0 ? (totalH * d.buys) / total : 0;
        const sellH = totalH - buyH;
        return (
          <g key={d.month}>
            <rect
              x={x - barW / 2}
              y={height - padY - sellH}
              width={barW}
              height={sellH}
              fill={SELL_COLOR}
              fillOpacity={0.85}
            />
            <rect
              x={x - barW / 2}
              y={height - padY - sellH - buyH}
              width={barW}
              height={buyH}
              fill={BUY_COLOR}
              fillOpacity={0.85}
            />
          </g>
        );
      })}
      {todayX !== null && (
        <line
          x1={todayX}
          x2={todayX}
          y1={padY}
          y2={height - padY}
          stroke="#737373"
          strokeDasharray="3 2"
        />
      )}
    </svg>
  );
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}
