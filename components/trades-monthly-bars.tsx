"use client";

import { useState } from "react";

interface MonthBucket {
  month: string;
  dem: number;
  rep: number;
  ind: number;
}

const DEM = "#2563eb";
const REP = "#dc2626";
const IND = "#737373";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtMonth(m: string): string {
  const [, mm] = m.split("-");
  return MONTH_ABBR[parseInt(mm, 10) - 1] ?? m;
}

function fmtMonthYear(m: string): string {
  const [yy, mm] = m.split("-");
  return `${MONTH_ABBR[parseInt(mm, 10) - 1] ?? mm} '${yy.slice(2)}`;
}

export function TradesMonthlyBars({ monthly }: { monthly: MonthBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (!monthly.length) return null;
  const first = monthly[0];
  const last = monthly[monthly.length - 1];

  const totals = monthly.map((m) => m.dem + m.rep + m.ind);
  const peak = Math.max(...totals, 1);
  const peakIdx = totals.indexOf(peak);
  const peakMonth = monthly[peakIdx];

  const W = 600;
  const H = 96;
  const padTop = 18;
  const padBottom = 18;
  const innerH = H - padTop - padBottom;
  const innerW = W;
  const slot = innerW / monthly.length;
  const barW = Math.max(slot * 0.62, 4);
  const yBase = padTop + innerH;

  // Floor bar height for any non-zero month so sparse coverage is visible.
  const MIN_VISIBLE = 3;

  const hoverMonth = hover !== null ? monthly[hover] : null;
  const hoverTotal = hoverMonth
    ? hoverMonth.dem + hoverMonth.rep + hoverMonth.ind
    : 0;

  return (
    <figure className="not-prose relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Disclosed congressional trades by month, peaking at ${peak.toLocaleString()} in ${fmtMonth(peakMonth.month)}.`}
      >
        <line
          x1={0}
          x2={W}
          y1={yBase}
          y2={yBase}
          stroke="currentColor"
          className="text-neutral-200"
          strokeWidth={1}
        />

        {monthly.map((m, i) => {
          const x = i * slot + (slot - barW) / 2;
          const total = m.dem + m.rep + m.ind;
          const isPeak = i === peakIdx;
          const isHover = hover === i;

          const naturalH = (total / peak) * innerH;
          const renderedH = total > 0 ? Math.max(naturalH, MIN_VISIBLE) : 0;
          const barTop = yBase - renderedH;

          const dShare = total > 0 ? m.dem / total : 0;
          const rShare = total > 0 ? m.rep / total : 0;
          const dH = renderedH * dShare;
          const rH = renderedH * rShare;
          const iH = renderedH - dH - rH;

          const opacity = hover === null ? (isPeak ? 1 : 0.85) : isHover ? 1 : 0.4;

          return (
            <g key={m.month}>
              {m.dem > 0 && (
                <rect
                  x={x}
                  y={barTop}
                  width={barW}
                  height={Math.max(dH, 0.5)}
                  fill={DEM}
                  fillOpacity={opacity}
                />
              )}
              {m.rep > 0 && (
                <rect
                  x={x}
                  y={barTop + dH}
                  width={barW}
                  height={Math.max(rH, 0.5)}
                  fill={REP}
                  fillOpacity={opacity}
                />
              )}
              {m.ind > 0 && (
                <rect
                  x={x}
                  y={barTop + dH + rH}
                  width={barW}
                  height={Math.max(iH, 0.5)}
                  fill={IND}
                  fillOpacity={opacity}
                />
              )}
              {/* Invisible hit area covers the full slot height for easy hover */}
              <rect
                x={i * slot}
                y={padTop}
                width={slot}
                height={innerH + padBottom}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                style={{ cursor: "pointer" }}
              >
                <title>
                  {`${fmtMonthYear(m.month)} — ${total.toLocaleString()} trades · ${m.dem} D · ${m.rep} R${m.ind ? ` · ${m.ind} I` : ""}`}
                </title>
              </rect>
            </g>
          );
        })}

        {/* Peak annotation hidden when hovering a different bar */}
        {peakMonth && hover === null && (
          <text
            x={peakIdx * slot + slot / 2}
            y={yBase - (peak / peak) * innerH - 6}
            textAnchor="middle"
            className="fill-neutral-700"
            fontSize="11"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontWeight={500}
          >
            {peak.toLocaleString()}
          </text>
        )}

        {/* Hover annotation: total above the active bar */}
        {hoverMonth && hover !== null && (
          <text
            x={hover * slot + slot / 2}
            y={yBase - Math.max((hoverTotal / peak) * innerH, MIN_VISIBLE) - 6}
            textAnchor="middle"
            className="fill-neutral-900"
            fontSize="11"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            fontWeight={600}
          >
            {hoverTotal.toLocaleString()}
          </text>
        )}

        {/* X-axis labels: first, peak, last (deduped). Hover takes over. */}
        {hover === null
          ? (() => {
              const idxs = [0, peakIdx, monthly.length - 1];
              const seen = new Set<number>();
              return idxs.flatMap((i) => {
                if (seen.has(i)) return [];
                seen.add(i);
                  const m = monthly[i];
                  return [
                    <text
                      key={m.month}
                      x={i * slot + slot / 2}
                      y={H - 4}
                      textAnchor="middle"
                      className="fill-neutral-400"
                      fontSize="10"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    >
                      {fmtMonthYear(m.month)}
                    </text>
                  ];
                });
            })()
          : (
            <text
              x={hover * slot + slot / 2}
              y={H - 4}
              textAnchor="middle"
              className="fill-neutral-700"
              fontSize="10"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontWeight={600}
            >
              {fmtMonthYear(monthly[hover].month)}
            </text>
          )}
      </svg>

      {/* Detailed tooltip surface: shown on hover, anchored to top of figure */}
      {hoverMonth && (
        <div
          className="pointer-events-none absolute -top-1 right-0 rounded border border-neutral-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-sm backdrop-blur"
          aria-hidden
        >
          <div className="font-mono font-medium text-neutral-900">
            {fmtMonthYear(hoverMonth.month)}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-neutral-600">
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-sm" style={{ background: DEM }} />
              {hoverMonth.dem}
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-sm" style={{ background: REP }} />
              {hoverMonth.rep}
            </span>
            {hoverMonth.ind > 0 && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-sm" style={{ background: IND }} />
                {hoverMonth.ind}
              </span>
            )}
            <span className="text-neutral-300">·</span>
            <span className="font-medium text-neutral-900">
              {hoverTotal.toLocaleString()} total
            </span>
          </div>
        </div>
      )}

      <figcaption className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-neutral-400">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: DEM }} /> Democrat
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: REP }} /> Republican
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm" style={{ background: IND }} /> Independent
        </span>
        <span className="text-neutral-300">·</span>
        <span>
          {fmtMonthYear(first.month)} – {fmtMonthYear(last.month)} · hover for monthly detail
        </span>
      </figcaption>
    </figure>
  );
}
