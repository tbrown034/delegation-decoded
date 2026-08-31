export const dynamic = "force-dynamic";

import Link from "next/link";
import type { Metadata } from "next";
import {
  getAllStatesWithCounts,
  getLatestSync,
  getTotalMemberCount,
  getRecentEvents,
  getSyncSummary,
  getChamberComposition,
} from "@/lib/queries";
import { PartyBar } from "@/components/party-bar";
import { StateMap } from "@/components/state-map";
import { CongressViews } from "@/components/congress-views";
import AskClient from "@/components/ask-client";

export const metadata: Metadata = {
  title: "Delegation Decoded",
  description:
    "A state-by-state reporting guide to Congress and the 2026 midterms, built from official records.",
  alternates: { canonical: "/" },
};

function formatFreshnessAge(completedAt: string | null, nowMs: number): string {
  if (!completedAt) return "—";
  const dateMs = new Date(completedAt).getTime();
  const ageHours = Math.floor((nowMs - dateMs) / (1000 * 60 * 60));
  if (ageHours < 1) return "< 1 hour ago";
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${Math.floor(ageHours / 24)}d ago`;
}

function isFresh(completedAt: string | null, nowMs: number): boolean {
  if (!completedAt) return false;
  const dateMs = new Date(completedAt).getTime();
  return Math.floor((nowMs - dateMs) / (1000 * 60 * 60)) < 48;
}

function getCurrentTimeMs(): number {
  return Date.now();
}

export default async function Home() {
  const [statesData, latestSync, totalMembers, recentEvents, syncSummary, composition] = await Promise.all([
    getAllStatesWithCounts(),
    getLatestSync(),
    getTotalMemberCount(),
    getRecentEvents(8),
    getSyncSummary(),
    getChamberComposition(),
  ]);

  // Trades and press releases are intentionally quiet surfaces now — their
  // pipelines still run, but the homepage leads with the near-complete
  // official-API data (members, votes, bills, money, committees).
  const quietEntities = new Set(["press_releases", "disclosures", "ptr", "audit"]);
  const visibleSummary = syncSummary.filter(
    (s) => !quietEntities.has(s.entity_type)
  );

  // Split out territories from states for display
  const territories = new Set(["DC", "AS", "GU", "MP", "PR", "VI"]);
  const fiftyStates = statesData.filter((s) => !territories.has(s.code));
  const territoryList = statesData.filter((s) => territories.has(s.code));
  const nowMs = getCurrentTimeMs();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Headline */}
      <div className="mb-10">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-neutral-400">
          A public-records guide to Congress and the 2026 midterms
        </p>
        <h1 className="text-balance font-serif text-4xl font-semibold tracking-tight sm:text-5xl">
          Your congressional delegation, decoded for the midterms and beyond.
        </h1>
        <p className="mt-3 max-w-lg text-neutral-500">
          Find your lawmakers, examine their votes, bills and campaign money,
          and see who has filed to run — all from official records.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-neutral-400">
          <span>
            {totalMembers} members tracked
          </span>
          <span className="text-neutral-200">|</span>
          <span>{new Set(visibleSummary.map((s) => s.source)).size} data sources</span>
          {latestSync?.completedAt && (
            <>
              <span className="text-neutral-200">|</span>
              <span>
                Updated{" "}
                {new Date(latestSync.completedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "America/New_York",
                })}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Ask is the site's front door: the question box sits in the hero,
          and the old navigation cards demote to a quiet link row. */}
      <div className="mb-4 -mt-4">
        <AskClient />
      </div>

      <div className="mb-12 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Link
          href="/find"
          className="text-neutral-500 no-underline hover:text-neutral-900"
        >
          Find my delegation →
        </Link>
        <a
          href="#states"
          className="text-neutral-500 no-underline hover:text-neutral-900"
        >
          Explore a state →
        </a>
        <Link
          href="/for-journalists"
          className="text-neutral-500 no-underline hover:text-neutral-900"
        >
          Report with the data →
        </Link>
      </div>

      {/* Congress at a glance: state cartogram / House / Senate seat charts */}
      <div id="states" className="mb-10 scroll-mt-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Congress at a glance
          </h2>
          <Link
            href="/find"
            className="text-xs text-neutral-500 no-underline hover:text-neutral-900"
          >
            Find yours by address →
          </Link>
        </div>
        <CongressViews
          house={composition.house}
          senate={composition.senate}
          statesView={
            <>
              <StateMap states={fiftyStates} />
              <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-neutral-400">
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm bg-blue-600" />
                  Strong D
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm bg-blue-400" />
                  Lean D
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm bg-purple-400" />
                  Split
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm bg-red-400" />
                  Lean R
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm bg-red-600" />
                  Strong R
                </span>
              </div>
            </>
          }
        />
      </div>

      {/* All States List */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {fiftyStates.map((state) => (
          <Link
            key={state.code}
            href={`/state/${state.code}`}
            className="group flex items-center justify-between rounded px-3 py-2.5 no-underline transition-colors hover:bg-neutral-50"
          >
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-sm font-medium text-neutral-900">
                  {state.code}
                </span>
                <span className="font-mono text-[10px] text-neutral-300">
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
        <div className="mt-10 border-t border-neutral-100 pt-8">
          <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Recent activity across all delegations
          </h2>
          <div className="grid gap-x-6 sm:grid-cols-2">
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
                  // min-w-0: grid children default to min-width auto, so one
                  // long bill title otherwise widens the column past the
                  // viewport on phones and truncate never engages.
                  className="flex min-w-0 items-start gap-2 border-b border-neutral-100 py-2"
                >
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${icon}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-neutral-600">
                      {e.stateCode && (
                        <Link
                          href={`/state/${e.stateCode}`}
                          className="mr-1 font-mono font-medium text-neutral-900 no-underline hover:text-neutral-500"
                        >
                          {e.stateCode}
                        </Link>
                      )}
                      {e.title}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-neutral-300">
                    {e.eventDate}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <HomeFreshnessAndTerritories syncSummary={visibleSummary} territoryList={territoryList} nowMs={nowMs} />
    </div>
  );
}

function HomeFreshnessAndTerritories({
  syncSummary,
  territoryList,
  nowMs,
}: {
  syncSummary: Awaited<ReturnType<typeof getSyncSummary>>;
  territoryList: Awaited<ReturnType<typeof getAllStatesWithCounts>>;
  nowMs: number;
}) {
  return (
    <>
      {/* Data Freshness */}
      {syncSummary.length > 0 && (
        <div className="mt-10 border-t border-neutral-100 pt-8">
          <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Data sources & freshness
          </h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 md:grid-cols-4">
            {syncSummary.map((s) => {
              const sourceLabels: Record<string, string> = {
                unitedstates: "@unitedstates",
                congress_gov: "Congress.gov",
                fec: "FEC",
                house_senate_xml: "House/Senate XML",
                rss: "RSS Feeds",
                senate_efd: "Senate eFD",
                "disclosures-clerk.house.gov": "House Clerk PTRs",
              };
              const entityLabels: Record<string, string> = {
                members: "Members",
                committees: "Committees",
                bills: "Bills",
                campaign_finance: "Finance",
                votes: "Votes",
                press_releases: "Press Releases",
                disclosures: "Senate PTRs",
                ptr: "House PTRs",
              };
              const label =
                entityLabels[s.entity_type] || s.entity_type;
              const source =
                sourceLabels[s.source] || s.source;
              const ageLabel = formatFreshnessAge(s.completed_at, nowMs);
              const fresh = isFresh(s.completed_at, nowMs);

              return (
                <div
                  key={`${s.source}-${s.entity_type}`}
                  className="flex items-start gap-2"
                >
                  <span
                    className={`mt-1 size-1.5 shrink-0 rounded-full ${
                      fresh
                        ? "bg-emerald-500"
                        : "bg-amber-400"
                    }`}
                  />
                  <div>
                    <p className="text-xs font-medium text-neutral-700">
                      {label}
                    </p>
                    <p className="font-mono text-[10px] text-neutral-400">
                      {(s.records_count || 0).toLocaleString()}{" "}
                      {(s.records_count || 0) === 1 ? "record" : "records"}
                      {" / "}
                      {ageLabel}
                    </p>
                    <p className="text-[10px] text-neutral-300">
                      {source}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Territories */}
      {territoryList.length > 0 && (
        <div className="mt-8 border-t border-neutral-100 pt-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
            Territories & DC
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {territoryList.map((t) => (
              <Link
                key={t.code}
                href={`/state/${t.code}`}
                className="font-mono text-xs text-neutral-500 no-underline hover:text-neutral-900"
              >
                {t.code}
                <span className="ml-1 text-neutral-300">
                  {t.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
