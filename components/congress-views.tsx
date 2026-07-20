"use client";

import { useState, type ReactNode } from "react";

// Homepage toggle between the state cartogram and parliament-style seat
// charts of House and Senate control. One seat = one dot (position, not
// area, encodes the count); the dashed center line marks the majority
// threshold; vacancies render hollow rather than being silently dropped.

export interface ChamberComposition {
  democrat: number;
  republican: number;
  independent: number;
  vacant: number;
}

interface CongressViewsProps {
  statesView: ReactNode;
  house: ChamberComposition;
  senate: ChamberComposition;
}

type Tab = "states" | "house" | "senate";

const PARTY_FILL = {
  democrat: "#2563eb",
  independent: "#78716c",
  republican: "#dc2626",
} as const;

interface Seat {
  x: number;
  y: number;
  angle: number;
}

// Distribute n seats across concentric semicircle rows, seats per row
// proportional to row circumference, then sweep left (pi) to right (0) so
// parties fill as contiguous wedges.
function layoutSeats(total: number, rows: number): Seat[] {
  const r0 = 0.48;
  const radii = Array.from(
    { length: rows },
    (_, i) => r0 + (i * (1 - r0)) / (rows - 1)
  );
  const weight = radii.reduce((a, b) => a + b, 0);
  const alloc = radii.map((r) => Math.floor((total * r) / weight));
  let rem = total - alloc.reduce((a, b) => a + b, 0);
  for (let i = rows - 1; rem > 0; i = (i - 1 + rows) % rows) {
    alloc[i] += 1;
    rem -= 1;
  }

  const seats: Seat[] = [];
  alloc.forEach((count, row) => {
    const r = radii[row];
    for (let s = 0; s < count; s++) {
      const angle = count === 1 ? Math.PI / 2 : Math.PI - (s * Math.PI) / (count - 1);
      seats.push({ x: r * Math.cos(angle), y: r * Math.sin(angle), angle });
    }
  });
  return seats.sort((a, b) => b.angle - a.angle || a.x - b.x);
}

function Hemicycle({
  comp,
  chamber,
}: {
  comp: ChamberComposition;
  chamber: "house" | "senate";
}) {
  const totalSeats =
    comp.democrat + comp.republican + comp.independent + comp.vacant;
  const rows = chamber === "house" ? 12 : 4;
  const dotR = chamber === "house" ? 2.1 : 4.0;
  const seats = layoutSeats(totalSeats, rows);
  const majority = Math.floor(totalSeats / 2) + 1;

  // Left-to-right fill: Democrats, independents, vacants, Republicans.
  const fills: { fill: string; hollow: boolean }[] = [
    ...Array<{ fill: string; hollow: boolean }>(comp.democrat).fill({
      fill: PARTY_FILL.democrat,
      hollow: false,
    }),
    ...Array<{ fill: string; hollow: boolean }>(comp.independent).fill({
      fill: PARTY_FILL.independent,
      hollow: false,
    }),
    ...Array<{ fill: string; hollow: boolean }>(comp.vacant).fill({
      fill: "none",
      hollow: true,
    }),
    ...Array<{ fill: string; hollow: boolean }>(comp.republican).fill({
      fill: PARTY_FILL.republican,
      hollow: false,
    }),
  ];

  const label = chamber === "house" ? "House" : "Senate";
  const leader =
    comp.republican > comp.democrat
      ? { name: "Republicans", n: comp.republican }
      : comp.democrat > comp.republican
        ? { name: "Democrats", n: comp.democrat }
        : null;

  return (
    <div>
      <p className="text-center text-sm text-neutral-700">
        <span className="font-medium">{label}:</span>{" "}
        {leader ? (
          <>
            {leader.name} hold {leader.n} of {totalSeats} seats
            {leader.n >= majority ? "" : " — short of a majority"}.
          </>
        ) : (
          <>an even split.</>
        )}{" "}
        <span className="text-neutral-400">{majority} for a majority.</span>
      </p>
      <svg
        viewBox="-2 -6 204 110"
        role="img"
        aria-label={`${label} composition: ${comp.democrat} Democrats, ${comp.republican} Republicans, ${comp.independent} independents, ${comp.vacant} vacant of ${totalSeats} seats`}
        className="mx-auto mt-2 block w-full max-w-md"
      >
        <line
          x1="100"
          y1="-4"
          x2="100"
          y2={100 - 0.48 * 92 + 6}
          stroke="#d4d4d4"
          strokeWidth="0.75"
          strokeDasharray="2 2"
        />
        {seats.map((s, i) => {
          const f = fills[i] ?? { fill: "none", hollow: true };
          return (
            <circle
              key={i}
              cx={100 + s.x * 92}
              cy={100 - s.y * 92}
              r={dotR}
              fill={f.fill}
              stroke={f.hollow ? "#a3a3a3" : "none"}
              strokeWidth={f.hollow ? 0.75 : 0}
            />
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-xs">
        <span style={{ color: PARTY_FILL.democrat }}>
          {comp.democrat} Democrats
        </span>
        {comp.independent > 0 && (
          <span style={{ color: PARTY_FILL.independent }}>
            {comp.independent} independent{comp.independent === 1 ? "" : "s"}
          </span>
        )}
        {comp.vacant > 0 && (
          <span className="text-neutral-400">{comp.vacant} vacant</span>
        )}
        <span style={{ color: PARTY_FILL.republican }}>
          {comp.republican} Republicans
        </span>
      </div>
      <p className="mt-2 text-center text-[10px] text-neutral-400">
        Voting seats only — delegates from DC and the territories do not vote.
        Dashed line marks the majority threshold; hollow seats are vacant.
        Source: @unitedstates, current sitting members.
      </p>
    </div>
  );
}

export function CongressViews({ statesView, house, senate }: CongressViewsProps) {
  const [tab, setTab] = useState<Tab>("states");

  const tabs: { id: Tab; label: string }[] = [
    { id: "states", label: "State map" },
    { id: "house", label: "House" },
    { id: "senate", label: "Senate" },
  ];

  return (
    <div>
      <div className="mb-4 flex justify-center">
        <div className="inline-flex rounded-full border border-neutral-200 bg-white p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                tab === t.id
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "states" && statesView}
      {tab === "house" && <Hemicycle comp={house} chamber="house" />}
      {tab === "senate" && <Hemicycle comp={senate} chamber="senate" />}
    </div>
  );
}
