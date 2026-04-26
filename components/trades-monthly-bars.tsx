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

export function TradesMonthlyBars({ monthly }: { monthly: MonthBucket[] }) {
  if (!monthly.length) return null;

  const totals = monthly.map((m) => m.dem + m.rep + m.ind);
  const peak = Math.max(...totals, 1);
  const peakIdx = totals.indexOf(peak);
  const peakMonth = monthly[peakIdx];

  const W = 600;
  const H = 96;
  const padTop = 18;
  const padBottom = 18;
  const padLeft = 0;
  const padRight = 0;
  const innerH = H - padTop - padBottom;
  const innerW = W - padLeft - padRight;
  const slot = innerW / monthly.length;
  const barW = Math.max(slot * 0.62, 4);

  const yOf = (n: number) => padTop + innerH - (n / peak) * innerH;

  return (
    <figure className="not-prose">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Disclosed congressional trades by month, peaking at ${peak.toLocaleString()} in ${fmtMonth(peakMonth.month)}.`}
      >
        {/* baseline */}
        <line
          x1={padLeft}
          x2={W - padRight}
          y1={padTop + innerH}
          y2={padTop + innerH}
          stroke="currentColor"
          className="text-neutral-200 dark:text-neutral-800"
          strokeWidth={1}
        />

        {monthly.map((m, i) => {
          const x = padLeft + i * slot + (slot - barW) / 2;
          const total = m.dem + m.rep + m.ind;
          const yDem = yOf(total);
          const yRep = yOf(total - m.dem);
          const yInd = yOf(total - m.dem - m.rep);
          const yBase = padTop + innerH;
          const isPeak = i === peakIdx;

          return (
            <g key={m.month}>
              {m.dem > 0 && (
                <rect x={x} y={yDem} width={barW} height={Math.max(yRep - yDem, 0.5)} fill={DEM} fillOpacity={isPeak ? 1 : 0.85} />
              )}
              {m.rep > 0 && (
                <rect x={x} y={yRep} width={barW} height={Math.max(yInd - yRep, 0.5)} fill={REP} fillOpacity={isPeak ? 1 : 0.85} />
              )}
              {m.ind > 0 && (
                <rect x={x} y={yInd} width={barW} height={Math.max(yBase - yInd, 0.5)} fill={IND} fillOpacity={isPeak ? 1 : 0.85} />
              )}
            </g>
          );
        })}

        {/* peak annotation */}
        {peakMonth && (
          <g>
            <text
              x={padLeft + peakIdx * slot + slot / 2}
              y={yOf(peak) - 6}
              textAnchor="middle"
              className="fill-neutral-700 dark:fill-neutral-300"
              fontSize="11"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontWeight={500}
            >
              {peak.toLocaleString()}
            </text>
          </g>
        )}

        {/* x-axis labels: first, peak, last (deduped) */}
        {(() => {
          const idxs = [0, peakIdx, monthly.length - 1];
          const seen = new Set<number>();
          return idxs
            .filter((i) => !seen.has(i) && (seen.add(i), true))
            .map((i) => {
              const m = monthly[i];
              return (
                <text
                  key={m.month}
                  x={padLeft + i * slot + slot / 2}
                  y={H - 4}
                  textAnchor="middle"
                  className="fill-neutral-400"
                  fontSize="10"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  {fmtMonth(m.month)} {m.month.slice(2, 4) !== monthly[0].month.slice(2, 4) || i === 0
                    ? `'${m.month.slice(2, 4)}`
                    : ""}
                </text>
              );
            });
        })()}
      </svg>

      <figcaption className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-neutral-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: DEM }} /> Democrat
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: REP }} /> Republican
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: IND }} /> Independent
        </span>
        <span className="text-neutral-300 dark:text-neutral-600">·</span>
        <span>One bar per month, last 14 months</span>
      </figcaption>
    </figure>
  );
}
