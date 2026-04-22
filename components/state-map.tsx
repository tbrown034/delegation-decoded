import Link from "next/link";

interface StateData {
  code: string;
  name: string;
  memberCount: number;
  parties: {
    democrat: number;
    republican: number;
    independent: number;
  };
}

interface StateMapProps {
  states: StateData[];
}

// Geographic tile grid — each state positioned roughly where it sits on a US map
// Grid is 11 columns x 8 rows
const GRID: (string | null)[][] = [
  [null, null, null, null, null, null, null, null, null, null, "ME"],
  ["AK", null, null, null, null, null, "WI", null, null, "VT", "NH"],
  [null, "WA", "ID", "MT", "ND", "MN", "IL", "MI", null, "NY", "MA"],
  [null, "OR", "NV", "WY", "SD", "IA", "IN", "OH", "PA", "NJ", "CT"],
  [null, "CA", "UT", "CO", "NE", "MO", "KY", "WV", "VA", "MD", "RI"],
  [null, null, "AZ", "NM", "KS", "AR", "TN", "NC", "SC", "DE", null],
  ["HI", null, null, null, "OK", "LA", "MS", "AL", "GA", null, null],
  [null, null, null, null, "TX", null, null, null, null, "FL", null],
];

function getDominantColor(parties: StateData["parties"]): string {
  const { democrat, republican, independent } = parties;
  const total = democrat + republican + independent;
  if (total === 0) return "bg-neutral-100 dark:bg-neutral-800";

  const demPct = democrat / total;
  const repPct = republican / total;

  // Strong majority (>65%)
  if (demPct > 0.65) return "bg-blue-600";
  if (repPct > 0.65) return "bg-red-600";

  // Lean (>50%)
  if (demPct > 0.5) return "bg-blue-400";
  if (repPct > 0.5) return "bg-red-400";

  // Even split
  return "bg-purple-400";
}

function getTextColor(parties: StateData["parties"]): string {
  const { democrat, republican, independent } = parties;
  const total = democrat + republican + independent;
  if (total === 0) return "text-neutral-400";

  const demPct = democrat / total;
  const repPct = republican / total;

  if (demPct > 0.65 || repPct > 0.65) return "text-white";
  return "text-white";
}

export function StateMap({ states }: StateMapProps) {
  const stateMap = new Map(states.map((s) => [s.code, s]));

  return (
    <div className="overflow-x-auto">
      <div className="mx-auto grid min-w-[440px] max-w-2xl grid-cols-11 gap-[3px]">
        {GRID.flat().map((code, i) => {
          if (!code) {
            return <div key={`empty-${i}`} />;
          }

          const state = stateMap.get(code);
          if (!state) {
            return <div key={code} />;
          }

          const bg = getDominantColor(state.parties);
          const text = getTextColor(state.parties);

          return (
            <Link
              key={code}
              href={`/state/${code}`}
              className={`group relative flex aspect-square items-center justify-center rounded-[3px] no-underline transition-opacity hover:opacity-80 ${bg}`}
              title={`${state.name} — ${state.memberCount} members`}
            >
              <span
                className={`font-mono text-[11px] font-semibold leading-none ${text}`}
              >
                {code}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
