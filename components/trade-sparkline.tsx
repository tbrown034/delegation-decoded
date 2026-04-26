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

export function TradeSparkline({
  trades,
  width = 220,
  height = 36,
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

  const padX = 2;
  const y = height / 2;

  const xOf = (iso: string) => {
    const t = new Date(iso).getTime();
    return padX + ((t - minT) / range) * (width - padX * 2);
  };

  const amounts = dated.map(midAmount);
  const minA = Math.max(Math.min(...amounts), 1);
  const maxA = Math.max(...amounts, 2);
  const rOf = (a: number) => {
    const lr = Math.log(Math.max(a, 1)) - Math.log(minA);
    const lt = Math.log(maxA) - Math.log(minA);
    return 2 + (lt > 0 ? (lr / lt) * 4 : 0);
  };

  return (
    <svg width={width} height={height} className="block">
      <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="#e5e5e5" />
      {dated.map((tx) => {
        const x = xOf(tx.txDate);
        const r = rOf(midAmount(tx));
        const isBuy = tx.txType === "P";
        return isBuy ? (
          <circle
            key={tx.id}
            cx={x}
            cy={y}
            r={r}
            fill="white"
            stroke="#737373"
            strokeWidth={0.8}
          />
        ) : (
          <circle
            key={tx.id}
            cx={x}
            cy={y}
            r={r}
            fill="#737373"
            fillOpacity={0.8}
          />
        );
      })}
    </svg>
  );
}
