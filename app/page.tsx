export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  getAllStatesWithCounts,
  getLatestSync,
  getTotalMemberCount,
  getRecentEvents,
} from "@/lib/queries";
import { PartyBar } from "@/components/party-bar";
import { StateMap } from "@/components/state-map";

export default async function Home() {
  const [statesData, latestSync, totalMembers, recentEvents] = await Promise.all([
    getAllStatesWithCounts(),
    getLatestSync(),
    getTotalMemberCount(),
    getRecentEvents(8),
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

      {/* Geographic Map */}
      <div className="mb-10">
        <StateMap states={fiftyStates} />
        <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-neutral-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-blue-600" />
            Strong D
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-blue-400" />
            Lean D
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-purple-400" />
            Split
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-red-400" />
            Lean R
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-red-600" />
            Strong R
          </span>
        </div>
      </div>

      {/* All States List */}
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

      {/* Recent Activity */}
      {recentEvents.length > 0 && (
        <div className="mt-10 border-t border-neutral-100 pt-8 dark:border-neutral-800">
          <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Recent activity across all delegations
          </h2>
          <div className="grid gap-0 sm:grid-cols-2">
            {recentEvents.map((e) => {
              const icon =
                e.eventType === "bill_introduced"
                  ? "bg-blue-600"
                  : e.eventType === "vote_cast"
                    ? "bg-emerald-600"
                    : "bg-neutral-400";
              return (
                <div
                  key={e.id}
                  className="flex items-start gap-2 border-b border-neutral-100 py-2 dark:border-neutral-800"
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${icon}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-neutral-600 dark:text-neutral-400">
                      {e.stateCode && (
                        <Link
                          href={`/state/${e.stateCode}`}
                          className="mr-1 font-mono font-medium text-neutral-900 no-underline hover:text-neutral-500 dark:text-neutral-100"
                        >
                          {e.stateCode}
                        </Link>
                      )}
                      {e.title}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-neutral-300 dark:text-neutral-600">
                    {e.eventDate}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
