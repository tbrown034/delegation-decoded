interface Props {
  trades: Array<{
    id: number;
    txDate: string | null;
    txType: string;
    amountMin: number | null;
    amountMax: number | null;
  }>;
  width?: number;
  height?: number;
  domain?: [string, string];
}

function midAmount(t: {
  amountMin: number | null;
  amountMax: number | null;
}): number {
  if (t.amountMin && t.amountMax) return (t.amountMin + t.amountMax) / 2;
  return t.amountMin ?? t.amountMax ?? 1000;
}

const BUY_COLOR = "#16a34a";
const SELL_COLOR = "#dc2626";
const NUM_BUCKETS = 64;

export function TradeSparkline({
  trades,
  width = 320,
  height = 44,
  domain,
}: Props) {
  const dated = trades.filter((t): t is typeof t & { txDate: string } =>
    Boolean(t.txDate)
  );
  if (dated.length === 0) return <svg width={width} height={height} />;

  const times = dated.map((t) => new Date(t.txDate).getTime());
  const minT = domain ? new Date(domain[0]).getTime() : Math.min(...times);
  const maxT = domain ? new Date(domain[1]).getTime() : Math.max(...times);
  const range = Math.max(maxT - minT, 86_400_000);

  const padX = 4;
  const y = height / 2;

  const buckets = new Map<number, { buyAmt: number; sellAmt: number }>();
  for (const tx of dated) {
    const t = new Date(tx.txDate).getTime();
    const idx = Math.min(
      NUM_BUCKETS - 1,
      Math.max(0, Math.floor(((t - minT) / range) * NUM_BUCKETS))
    );
    const b = buckets.get(idx) ?? { buyAmt: 0, sellAmt: 0 };
    const amt = midAmount(tx);
    if (tx.txType === "P") b.buyAmt += amt;
    else b.sellAmt += amt;
    buckets.set(idx, b);
  }

  const renderedAmts: number[] = [];
  buckets.forEach((b) => {
    if (b.buyAmt > 0) renderedAmts.push(b.buyAmt);
    if (b.sellAmt > 0) renderedAmts.push(b.sellAmt);
  });
  const minA = Math.max(Math.min(...renderedAmts), 1);
  const maxA = Math.max(...renderedAmts, 2);
  const rOf = (a: number) => {
    const lr = Math.log(Math.max(a, 1)) - Math.log(minA);
    const lt = Math.log(maxA) - Math.log(minA);
    return 3.5 + (lt > 0 ? (lr / lt) * 5 : 0);
  };

  const xOfBucket = (idx: number) =>
    padX + ((idx + 0.5) / NUM_BUCKETS) * (width - padX * 2);

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block"
    >
      <line
        x1={padX}
        x2={width - padX}
        y1={y}
        y2={y}
        stroke="#e5e5e5"
        strokeWidth={1}
      />
      {Array.from(buckets.entries()).flatMap(([idx, b]) => {
        const x = xOfBucket(idx);
        const out = [];
        if (b.sellAmt > 0) {
          out.push(
            <circle
              key={`s${idx}`}
              cx={x}
              cy={y}
              r={rOf(b.sellAmt)}
              fill={SELL_COLOR}
              fillOpacity={0.8}
            />
          );
        }
        if (b.buyAmt > 0) {
          out.push(
            <circle
              key={`b${idx}`}
              cx={x}
              cy={y}
              r={rOf(b.buyAmt)}
              fill={BUY_COLOR}
              fillOpacity={0.8}
            />
          );
        }
        return out;
      })}
    </svg>
  );
}
