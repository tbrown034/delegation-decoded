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
} from "@/lib/queries";
import { MemberCard } from "@/components/member-card";
import { PartyBar } from "@/components/party-bar";

type Props = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const state = await getStateByCode(code);
  if (!state) return { title: "State Not Found" };
  return {
    title: `${state.name} Delegation`,
    description: `${state.name}'s congressional delegation — senators, representatives, committees, legislation, and campaign finance.`,
  };
}

function fmt(amount: number | null): string {
  if (!amount) return "$0";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

export default async function StatePage({ params }: Props) {
  const { code } = await params;
  const state = await getStateByCode(code);
  if (!state) notFound();

  const [membersList, committeeCoverage, recentBills, financeData, stateEvents] =
    await Promise.all([
      getMembersByState(code),
      getStateCommitteeCoverage(code),
      getRecentStateBills(code, 10),
      getStateDelegationFinance(code),
      getStateEvents(code, 12),
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
    (a, b) => (b.totalReceipts || 0) - (a.totalReceipts || 0)
  );

  const partyDot: Record<string, string> = {
    Democrat: "bg-blue-600",
    Republican: "bg-red-600",
    Independent: "bg-purple-500",
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-8 font-mono text-xs text-neutral-400">
        <Link
          href="/"
          className="no-underline hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          All States
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-neutral-900 dark:text-neutral-100">
          {state.name}
        </span>
      </nav>

      {/* Header */}
      <div className="mb-10">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          {state.name}
        </h1>
        <div className="mt-2 flex items-center gap-4 text-sm text-neutral-500">
          <span>
            {senators.length} senator{senators.length !== 1 ? "s" : ""}
          </span>
          <span className="text-neutral-200 dark:text-neutral-700">/</span>
          <span>
            {reps.length} representative{reps.length !== 1 ? "s" : ""}
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

      {/* Two-column layout: delegation + sidebar */}
      <div className="grid gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
                Representatives
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
                      className="flex items-start gap-2.5 border-b border-neutral-100 py-2 last:border-0 dark:border-neutral-800"
                    >
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${icon}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-neutral-700 dark:text-neutral-300">
                          {e.title}
                        </p>
                        {e.description && (
                          <p className="mt-0.5 truncate text-[11px] text-neutral-400">
                            {e.description}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-neutral-300 dark:text-neutral-600">
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
                    className="border-b border-neutral-100 py-2.5 last:border-0 dark:border-neutral-800"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 font-mono text-[11px] text-neutral-400">
                        {b.billType.toUpperCase()}&nbsp;{b.billNumber}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-neutral-900 dark:text-neutral-100">
                          {b.title}
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-400">
                          <span
                            className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${partyDot[b.sponsorParty] || "bg-neutral-400"}`}
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

        {/* Sidebar */}
        <div className="space-y-8">
          {/* Campaign Finance */}
          {financeList.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                Fundraising
              </h2>
              <div className="space-y-0">
                {financeList.map((f) => {
                  const maxRaised = financeList[0]?.totalReceipts || 1;
                  const pct = ((f.totalReceipts || 0) / maxRaised) * 100;
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
                      className="group block border-b border-neutral-100 py-2 no-underline last:border-0 dark:border-neutral-800"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="truncate text-xs text-neutral-600 group-hover:text-neutral-900 dark:text-neutral-400">
                          {f.fullName}
                        </span>
                        <span className="ml-2 shrink-0 font-mono text-xs font-medium text-neutral-900 dark:text-neutral-100">
                          {fmt(f.totalReceipts)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-sm bg-neutral-100 dark:bg-neutral-800">
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
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                        {name}
                      </p>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0">
                        {cms.map((cm) => (
                          <Link
                            key={cm.bioguideId}
                            href={`/member/${cm.bioguideId}`}
                            className="text-[11px] text-neutral-400 no-underline hover:text-neutral-700 dark:hover:text-neutral-300"
                          >
                            <span
                              className={`mr-0.5 inline-block h-1 w-1 rounded-full ${partyDot[cm.memberParty] || "bg-neutral-400"}`}
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
        </div>
      </div>
    </div>
  );
}
