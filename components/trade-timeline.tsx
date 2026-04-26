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
}

function midAmount(t: TimelineTrade): number {
  if (t.amountMin && t.amountMax) return (t.amountMin + t.amountMax) / 2;
  return t.amountMin ?? t.amountMax ?? 1000;
}

export function TradeTimeline({ trades, height = 200 }: Props) {
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

    const padX = 32;
    const padTop = 28;
    const padBottom = 36;
    const width = 720;
    const tradesY = (height - padBottom + padTop) / 2 + 20;

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
      return 4 + (lt > 0 ? (lr / lt) * 10 : 0);
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

  const yearTicks: { x: number; year: number }[] = [];
  const startYear = new Date(layout.minT).getUTCFullYear();
  const endYear = new Date(layout.maxT).getUTCFullYear();
  for (let y = startYear; y <= endYear; y++) {
    const x = layout.xOf(`${y}-01-01`);
    if (x >= layout.padX && x <= layout.width - layout.padX) {
      yearTicks.push({ x, year: y });
    }
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${layout.width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Trade timeline"
      >
        {yearTicks.map((t) => (
          <g key={t.year}>
            <line
              x1={t.x}
              x2={t.x}
              y1={layout.padTop}
              y2={layout.tradesY + 30}
              stroke="#e5e5e5"
              strokeDasharray="2 3"
            />
            <text
              x={t.x}
              y={height - 4}
              fontSize="10"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              textAnchor="middle"
              className="fill-neutral-400"
            >
              {t.year}
            </text>
          </g>
        ))}

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
          const stroke = "#525252";
          return (
            <g
              key={`tx-${tx.id}`}
              onMouseEnter={() => setHoverId(tx.id)}
              onMouseLeave={() => setHoverId(null)}
              style={{ cursor: "pointer" }}
            >
              {isBuy ? (
                <polygon
                  points={`${x},${layout.tradesY - r} ${x - r},${layout.tradesY + r * 0.6} ${x + r},${layout.tradesY + r * 0.6}`}
                  fill="white"
                  stroke={stroke}
                  strokeWidth={1}
                />
              ) : (
                <polygon
                  points={`${x},${layout.tradesY + r} ${x - r},${layout.tradesY - r * 0.6} ${x + r},${layout.tradesY - r * 0.6}`}
                  fill={stroke}
                  fillOpacity={0.85}
                />
              )}
              {tx.filedLate && (
                <circle
                  cx={x + r * 0.7}
                  cy={layout.tradesY - r * 0.7}
                  r={2}
                  fill="#d97706"
                />
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-neutral-600 dark:text-neutral-400">
        <LegendItem>
          <svg width="14" height="10">
            <polygon points="7,1 1,9 13,9" fill="white" stroke="#525252" />
          </svg>
          Purchase
        </LegendItem>
        <LegendItem>
          <svg width="14" height="10">
            <polygon points="7,9 1,1 13,1" fill="#525252" />
          </svg>
          Sale
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
