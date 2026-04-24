import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import {
  getMemberByBioguideId,
  getMemberTerms,
  getMemberCommittees,
  getMemberBills,
  getMemberBillCount,
  getMemberFinance,
  getMemberTopContributors,
  getMemberVoteSummary,
  getMemberRecentVotes,
  getMemberPressReleases,
  getMemberPressReleaseCount,
} from "@/lib/queries";
import { STATE_BY_CODE } from "@/lib/states";
import { effectiveTotal, fmt } from "@/lib/finance";

type Props = {
  params: Promise<{ bioguideId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { bioguideId } = await params;
  const member = await getMemberByBioguideId(bioguideId);
  if (!member) return { title: "Member Not Found" };
  const stateName = STATE_BY_CODE[member.stateCode]?.name || member.stateCode;
  return {
    title: `${member.fullName} — ${stateName}`,
    description: `${member.fullName}, ${member.party} ${member.chamber === "senate" ? "Senator" : "Representative"} from ${stateName}. Committees, legislation, and campaign finance.`,
  };
}

const partyRing: Record<string, string> = {
  Democrat: "ring-blue-600",
  Republican: "ring-red-600",
  Independent: "ring-purple-500",
};

export default async function MemberPage({ params }: Props) {
  const { bioguideId } = await params;
  const member = await getMemberByBioguideId(bioguideId);
  if (!member) notFound();

  const [memberTerms, memberCommittees, memberBills, billCounts, finance, contributors, voteSummary, recentVotes, memberPressReleases, pressReleaseCount] =
    await Promise.all([
      getMemberTerms(bioguideId),
      getMemberCommittees(bioguideId),
      getMemberBills(bioguideId, 20),
      getMemberBillCount(bioguideId),
      getMemberFinance(bioguideId),
      getMemberTopContributors(bioguideId),
      getMemberVoteSummary(bioguideId),
      getMemberRecentVotes(bioguideId, 15),
      getMemberPressReleases(bioguideId, 10),
      getMemberPressReleaseCount(bioguideId),
    ]);

  const stateName = STATE_BY_CODE[member.stateCode]?.name || member.stateCode;
  const chamber = member.chamber === "senate" ? "Senator" : "Representative";
  const district =
    member.chamber === "house"
      ? member.district
        ? `District ${member.district}`
        : "At-Large"
      : null;

  const ringClass = partyRing[member.party] || "ring-neutral-300";
  const topCommittees = memberCommittees.filter((c) => !c.parentId);
  const subCommittees = memberCommittees.filter((c) => c.parentId);
  const latestFinance = finance[0] || null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-8 font-mono text-xs text-neutral-400">
        <Link
          href="/"
          className="no-underline hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          States
        </Link>
        <span className="mx-1.5">/</span>
        <Link
          href={`/state/${member.stateCode}`}
          className="no-underline hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          {stateName}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-neutral-900 dark:text-neutral-100">
          {member.lastName}
        </span>
      </nav>

      {/* Header */}
      <div className="mb-10 flex items-start gap-5">
        <div
          className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-full ring-2 ${ringClass}`}
        >
          {member.photoUrl ? (
            <Image
              src={member.photoUrl}
              alt=""
              fill
              sizes="80px"
              className="object-cover"
              priority
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-neutral-100 text-lg text-neutral-400 dark:bg-neutral-800">
              ?
            </div>
          )}
        </div>
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
            {member.fullName}
          </h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {member.party} {chamber}
            {district ? `, ${district}` : ""} — {stateName}
          </p>
          {/* Key stats */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-xs text-neutral-400">
            {billCounts.sponsored > 0 && (
              <span>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {billCounts.sponsored}
                </span>{" "}
                bills
              </span>
            )}
            {billCounts.cosponsored > 0 && (
              <span>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {billCounts.cosponsored}
                </span>{" "}
                cosponsored
              </span>
            )}
            {latestFinance && (
              <span>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {fmt(effectiveTotal(latestFinance))}
                </span>{" "}
                raised
              </span>
            )}
            {voteSummary.total > 0 && (
              <span>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {voteSummary.total}
                </span>{" "}
                votes recorded
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-neutral-400">
            {member.websiteUrl && (
              <a
                href={member.websiteUrl}
                className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700 dark:decoration-neutral-600 dark:hover:text-neutral-300"
                target="_blank"
                rel="noopener noreferrer"
              >
                Website
              </a>
            )}
            {member.twitter && (
              <a
                href={`https://twitter.com/${member.twitter}`}
                className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700 dark:decoration-neutral-600 dark:hover:text-neutral-300"
                target="_blank"
                rel="noopener noreferrer"
              >
                @{member.twitter}
              </a>
            )}
            {member.phone && <span>{member.phone}</span>}
          </div>
        </div>
      </div>

      {/* Legislation */}
      {memberBills.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-serif text-lg font-semibold">Legislation</h2>
          <div>
            {memberBills.map((b) => (
              <div
                key={b.billId}
                className="border-b border-neutral-100 py-2.5 last:border-0 dark:border-neutral-800"
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
                    <span className="font-mono text-[11px] text-neutral-400">
                      {b.billType.toUpperCase()}&nbsp;{b.billNumber}
                    </span>
                    <span
                      className={`rounded px-1 py-px text-[10px] ${
                        b.role === "sponsor"
                          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                      }`}
                    >
                      {b.role}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-900 dark:text-neutral-100">
                      {b.title}
                    </p>
                    {b.latestActionText && (
                      <p className="mt-0.5 text-[11px] text-neutral-400">
                        {b.latestActionText}
                      </p>
                    )}
                  </div>
                  {b.introducedDate && (
                    <span className="shrink-0 font-mono text-[11px] text-neutral-300 dark:text-neutral-600">
                      {b.introducedDate}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Voting Record */}
      {voteSummary.total > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-serif text-lg font-semibold">
            Voting Record
          </h2>
          {/* Summary bar */}
          <div className="mb-4">
            <div className="flex h-3 w-full overflow-hidden rounded-sm">
              {voteSummary.yea > 0 && (
                <div
                  className="bg-emerald-600"
                  style={{
                    width: `${(voteSummary.yea / voteSummary.total) * 100}%`,
                  }}
                />
              )}
              {voteSummary.nay > 0 && (
                <div
                  className="bg-rose-600"
                  style={{
                    width: `${(voteSummary.nay / voteSummary.total) * 100}%`,
                  }}
                />
              )}
              {voteSummary.notVoting > 0 && (
                <div
                  className="bg-neutral-300 dark:bg-neutral-600"
                  style={{
                    width: `${(voteSummary.notVoting / voteSummary.total) * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="mt-1.5 flex gap-3 font-mono text-[10px] text-neutral-400">
              <span>
                <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" />
                {voteSummary.yea} yea
              </span>
              <span>
                <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-rose-600" />
                {voteSummary.nay} nay
              </span>
              {voteSummary.notVoting > 0 && (
                <span>
                  <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-neutral-300 dark:bg-neutral-600" />
                  {voteSummary.notVoting} missed
                </span>
              )}
              {voteSummary.present > 0 && (
                <span>{voteSummary.present} present</span>
              )}
            </div>
          </div>
          {/* Recent votes */}
          <div>
            {recentVotes.map((v) => (
              <div
                key={v.voteId}
                className="flex items-center gap-2.5 border-b border-neutral-100 py-2 last:border-0 dark:border-neutral-800"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    v.position === "yea"
                      ? "bg-emerald-600"
                      : v.position === "nay"
                        ? "bg-rose-600"
                        : "bg-neutral-300 dark:bg-neutral-600"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-neutral-900 dark:text-neutral-100">
                    {v.description || v.question}
                  </p>
                  <p className="text-[11px] text-neutral-400">
                    {v.result} ({v.yeas}-{v.nays})
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] uppercase text-neutral-400">
                  {v.position}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-neutral-300 dark:text-neutral-600">
                  {v.voteDate}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Press Releases */}
      {memberPressReleases.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-serif text-lg font-semibold">
            Press Releases
            {pressReleaseCount > 0 && (
              <span className="ml-2 font-mono text-xs font-normal text-neutral-400">
                {pressReleaseCount} total
              </span>
            )}
          </h2>
          <div>
            {memberPressReleases.map((pr) => (
              <div
                key={pr.id}
                className="border-b border-neutral-100 py-2 last:border-0 dark:border-neutral-800"
              >
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500 dark:text-neutral-100 dark:decoration-neutral-600"
                >
                  {pr.title}
                </a>
                {pr.publishedAt && (
                  <span className="ml-2 font-mono text-[11px] text-neutral-300 dark:text-neutral-600">
                    {new Date(pr.publishedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Campaign Finance */}
      {finance.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-serif text-lg font-semibold">
            Campaign Finance
          </h2>
          <div className="space-y-4">
            {finance.map((f) => {
              const total = effectiveTotal(f);
              const indAmt = f.totalIndividual || 0;
              const pacAmt = f.totalPac || 0;
              const smallAmt = f.smallIndividual || 0;
              const largeAmt = Math.max(0, indAmt - smallAmt);

              const smallPct = total > 0 ? (smallAmt / total) * 100 : 0;
              const largePct = total > 0 ? (largeAmt / total) * 100 : 0;
              const pacPct = total > 0 ? (pacAmt / total) * 100 : 0;

              return (
                <div
                  key={f.electionCycle}
                  className="border-b border-neutral-100 pb-4 last:border-0 dark:border-neutral-800"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-xs text-neutral-400">
                      {f.electionCycle} cycle
                    </span>
                    <span className="font-mono text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                      {fmt(total)}
                    </span>
                  </div>

                  {total > 0 && (
                    <>
                      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-sm">
                        <div
                          className="bg-emerald-600"
                          style={{ width: `${smallPct}%` }}
                        />
                        <div
                          className="bg-blue-500"
                          style={{ width: `${largePct}%` }}
                        />
                        <div
                          className="bg-amber-500"
                          style={{ width: `${pacPct}%` }}
                        />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] text-neutral-400">
                        <span>
                          <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-600" />
                          Small donors {fmt(smallAmt)}
                        </span>
                        <span>
                          <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
                          Large individual {fmt(largeAmt)}
                        </span>
                        <span>
                          <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                          PACs {fmt(pacAmt)}
                        </span>
                      </div>
                    </>
                  )}

                  <div className="mt-2 flex gap-6 font-mono text-[11px]">
                    <span className="text-neutral-400">
                      Spent{" "}
                      <span className="text-neutral-600 dark:text-neutral-300">
                        {fmt(f.totalDisbursements)}
                      </span>
                    </span>
                    <span className="text-neutral-400">
                      Cash{" "}
                      <span className="text-neutral-600 dark:text-neutral-300">
                        {fmt(f.cashOnHand)}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Top Contributors */}
      {contributors.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-serif text-lg font-semibold">
            Top Contributors
          </h2>
          <div>
            {contributors.map((c, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between border-b border-neutral-100 py-1.5 last:border-0 dark:border-neutral-800"
              >
                <span className="truncate text-sm text-neutral-700 dark:text-neutral-300">
                  {c.contributorName}
                </span>
                <span className="ml-3 shrink-0 font-mono text-xs text-neutral-400">
                  {fmt(c.totalAmount)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Committees */}
      {topCommittees.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-serif text-lg font-semibold">Committees</h2>
          <div className="space-y-3">
            {topCommittees.map((c) => {
              const subs = subCommittees.filter((s) =>
                s.committeeId.startsWith(c.committeeId)
              );
              return (
                <div
                  key={c.committeeId}
                  className="border-b border-neutral-100 pb-3 last:border-0 dark:border-neutral-800"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {c.name}
                    </p>
                    {c.role && c.role !== "member" && (
                      <span className="font-mono text-[10px] uppercase text-amber-700 dark:text-amber-400">
                        {c.role.replace("_", " ")}
                      </span>
                    )}
                  </div>
                  {subs.length > 0 && (
                    <ul className="mt-1 space-y-0 text-xs text-neutral-400">
                      {subs.map((s) => (
                        <li key={s.committeeId}>{s.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Service History */}
      <section>
        <h2 className="mb-3 font-serif text-lg font-semibold">
          Service History
        </h2>
        <div>
          {memberTerms.map((t, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-neutral-100 py-2 text-sm last:border-0 dark:border-neutral-800"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  t.isCurrent
                    ? "bg-green-600"
                    : "bg-neutral-200 dark:bg-neutral-700"
                }`}
              />
              <span className="text-neutral-900 dark:text-neutral-100">
                {t.chamber === "senate" ? "Senate" : "House"}
                {t.district ? `, Dist. ${t.district}` : ""}
              </span>
              <span className="font-mono text-xs text-neutral-400">
                {t.startDate} — {t.endDate || "present"}
              </span>
              <span className="text-xs text-neutral-300 dark:text-neutral-600">
                {t.party}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
