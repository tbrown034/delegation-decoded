"use client";

import { useMemo, useState } from "react";

export interface TimelineTrade {
  id: number;
  txDate: string | null;
  txType: string;
  amountMin: number | null;
  amountMax: number | null;
  ticker: string | null;
  assetDescription: string;
  filedLate: boolean | null;
}

interface Props {
  trades: TimelineTrade[];
  height?: number;
  party?: string;
}

function midAmount(t: TimelineTrade): number {
  if (t.amountMin && t.amountMax) return (t.amountMin + t.amountMax) / 2;
  return t.amountMin ?? t.amountMax ?? 1000;
}

const BUY_COLOR = "#16a34a";
const SELL_COLOR = "#dc2626";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function TradeTimeline({ trades, height = 220 }: Props) {
  const [hoverId, setHoverId] = useState<number | null>(null);

  const dated = trades.filter((t): t is TimelineTrade & { txDate: string } =>
    Boolean(t.txDate)
  );

  const layout = useMemo(() => {
    if (dated.length === 0) return null;
    const times = dated.map((t) => new Date(t.txDate).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const range = Math.max(maxT - minT, 86_400_000);

    const padX = 40;
    const padTop = 28;
    const padBottom = 44;
    const width = 720;
    const tradesY = (height - padBottom + padTop) / 2 + 16;

    const xOf = (iso: string) => {
      const t = new Date(iso).getTime();
      return padX + ((t - minT) / range) * (width - padX * 2);
    };

    const amounts = dated.map(midAmount);
    const minA = Math.min(...amounts.filter((a) => a > 0), 1);
    const maxA = Math.max(...amounts, 1);
    const rOf = (a: number) => {
      const lr = Math.log(Math.max(a, 1)) - Math.log(minA);
      const lt = Math.log(Math.max(maxA, 2)) - Math.log(minA);
      return 5 + (lt > 0 ? (lr / lt) * 11 : 0);
    };

    return { width, padX, padTop, padBottom, tradesY, xOf, rOf, minT, maxT };
  }, [dated, height]);

  if (!layout || dated.length === 0) {
    return (
      <div className="rounded border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700">
        No dated transactions to plot yet.
      </div>
    );
  }

  const monthTicks: { x: number; label: string; isYearStart: boolean }[] = [];
  const start = new Date(layout.minT);
  const end = new Date(layout.maxT);
  const totalMonths =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  const stride = totalMonths > 18 ? 3 : totalMonths > 6 ? 2 : 1;

  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor.getTime() <= layout.maxT) {
    const iso = cursor.toISOString().slice(0, 10);
    const x = layout.xOf(iso);
    if (x >= layout.padX - 10 && x <= layout.width - layout.padX + 10) {
      const m = cursor.getUTCMonth();
      const isYearStart = m === 0;
      const label = isYearStart
        ? `Jan ${cursor.getUTCFullYear()}`
        : MONTH_LABELS[m];
      monthTicks.push({ x, label, isYearStart });
    }
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + stride, 1)
    );
  }

  const todayMs = Date.now();
  const todayIso = new Date(todayMs).toISOString().slice(0, 10);
  const todayX =
    todayMs >= layout.minT && todayMs <= layout.maxT
      ? layout.xOf(todayIso)
      : null;

  const buys = dated.filter((t) => t.txType === "P");
  const sells = dated.filter((t) => t.txType !== "P");

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${layout.width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Trade timeline"
      >
        <rect
          x={layout.padX}
          y={layout.tradesY - 36}
          width={layout.width - layout.padX * 2}
          height={72}
          fill="#fafafa"
          rx={4}
        />
        {monthTicks.map((t) => (
          <g key={`tick-${t.x}`}>
            <line
              x1={t.x}
              x2={t.x}
              y1={layout.tradesY - 36}
              y2={layout.tradesY + 36}
              stroke={t.isYearStart ? "#d4d4d4" : "#ececec"}
              strokeDasharray={t.isYearStart ? undefined : "2 3"}
            />
            <text
              x={t.x}
              y={height - 8}
              fontSize="10"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              textAnchor="middle"
              fill={t.isYearStart ? "#525252" : "#a3a3a3"}
            >
              {t.label}
            </text>
          </g>
        ))}

        {todayX !== null && (
          <g>
            <line
              x1={todayX}
              x2={todayX}
              y1={layout.tradesY - 36}
              y2={layout.tradesY + 36}
              stroke="#a3a3a3"
              strokeDasharray="3 2"
            />
            <text
              x={todayX}
              y={layout.tradesY - 40}
              fontSize="9"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              textAnchor="middle"
              fill="#737373"
            >
              today
            </text>
          </g>
        )}

        <line
          x1={layout.padX}
          x2={layout.width - layout.padX}
          y1={layout.tradesY}
          y2={layout.tradesY}
          stroke="#d4d4d4"
        />

        {dated.map((tx) => {
          const x = layout.xOf(tx.txDate);
          const r = layout.rOf(midAmount(tx));
          const isBuy = tx.txType === "P";
          const fill = isBuy ? BUY_COLOR : SELL_COLOR;
          const isHover = hoverId === tx.id;
          return (
            <g
              key={`tx-${tx.id}`}
              onMouseEnter={() => setHoverId(tx.id)}
              onMouseLeave={() => setHoverId(null)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={x}
                cy={layout.tradesY}
                r={r}
                fill={fill}
                fillOpacity={isHover ? 0.95 : 0.78}
                stroke={isHover ? "#171717" : "transparent"}
                strokeWidth={isHover ? 1 : 0}
              />
              {tx.filedLate && (
                <circle
                  cx={x + r * 0.75}
                  cy={layout.tradesY - r * 0.75}
                  r={2.5}
                  fill="#f59e0b"
                  stroke="white"
                  strokeWidth={0.6}
                />
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-neutral-600 dark:text-neutral-400">
        <LegendItem>
          <span
            className="block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: BUY_COLOR, opacity: 0.85 }}
          />
          Purchase ({buys.length})
        </LegendItem>
        <LegendItem>
          <span
            className="block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: SELL_COLOR, opacity: 0.85 }}
          />
          Sale ({sells.length})
        </LegendItem>
        <LegendItem>
          <span className="block h-2 w-2 rounded-full bg-amber-500" />
          Filed late
        </LegendItem>
        <span className="ml-auto font-mono text-neutral-400">
          Mark size = amount range (log scale)
        </span>
      </div>

      {hoverId !== null &&
        (() => {
          const tx = dated.find((t) => t.id === hoverId);
          if (!tx) return null;
          return (
            <div className="mt-3 rounded border border-neutral-200 bg-white p-3 text-xs shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono">{tx.txDate}</span>
                <span className="font-medium">
                  {tx.txType === "P"
                    ? "Purchase"
                    : tx.txType === "E"
                      ? "Exchange"
                      : "Sale"}
                </span>
              </div>
              <div className="mt-1">
                {tx.ticker && (
                  <span className="font-mono font-semibold">{tx.ticker}</span>
                )}
                {tx.ticker && <span className="text-neutral-400"> · </span>}
                <span>{tx.assetDescription}</span>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

function LegendItem({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5">{children}</span>;
}
