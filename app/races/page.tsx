import type { Metadata } from "next";
import Link from "next/link";
import { getRaceIndex } from "@/lib/elections/queries";
import { STATE_BY_CODE } from "@/lib/states";

export const metadata: Metadata = {
  title: "2026 Congressional Races",
  description:
    "A verification-first 2026 congressional race tracker, with state election-authority records where covered and clearly labeled FEC filing fallbacks elsewhere.",
};

type Props = {
  searchParams: Promise<{ state?: string }>;
};

const COVERAGE_COPY = {
  verified_ballot: "State-verified ballot",
  verification_pending: "State records, verification pending",
  fec_only: "FEC filers only",
} as const;

const COVERAGE_TONE = {
  verified_ballot: "border-emerald-200 bg-emerald-50 text-emerald-800",
  verification_pending: "border-amber-200 bg-amber-50 text-amber-800",
  fec_only: "border-neutral-200 bg-neutral-50 text-neutral-600",
} as const;

export default async function RacesPage({ searchParams }: Props) {
  const requested = (await searchParams).state?.toUpperCase();
  const stateCode = requested && STATE_BY_CODE[requested] ? requested : null;
  const races = await getRaceIndex();
  const visibleRaces = stateCode ? races.filter((race) => race.stateCode === stateCode) : races;
  const byState = new Map<string, typeof races>();
  for (const race of races) {
    const stateRaces = byState.get(race.stateCode) ?? [];
    stateRaces.push(race);
    byState.set(race.stateCode, stateRaces);
  }
  const matchupsSet = races.filter((race) => race.matchup === "set").length;
  const matchupsForming = races.filter((race) => race.matchup === "partial").length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <p className="font-mono text-xs uppercase tracking-wider text-neutral-400">2026 midterms</p>
      <h1 className="mt-2 max-w-3xl font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
        Who is still running, and how we know
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-600">
        State election authorities control ballot status. Covered states use those records. Every other state remains in a plainly labeled FEC-filings mode until its adapter passes verification.
      </p>
      <p className="mt-2 font-mono text-xs text-neutral-500">
        {matchupsSet} of {races.length} November matchups set from state sources
        {matchupsForming > 0 && ` · ${matchupsForming} forming`}
      </p>

      {stateCode ? (
        <>
          <div className="mt-8 flex items-baseline justify-between gap-4 border-b border-neutral-200 pb-3">
            <h2 className="font-serif text-2xl font-semibold">{STATE_BY_CODE[stateCode].name}</h2>
            <Link href="/races" className="text-xs text-neutral-500 underline decoration-neutral-300 underline-offset-2">
              All states
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {visibleRaces.map((race) => (
              <RaceCard key={race.contestId} race={race} />
            ))}
          </div>
        </>
      ) : (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">Coverage by state</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from(byState, ([code, stateRaces]) => {
              const strongest = stateRaces.some((race) => race.coverage === "verified_ballot")
                ? "verified_ballot"
                : stateRaces.some((race) => race.coverage === "verification_pending")
                  ? "verification_pending"
                  : "fec_only";
              const candidateCount = stateRaces.reduce((sum, race) => sum + race.activeCandidates, 0);
              return (
                <Link
                  key={code}
                  href={`/races?state=${code}`}
                  className="rounded border border-neutral-200 bg-white p-3 no-underline transition-colors hover:border-neutral-400"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-neutral-900">{STATE_BY_CODE[code]?.name ?? code}</span>
                    <span className="font-mono text-[10px] text-neutral-400">{stateRaces.length} race{stateRaces.length === 1 ? "" : "s"}</span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{COVERAGE_COPY[strongest]} · {candidateCount} records</p>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

const MATCHUP_BADGE = {
  set: { copy: "Matchup set", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  partial: { copy: "Matchup forming", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  pending: { copy: "Awaiting primary", tone: "border-neutral-200 bg-neutral-50 text-neutral-600" },
} as const;

function RaceCard({ race }: { race: Awaited<ReturnType<typeof getRaceIndex>>[number] }) {
  const matchupBadge = race.matchup === "none" ? null : MATCHUP_BADGE[race.matchup];
  return (
    <Link href={`/race/${race.contestId}`} className="block min-w-0 rounded border border-neutral-200 bg-white p-4 no-underline hover:border-neutral-400">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium text-neutral-900">{race.title}</h3>
        <span className="shrink-0 font-mono text-xs text-neutral-500">{race.activeCandidates}</span>
      </div>
      {race.candidates.length > 0 && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-neutral-600">
          {race.candidates.slice(0, 5).join(" · ")}
          {race.activeCandidates > 5 && ` +${race.activeCandidates - 5} more`}
        </p>
      )}
      <span className="mt-3 flex flex-wrap gap-1.5">
        {matchupBadge && (
          <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium ${matchupBadge.tone}`}>
            {matchupBadge.copy}
          </span>
        )}
        <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium ${COVERAGE_TONE[race.coverage]}`}>
          {COVERAGE_COPY[race.coverage]}
        </span>
      </span>
    </Link>
  );
}
