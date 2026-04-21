interface PartyBarProps {
  democrat: number;
  republican: number;
  independent: number;
  height?: number;
  showLabels?: boolean;
}

export function PartyBar({
  democrat,
  republican,
  independent,
  height = 6,
  showLabels = false,
}: PartyBarProps) {
  const total = democrat + republican + independent;
  if (total === 0) return null;

  const demPct = (democrat / total) * 100;
  const repPct = (republican / total) * 100;
  const indPct = (independent / total) * 100;

  return (
    <div>
      <div
        className="flex w-full overflow-hidden rounded-sm"
        style={{ height }}
      >
        {democrat > 0 && (
          <div
            className="bg-blue-600"
            style={{ width: `${demPct}%` }}
          />
        )}
        {independent > 0 && (
          <div
            className="bg-purple-500"
            style={{ width: `${indPct}%` }}
          />
        )}
        {republican > 0 && (
          <div
            className="bg-red-600"
            style={{ width: `${repPct}%` }}
          />
        )}
      </div>
      {showLabels && (
        <div className="mt-1.5 flex gap-3 font-mono text-[11px] text-neutral-500">
          {democrat > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-600" />
              {democrat}D
            </span>
          )}
          {independent > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-500" />
              {independent}I
            </span>
          )}
          {republican > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-600" />
              {republican}R
            </span>
          )}
        </div>
      )}
    </div>
  );
}
