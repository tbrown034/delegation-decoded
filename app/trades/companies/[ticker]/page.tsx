import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  members,
  stockTransactions,
  disclosureFilings,
} from "@/lib/schema";
import { eq } from "drizzle-orm";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  return {
    title: `${ticker.toUpperCase()} — Congressional holders`,
    description: `Members of Congress who disclosed trades in ${ticker.toUpperCase()} under the STOCK Act.`,
  };
}

const PARTY_DOT: Record<string, string> = {
  Democrat: "bg-blue-600",
  Republican: "bg-red-600",
  Independent: "bg-purple-500",
};

const TX_COLOR: Record<string, string> = {
  P: "#525252",
  S: "#525252",
  "S (partial)": "#525252",
  E: "#737373",
};

export default async function TickerPage({ params }: Props) {
  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  const txs = await db
    .select({
      id: stockTransactions.id,
      bioguideId: stockTransactions.bioguideId,
      txDate: stockTransactions.txDate,
      txType: stockTransactions.txType,
      amountMin: stockTransactions.amountMin,
      amountMax: stockTransactions.amountMax,
      assetDescription: stockTransactions.assetDescription,
      filedLate: stockTransactions.filedLate,
      pdfUrl: disclosureFilings.pdfUrl,
      memberName: members.fullName,
      party: members.party,
      stateCode: members.stateCode,
      chamber: members.chamber,
    })
    .from(stockTransactions)
    .innerJoin(
      members,
      eq(members.bioguideId, stockTransactions.bioguideId)
    )
    .innerJoin(
      disclosureFilings,
      eq(disclosureFilings.id, stockTransactions.filingId)
    )
    .where(eq(stockTransactions.ticker, symbol))
    .orderBy(stockTransactions.txDate);

  // Group by member
  interface MemberBucket {
    bioguideId: string;
    memberName: string;
    party: string;
    stateCode: string;
    chamber: string;
    trades: typeof txs;
  }
  const byMember = new Map<string, MemberBucket>();
  for (const t of txs) {
    let bucket = byMember.get(t.bioguideId);
    if (!bucket) {
      bucket = {
        bioguideId: t.bioguideId,
        memberName: t.memberName,
        party: t.party,
        stateCode: t.stateCode,
        chamber: t.chamber,
        trades: [],
      };
      byMember.set(t.bioguideId, bucket);
    }
    bucket.trades.push(t);
  }

  const memberRows = Array.from(byMember.values()).sort(
    (a, b) => b.trades.length - a.trades.length
  );

  // Time domain across all trades
  const allDates = txs
    .map((t) => t.txDate)
    .filter((d): d is string => !!d)
    .sort();
  const minDate = allDates[0];
  const maxDate = allDates[allDates.length - 1];

  if (txs.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          {symbol}
        </h1>
        <p className="mt-3 text-sm text-neutral-500">
          No disclosed congressional trades in {symbol} on file.
        </p>
        <Link
          href="/trades"
          className="mt-6 inline-block text-sm underline"
        >
          ← All members
        </Link>
      </div>
    );
  }

  // Aggregate stats
  const buyCount = txs.filter((t) => t.txType === "P").length;
  const sellCount = txs.filter((t) => t.txType.startsWith("S")).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <nav className="mb-6 font-mono text-xs text-neutral-400">
        <Link href="/trades" className="hover:text-neutral-700">
          Conflicts
        </Link>
        <span className="mx-1.5">/</span>
        <span>Companies</span>
        <span className="mx-1.5">/</span>
        <span>{symbol}</span>
      </nav>

      <header className="mb-6 max-w-3xl">
        <h1 className="font-serif text-4xl font-semibold tracking-tight">
          {symbol}
        </h1>
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
          {memberRows.length} {memberRows.length === 1 ? "member" : "members"} of
          Congress disclosed {txs.length} {txs.length === 1 ? "trade" : "trades"}{" "}
          in {symbol} between{" "}
          <span className="font-mono">{minDate.slice(0, 7)}</span> and{" "}
          <span className="font-mono">{maxDate.slice(0, 7)}</span>.{" "}
          {buyCount} purchase{buyCount === 1 ? "" : "s"}, {sellCount} sale
          {sellCount === 1 ? "" : "s"}.
        </p>
      </header>

      {/* Multi-row timeline: each member = one horizontal track */}
      <section className="mb-8 overflow-x-auto">
        <TickerHoldersChart
          memberRows={memberRows}
          minDate={minDate}
          maxDate={maxDate}
        />
      </section>

      {/* Member list */}
      <section>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-neutral-500">
          Holders
        </h2>
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
          {memberRows.map((r) => (
            <li
              key={r.bioguideId}
              className="flex items-center gap-3 py-2 text-sm"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${PARTY_DOT[r.party] || "bg-neutral-400"}`}
                aria-hidden
              />
              <Link
                href={`/trades/${r.bioguideId}`}
                className="flex-1 truncate font-medium hover:underline"
              >
                {r.memberName}
              </Link>
              <span className="font-mono text-xs text-neutral-500">
                {r.stateCode}
                {r.chamber === "house" ? "-H" : "-S"}
              </span>
              <span className="font-mono text-xs">
                {r.trades.length} trade{r.trades.length === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

interface ChartProps {
  memberRows: Array<{
    bioguideId: string;
    memberName: string;
    party: string;
    trades: Array<{
      id: number;
      txDate: string | null;
      txType: string;
      amountMin: number | null;
      amountMax: number | null;
    }>;
  }>;
  minDate: string;
  maxDate: string;
}

function TickerHoldersChart({ memberRows, minDate, maxDate }: ChartProps) {
  const padX = 160;
  const padTop = 24;
  const rowH = 22;
  const width = 880;
  const height = padTop + memberRows.length * rowH + 24;

  const minT = new Date(minDate).getTime();
  const maxT = new Date(maxDate).getTime();
  const range = Math.max(maxT - minT, 86_400_000);

  const xOf = (iso: string) =>
    padX + ((new Date(iso).getTime() - minT) / range) * (width - padX - 16);

  // Year ticks
  const years: number[] = [];
  for (
    let y = new Date(minDate).getUTCFullYear();
    y <= new Date(maxDate).getUTCFullYear();
    y++
  ) {
    years.push(y);
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="Member holdings timeline"
    >
      {years.map((y) => {
        const x = xOf(`${y}-01-01`);
        return (
          <g key={y}>
            <line
              x1={x}
              x2={x}
              y1={padTop - 6}
              y2={height - 16}
              stroke="#f0f0f0"
            />
            <text
              x={x}
              y={padTop - 10}
              fontSize="10"
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              className="fill-neutral-400"
            >
              {y}
            </text>
          </g>
        );
      })}
      {memberRows.map((m, i) => {
        const y = padTop + i * rowH + rowH / 2;
        return (
          <g key={m.bioguideId}>
            <text
              x={padX - 8}
              y={y + 3}
              textAnchor="end"
              fontSize="11"
              className="fill-neutral-700 dark:fill-neutral-300"
            >
              {m.memberName.length > 22
                ? m.memberName.slice(0, 21) + "…"
                : m.memberName}
            </text>
            <line
              x1={padX}
              x2={width - 16}
              y1={y}
              y2={y}
              stroke="#e5e5e5"
            />
            {m.trades
              .filter(
                (t): t is typeof t & { txDate: string } => Boolean(t.txDate)
              )
              .map((t) => {
                const x = xOf(t.txDate);
                const isBuy = t.txType === "P";
                const r = 4;
                const stroke = TX_COLOR[t.txType] ?? "#525252";
                return isBuy ? (
                  <polygon
                    key={t.id}
                    points={`${x},${y - r} ${x - r},${y + r * 0.6} ${x + r},${y + r * 0.6}`}
                    fill="white"
                    stroke={stroke}
                    strokeWidth={1}
                  />
                ) : (
                  <polygon
                    key={t.id}
                    points={`${x},${y + r} ${x - r},${y - r * 0.6} ${x + r},${y - r * 0.6}`}
                    fill={stroke}
                    fillOpacity={0.85}
                  />
                );
              })}
          </g>
        );
      })}
    </svg>
  );
}
