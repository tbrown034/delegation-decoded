import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  getStateByCode,
  getMembersByState,
  getStateCommitteeCoverage,
  getRecentStateBills,
  getStateDelegationFinance,
  getStateEvents,
  getStateBrief,
  getStateCoverage,
} from "@/lib/queries";
import { MemberCard } from "@/components/member-card";
import { PartyBar } from "@/components/party-bar";
import { StateCoverageNote } from "@/components/data-coverage";
import { effectiveTotal, fmt } from "@/lib/finance";
import { houseSeatTitlePlural, isNonVotingJurisdiction } from "@/lib/states";
import AskClient from "@/components/ask-client";
import { getStateRaceIndex } from "@/lib/elections/queries";

type Props = {
  params: Promise<{ code: string }>;
};

const PARTY_DOT: Record<string, string> = {
  Democrat: "bg-blue-600",
  Republican: "bg-red-600",
  Independent: "bg-purple-500",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const state = await getStateByCode(code);
  if (!state) return { title: "State Not Found" };
  return {
    title: `${state.name} Delegation`,
    description: `${state.name}'s congressional delegation — senators, representatives, committees, legislation, and campaign finance.`,
    alternates: { canonical: `/state/${state.code}` },
  };
}

export default async function StatePage({ params }: Props) {
  const { code } = await params;
  const state = await getStateByCode(code);
  if (!state) notFound();

  const [membersList, committeeCoverage, recentBills, financeData, stateEvents, brief, coverageStats, stateRaces] =
    await Promise.all([
      getMembersByState(code),
      getStateCommitteeCoverage(code),
      getRecentStateBills(code, 10),
      getStateDelegationFinance(code),
      getStateEvents(code, 12),
      getStateBrief(code),
      getStateCoverage(code),
      getStateRaceIndex(code),
    ]);

  const senators = membersList.filter((m) => m.chamber === "senate");
  const reps = membersList.filter((m) => m.chamber === "house");

  const parties = {
    democrat: membersList.filter((m) => m.party === "Democrat").length,
    republican: membersList.filter((m) => m.party === "Republican").length,
    independent: membersList.filter(
      (m) => m.party !== "Democrat" && m.party !== "Republican"
    ).length,
  };

  // Committee coverage grouped
  const committeeMap = new Map<
    string,
    { name: string; chamber: string; members: typeof committeeCoverage }
  >();
  for (const row of committeeCoverage) {
    if (!committeeMap.has(row.committeeId)) {
      committeeMap.set(row.committeeId, {
        name: row.committeeName,
        chamber: row.committeeChamber,
        members: [],
      });
    }
    committeeMap.get(row.committeeId)!.members.push(row);
  }

  // Finance: most recent cycle per member
  const financeByMember = new Map<string, (typeof financeData)[0]>();
  for (const f of financeData) {
    const existing = financeByMember.get(f.bioguideId);
    if (!existing || (f.electionCycle || 0) > (existing.electionCycle || 0)) {
      financeByMember.set(f.bioguideId, f);
    }
  }
  const financeList = Array.from(financeByMember.values()).sort(
    (a, b) => effectiveTotal(b) - effectiveTotal(a)
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-8 font-mono text-xs text-neutral-400">
        <Link
          href="/"
          className="no-underline hover:text-neutral-700"
        >
          All States
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-neutral-900">
          {state.name}
        </span>
      </nav>

      {/* Header */}
      <div className="mb-10">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          {state.name}
        </h1>
        <div className="mt-2 flex items-center gap-4 text-sm text-neutral-500">
          {/* DC and the territories have no senators, so the "0 senators" half
              is noise there; their one seat is a Delegate or Resident
              Commissioner, never a Representative. */}
          {!isNonVotingJurisdiction(state.code) && (
            <>
              <span>
                {senators.length} senator{senators.length !== 1 ? "s" : ""}
              </span>
              <span className="text-neutral-200">/</span>
            </>
          )}
          <span>
            {reps.length}{" "}
            {houseSeatTitlePlural(state.code, reps.length).toLowerCase()}
          </span>
        </div>
        <div className="mt-3 max-w-[200px]">
          <PartyBar
            democrat={parties.democrat}
            republican={parties.republican}
            independent={parties.independent}
            showLabels
          />
        </div>
      </div>

      {/* Delegation Brief */}
      {brief && (
        <div className="mb-10 border-l-2 border-neutral-200 pl-4">
          <p className="text-sm leading-relaxed text-neutral-600">
            {brief.summary}
          </p>
          <p className="mt-2 font-mono text-[10px] text-neutral-300">
            Generated{" "}
            {new Date(brief.generatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            {" / "}
            {brief.periodStart} – {brief.periodEnd}
          </p>
        </div>
      )}

      {/* Two-column layout: delegation + sidebar */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {/* Scoped records assistant leads the page so it stays above the fold. */}
          <section className="mb-10 rounded-lg border border-neutral-200 bg-stone-50 p-5">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-serif text-lg font-semibold">
                Ask about {state.name}
              </h2>
              <p className="text-sm text-neutral-500">
                Answers stay inside this delegation and cite the records checked.
              </p>
            </div>
            <AskClient
              scope={{ type: "state", stateCode: state.code }}
              initialLocated={{
                stateCode: state.code,
                stateName: state.name,
                district: null,
                matchedAddress: null,
                members: membersList.map((m) => ({
                  bioguideId: m.bioguideId,
                  fullName: m.fullName,
                  party: m.party,
                  chamber: m.chamber,
                  district: m.district,
                  photoUrl: m.photoUrl,
                })),
              }}
            />
          </section>

          {/* Senators */}
          {senators.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
                Senators
              </h2>
              <div>
                {senators.map((m) => (
                  <MemberCard
                    key={m.bioguideId}
                    bioguideId={m.bioguideId}
                    fullName={m.fullName}
                    party={m.party}
                    chamber={m.chamber}
                    district={m.district}
                    photoUrl={m.photoUrl}
                    stateCode={m.stateCode}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Representatives */}
          {reps.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
                {houseSeatTitlePlural(state.code, reps.length)}
              </h2>
              <div>
                {reps.map((m) => (
                  <MemberCard
                    key={m.bioguideId}
                    bioguideId={m.bioguideId}
                    fullName={m.fullName}
                    party={m.party}
                    chamber={m.chamber}
                    district={m.district}
                    photoUrl={m.photoUrl}
                    stateCode={m.stateCode}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="mb-10">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">2026 races</h2>
              <Link href={`/races?state=${state.code}`} className="text-xs text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900">
                All {state.name} races
              </Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {stateRaces.slice(0, 12).map((race) => (
                <Link key={race.contestId} href={`/race/${race.contestId}`} className="min-w-0 rounded border border-neutral-200 bg-white p-3 no-underline hover:border-neutral-400">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-neutral-900">{race.title.replace(`${state.name} `, "")}</span>
                    <span className="shrink-0 font-mono text-xs text-neutral-400">
                      {race.matchup === "set" ? "matchup set" : race.matchup === "partial" ? "forming" : race.activeCandidates}
                    </span>
                  </div>
                  <p className={`mt-1 text-[11px] ${race.coverage === "verification_pending" ? "text-amber-700" : race.coverage === "verified_ballot" ? "text-emerald-700" : "text-neutral-500"}`}>
                    {race.coverage === "verified_ballot" ? "State-verified ballot" : race.coverage === "verification_pending" ? "State records; verification pending" : "FEC filers only"}
                  </p>
                  {race.candidates.length > 0 && (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-neutral-600">
                      {race.candidates.slice(0, 5).join(" · ")}
                      {race.activeCandidates > 5 && ` +${race.activeCandidates - 5} more`}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </section>

          {/* Activity Feed */}
          {stateEvents.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                Recent activity
              </h2>
              <div>
                {stateEvents.map((e) => {
                  const icon =
                    e.eventType === "bill_introduced"
                      ? "bg-blue-600"
                      : e.eventType === "vote_cast"
                        ? "bg-emerald-600"
                        : "bg-neutral-400";
                  return (
                    <div
                      key={e.id}
                      className="flex items-start gap-2.5 border-b border-neutral-100 py-2 last:border-0"
                    >
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${icon}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-neutral-700">
                          {e.title}
                        </p>
                        {e.description && (
                          <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                            {e.description}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-neutral-300">
                        {e.eventDate}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Recent Legislation */}
          {recentBills.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                Recent legislation
              </h2>
              <div className="space-y-0">
                {recentBills.map((b) => (
                  <div
                    key={b.billId}
                    className="border-b border-neutral-100 py-2.5 last:border-0"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 font-mono text-[11px] text-neutral-400">
                        {b.billType.toUpperCase()}&nbsp;{b.billNumber}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-neutral-900">
                          {b.title}
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-400">
                          <span
                            className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${PARTY_DOT[b.sponsorParty] || "bg-neutral-400"}`}
                          />
                          {b.sponsorName}
                          {b.introducedDate && (
                            <span className="ml-2 font-mono">
                              {b.introducedDate}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <StateSidebar senatorNames={senators.map((s) => s.fullName)} financeList={financeList} committeeMap={committeeMap} coverageStats={coverageStats} />
      </div>
    </div>
  );
}

function StateSidebar({
  senatorNames,
  financeList,
  committeeMap,
  coverageStats,
}: {
  senatorNames: string[];
  financeList: Awaited<ReturnType<typeof getStateDelegationFinance>>;
  committeeMap: Map<string, { name: string; members: Awaited<ReturnType<typeof getStateCommitteeCoverage>> }>;
  coverageStats: Awaited<ReturnType<typeof getStateCoverage>>;
}) {
  return (
    <>
        {/* Sidebar */}
        <div className="space-y-8">
          {/* Statements bridge — press archiving lives at Capitol Releases */}
          {senatorNames.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                Statements & releases
              </h2>
              <p className="text-xs leading-relaxed text-neutral-500">
                Official statements from {senatorNames.join(" and ")} are
                archived and searchable at{" "}
                <a
                  href="https://capitolreleases.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-600"
                >
                  Capitol Releases
                </a>
                , a companion project.
              </p>
            </section>
          )}

          {/* Campaign Finance */}
          {financeList.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                Fundraising
              </h2>
              <div className="space-y-0">
                {financeList.map((f) => {
                  const raised = effectiveTotal(f);
                  const maxRaised = effectiveTotal(financeList[0]) || 1;
                  const pct = (raised / maxRaised) * 100;
                  const barColor =
                    f.party === "Democrat"
                      ? "bg-blue-600"
                      : f.party === "Republican"
                        ? "bg-red-600"
                        : "bg-purple-500";

                  return (
                    <Link
                      key={f.bioguideId}
                      href={`/member/${f.bioguideId}`}
                      className="group block border-b border-neutral-100 py-2 no-underline last:border-0"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="truncate text-xs text-neutral-600 group-hover:text-neutral-900">
                          {f.fullName}
                        </span>
                        <span className="ml-2 shrink-0 font-mono text-xs font-medium text-neutral-900">
                          {fmt(raised)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-neutral-100">
                        <div
                          className={`h-full rounded-sm ${barColor}`}
                          style={{ width: `${Math.max(pct, 3)}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* Committee Coverage */}
          {committeeMap.size > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                Committee seats
              </h2>
              <div className="space-y-3">
                {Array.from(committeeMap.entries())
                  .slice(0, 12)
                  .map(([id, { name, members: cms }]) => (
                    <div key={id}>
                      <p className="text-xs font-medium text-neutral-700">
                        {name}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                        {cms.map((cm) => (
                          // inline-flex + min-h-6 lifts these from 16px to the
                          // 24px WCAG 2.2 target minimum without changing the
                          // type size or wrapping behaviour.
                          <Link
                            key={cm.bioguideId}
                            href={`/member/${cm.bioguideId}`}
                            className="inline-flex min-h-6 items-center text-[11px] text-neutral-400 no-underline hover:text-neutral-700"
                          >
                            <span
                              className={`mr-0.5 inline-block h-1 w-1 rounded-full ${PARTY_DOT[cm.memberParty] || "bg-neutral-400"}`}
                            />
                            {cm.memberName.split(" ").pop()}
                            {cm.role !== "member" && (
                              <span className="ml-0.5 text-neutral-300">
                                ({cm.role?.replace("_", " ")})
                              </span>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                {committeeMap.size > 12 && (
                  <p className="text-[11px] text-neutral-400">
                    + {committeeMap.size - 12} more committees
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Data Coverage */}
          {coverageStats && (
            <StateCoverageNote
              totalMembers={coverageStats.totalMembers}
              membersWithFinance={coverageStats.membersWithFinance}
            />
          )}

          {/* Bulk data for reporters */}
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
              For journalists
            </h2>
            <p className="text-xs leading-relaxed text-neutral-500">
              Every dataset behind this page is available as a bulk CSV
              download, with freshness timestamps and reporting tips, on the{" "}
              <Link
                href="/for-journalists"
                className="font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-600"
              >
                For Journalists
              </Link>{" "}
              page.
            </p>
          </section>
        </div>
    </>
  );
}
