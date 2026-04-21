export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  getAllStatesWithCounts,
  getLatestSync,
  getTotalMemberCount,
} from "@/lib/queries";
import { PartyBar } from "@/components/party-bar";

export default async function Home() {
  const [statesData, latestSync, totalMembers] = await Promise.all([
    getAllStatesWithCounts(),
    getLatestSync(),
    getTotalMemberCount(),
  ]);

  // Split out territories from states for display
  const territories = new Set(["DC", "AS", "GU", "MP", "PR", "VI"]);
  const fiftyStates = statesData.filter((s) => !territories.has(s.code));
  const territoryList = statesData.filter((s) => territories.has(s.code));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Headline */}
      <div className="mb-10">
        <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">
          538 members. 50 delegations.
        </h1>
        <p className="mt-3 max-w-lg text-neutral-500">
          Congressional accountability tracking, organized by state delegation.
          Legislation, committees, and campaign finance — sourced from official
          government records.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-neutral-400">
          <span>
            {totalMembers} members tracked
          </span>
          <span className="text-neutral-200 dark:text-neutral-700">|</span>
          <span>3 data sources</span>
          {latestSync?.completedAt && (
            <>
              <span className="text-neutral-200 dark:text-neutral-700">|</span>
              <span>
                Updated{" "}
                {new Date(latestSync.completedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 50 States Grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {fiftyStates.map((state) => (
          <Link
            key={state.code}
            href={`/state/${state.code}`}
            className="group flex items-center justify-between rounded px-3 py-2.5 no-underline transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {state.code}
                </span>
                <span className="font-mono text-[10px] text-neutral-300 dark:text-neutral-600">
                  {state.memberCount}
                </span>
              </div>
              <p className="truncate text-xs text-neutral-400">
                {state.name}
              </p>
            </div>
            <div className="ml-3 w-12">
              <PartyBar
                democrat={state.parties.democrat}
                republican={state.parties.republican}
                independent={state.parties.independent}
                height={3}
              />
            </div>
          </Link>
        ))}
      </div>

      {/* Territories */}
      {territoryList.length > 0 && (
        <div className="mt-8 border-t border-neutral-100 pt-6 dark:border-neutral-800">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Territories & DC
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {territoryList.map((t) => (
              <Link
                key={t.code}
                href={`/state/${t.code}`}
                className="font-mono text-xs text-neutral-500 no-underline hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                {t.code}
                <span className="ml-1 text-neutral-300 dark:text-neutral-600">
                  {t.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
