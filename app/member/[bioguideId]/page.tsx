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
  getMemberCoverage,
  getMemberCoverageDetail,
  getMemberActivityData,
  getPublishedMemberBiography,
} from "@/lib/queries";
import { getMemberSeatRaces } from "@/lib/elections/queries";
import { resolveMemberSeat } from "@/lib/elections/member-seat";
import { MemberCoverageCard } from "@/components/member-coverage-card";
import { CollapsibleList } from "@/components/collapsible-list";
import { STATE_BY_CODE, houseSeatTitle } from "@/lib/states";
import { breadcrumbName } from "@/lib/member-names";
import { effectiveTotal, fmt } from "@/lib/finance";
import { MemberCoverageBar } from "@/components/data-coverage";
import { buildActivityTimeline } from "@/lib/press-analytics";
import AskClient from "@/components/ask-client";
import { JsonLd, SITE_URL } from "@/components/json-ld";
import { FACT_TYPE_LABEL, FACT_TYPE_ORDER } from "@/lib/biography-classify";

type Props = {
  params: Promise<{ bioguideId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { bioguideId } = await params;
  const member = await getMemberByBioguideId(bioguideId);
  if (!member) return { title: "Member Not Found" };
  const stateName = STATE_BY_CODE[member.stateCode]?.name || member.stateCode;
  return {
    title: `${member.fullName}, ${stateName}`,
    description: `${member.fullName}, ${member.party} ${member.chamber === "senate" ? "Senator" : houseSeatTitle(member.stateCode)} from ${stateName}. Committees, legislation, and campaign finance.`,
    alternates: { canonical: `/member/${member.bioguideId}` },
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

  const memberTerms = await getMemberTerms(bioguideId);
  const memberSeat = resolveMemberSeat(member, memberTerms);
  const [memberCommittees, memberBills, billCounts, finance, contributors, voteSummary, recentVotes, coverage, coverageDetail, activityData, memberRaces, biography] =
    await Promise.all([
      getMemberCommittees(bioguideId),
      getMemberBills(bioguideId, 20),
      getMemberBillCount(bioguideId),
      getMemberFinance(bioguideId),
      getMemberTopContributors(bioguideId),
      getMemberVoteSummary(bioguideId),
      getMemberRecentVotes(bioguideId, 15),
      getMemberCoverage(bioguideId),
      getMemberCoverageDetail(bioguideId),
      getMemberActivityData(bioguideId),
      memberSeat ? getMemberSeatRaces(member.stateCode, memberSeat) : Promise.resolve([]),
      getPublishedMemberBiography(bioguideId),
    ]);

  const stateName = STATE_BY_CODE[member.stateCode]?.name || member.stateCode;
  const chamber =
    member.chamber === "senate"
      ? "Senator"
      : houseSeatTitle(member.stateCode);
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

  const loadedMemberRaces = memberRaces.filter(
    (race) => race.hasData && race.candidates.length > 0
  );

  // Delegates and Resident Commissioners are not Representatives, so the
  // "United States" prefix only applies to the two voting titles.
  const jobTitle =
    member.chamber === "senate"
      ? "United States Senator"
      : chamber === "Representative"
        ? "United States Representative"
        : chamber;

  const sameAs = [
    member.websiteUrl,
    member.twitter ? `https://twitter.com/${member.twitter}` : null,
  ].filter((url): url is string => Boolean(url));

  const personLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: member.fullName,
    jobTitle,
    url: `${SITE_URL}/member/${member.bioguideId}`,
    image: `${SITE_URL}/api/photo/${member.bioguideId}`,
    affiliation: {
      "@type": "GovernmentOrganization",
      name: `${stateName} Congressional Delegation`,
      url: `${SITE_URL}/state/${member.stateCode}`,
    },
  };
  if (sameAs.length > 0) personLd.sameAs = sameAs;
  if (topCommittees.length > 0) {
    personLd.memberOf = topCommittees.map((c) => ({
      "@type": "GovernmentOrganization",
      name: c.name,
      url: `${SITE_URL}/committee/${c.committeeId}`,
    }));
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <JsonLd data={personLd} />
      {/* Breadcrumb */}
      <nav className="mb-8 font-mono text-xs text-neutral-400">
        <Link
          href="/"
          className="no-underline hover:text-neutral-700"
        >
          States
        </Link>
        <span className="mx-1.5">/</span>
        <Link
          href={`/state/${member.stateCode}`}
          className="no-underline hover:text-neutral-700"
        >
          {stateName}
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-neutral-900">
          {breadcrumbName(member.fullName, member.lastName)}
        </span>
      </nav>

      {/* Header */}
      <div className="mb-10 flex items-start gap-5">
        <div
          className={`relative size-20 shrink-0 overflow-hidden rounded-full ring-2 ${ringClass}`}
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
            <div className="flex h-full items-center justify-center bg-neutral-100 text-lg text-neutral-400">
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
            {district ? `, ${district}` : ""}, {stateName}
          </p>
          {/* Key stats */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-xs text-neutral-400">
            {billCounts.sponsored > 0 && (
              <span>
                <span className="font-medium text-neutral-700">
                  {billCounts.sponsored}
                </span>{" "}
                bills
              </span>
            )}
            {billCounts.cosponsored > 0 && (
              <span>
                <span className="font-medium text-neutral-700">
                  {billCounts.cosponsored}
                </span>{" "}
                cosponsored
              </span>
            )}
            {latestFinance && (
              <span>
                <span className="font-medium text-neutral-700">
                  {fmt(effectiveTotal(latestFinance))}
                </span>{" "}
                raised
              </span>
            )}
            {voteSummary.total > 0 && (
              <span>
                <span className="font-medium text-neutral-700">
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
                className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700"
                target="_blank"
                rel="noopener noreferrer"
              >
                Website
              </a>
            )}
            {member.twitter && (
              <a
                href={`https://twitter.com/${member.twitter}`}
                className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700"
                target="_blank"
                rel="noopener noreferrer"
              >
                @{member.twitter}
              </a>
            )}
            {member.phone && <span>{member.phone}</span>}
          </div>
          <div className="mt-2">
            <MemberCoverageBar coverage={coverage} />
          </div>
        </div>
      </div>

      {/* Ask sits above the biography: chat stays above the fold on every
          page that has it. */}
      <section className="mb-10 rounded-lg border border-neutral-200 bg-stone-50 p-5">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-serif text-lg font-semibold">
            Ask about {member.fullName}
          </h2>
          <p className="text-sm text-neutral-500">
            The lookup is locked to this lawmaker and seat.
          </p>
        </div>
        <AskClient
          scope={{ type: "member", bioguideId: member.bioguideId }}
          initialLocated={{
            stateCode: member.stateCode,
            stateName,
            district: member.chamber === "house" ? member.district : null,
            matchedAddress: null,
            members: [
              {
                bioguideId: member.bioguideId,
                fullName: member.fullName,
                party: member.party,
                chamber: member.chamber,
                district: member.district,
                photoUrl: member.photoUrl,
              },
            ],
          }}
        />
      </section>

      {biography && biography.facts.length > 0 && (
        <section id="biography" className="mb-10 scroll-mt-6 border-l-2 border-neutral-300 pl-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-serif text-lg font-semibold">Official biography</h2>
            <a
              href={biography.biographyUrl ?? biography.siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
            >
              Congressional source
            </a>
          </div>
          <BiographyGroups facts={biography.facts} />
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
            Quoted verbatim from this lawmaker&apos;s official House or Senate
            site. Passages are selected automatically; the wording is the
            office&apos;s own, unedited.
          </p>
        </section>
      )}

      {/* Legislation */}
      {memberBills.length > 0 && (
        <section id="legislation" className="mb-10 scroll-mt-6">
          <h2 className="mb-3 font-serif text-lg font-semibold">Legislation</h2>
          <CollapsibleList initial={8} label="bills">
            {memberBills.map((b) => (
              <div
                key={b.billId}
                className="border-b border-neutral-100 py-2.5 last:border-0"
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
                    <span className="font-mono text-[11px] text-neutral-400">
                      {b.billType.toUpperCase()}&nbsp;{b.billNumber}
                    </span>
                    <span
                      className={`rounded px-1 py-px text-[10px] ${
                        b.role === "sponsor"
                          ? "bg-neutral-900 text-white"
                          : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {b.role}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-900">
                      {b.title}
                    </p>
                    {b.latestActionText && (
                      <p className="mt-0.5 text-[11px] text-neutral-400">
                        {b.latestActionText}
                      </p>
                    )}
                  </div>
                  {b.introducedDate && (
                    <span className="shrink-0 font-mono text-[11px] text-neutral-300">
                      {b.introducedDate}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </CollapsibleList>
        </section>
      )}

      {/* Voting Record */}
      {voteSummary.total > 0 && (
        <section id="votes" className="mb-10 scroll-mt-6">
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
                  className="bg-neutral-300"
                  style={{
                    width: `${(voteSummary.notVoting / voteSummary.total) * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="mt-1.5 flex gap-3 font-mono text-[10px] text-neutral-400">
              <span>
                <span className="mr-0.5 inline-block size-1.5 rounded-full bg-emerald-600" />
                {voteSummary.yea} yea
              </span>
              <span>
                <span className="mr-0.5 inline-block size-1.5 rounded-full bg-rose-600" />
                {voteSummary.nay} nay
              </span>
              {voteSummary.notVoting > 0 && (
                <span>
                  <span className="mr-0.5 inline-block size-1.5 rounded-full bg-neutral-300" />
                  {voteSummary.notVoting} missed
                </span>
              )}
              {voteSummary.present > 0 && (
                <span>{voteSummary.present} present</span>
              )}
            </div>
          </div>
          {/* Recent votes */}
          <CollapsibleList initial={8} label="votes">
            {recentVotes.map((v) => (
              <div
                key={v.voteId}
                className="flex items-center gap-2.5 border-b border-neutral-100 py-2 last:border-0"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    v.position === "yea"
                      ? "bg-emerald-600"
                      : v.position === "nay"
                        ? "bg-rose-600"
                        : "bg-neutral-300"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-neutral-900">
                    {v.description || v.question}
                  </p>
                  <p className="text-[11px] text-neutral-400">
                    {v.result} ({v.yeas}-{v.nays})
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] uppercase text-neutral-400">
                  {v.position}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-neutral-300">
                  {v.voteDate}
                </span>
              </div>
            ))}
          </CollapsibleList>
        </section>
      )}

      {/* Statements bridge — press archiving lives at Capitol Releases */}
      {member.chamber === "senate" && (
        <section className="mb-10">
          <div className="rounded border border-neutral-200 bg-stone-50 px-4 py-3 text-sm text-neutral-600">
            Official statements and press releases from {member.fullName} are
            archived, searchable, and updated daily at{" "}
            <a
              href="https://capitolreleases.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-800"
            >
              Capitol Releases
            </a>
            , a companion project.
          </div>
        </section>
      )}

      {/* Exact district or Senate-class contests only. Special and regular
          elections render separately when both exist for one physical seat. */}
      {loadedMemberRaces.map((race) => {
        const raceFilers = race.candidates;
        return (
        <section key={race.contestId} className="mb-10">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-lg font-semibold">
              {race.electionType === "special" ? "The 2026 special election" : "The 2026 race"}
              {race.senateClass ? ` · Class ${race.senateClass}` : ""}
            </h2>
            <Link href={`/race/${race.contestId}`} className="text-xs text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900">
              Full race
            </Link>
          </div>
          <p className="mb-3 text-xs text-neutral-500">
            {race.coverage === "verified_ballot"
              ? "Candidates verified against the state election authority's current ballot records."
              : race.coverage === "verification_pending"
                ? "Current candidates reconstructed from state election-authority records. Certification or a complete final ballot list is still pending."
                : "FEC Form 2 filers for this seat. Filing is not ballot access, and this list does not establish who remains in the race."}
          </p>
          <ul className="divide-y divide-neutral-100 rounded border border-neutral-200 bg-white">
            {raceFilers.slice(0, 8).map((c) => (
              <li
                key={c.candidate_id}
                className="flex items-baseline justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium text-neutral-900">
                    {c.name}
                  </span>
                  <span className="ml-2 text-xs text-neutral-500">
                    {c.party
                      ? c.party
                          .replace(" PARTY", "")
                          .toLowerCase()
                          .replace(/^\w/, (ch) => ch.toUpperCase())
                      : "No party listed"}
                    {c.incumbent_challenge === "I" &&
                      c.candidate_id !== member.fecCandidateId && (
                        <span className="ml-1 text-amber-700">
                          · filed as incumbent
                        </span>
                      )}
                    {c.candidate_id === member.fecCandidateId && (
                      <span className="ml-1">· this member</span>
                    )}
                    {race.coverage !== "fec_only" && c.status && (
                      <span className="ml-1">· {c.status.replaceAll("_", " ")}</span>
                    )}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-xs text-neutral-500">
                  {c.total_receipts ? `${fmt(c.total_receipts)} raised` : "—"}
                </span>
              </li>
            ))}
          </ul>
          {raceFilers.length > 8 && (
            <p className="mt-2 text-xs text-neutral-400">
              Plus {raceFilers.length - 8} more filer
              {raceFilers.length - 8 === 1 ? "" : "s"} with smaller totals.
            </p>
          )}
          <p className="mt-2 text-[11px] text-neutral-400">
            Source: {race.sourceName}. {race.coverage === "fec_only" ? "FEC filing fallback" : "State-authority record"}. Synced daily.
          </p>
        </section>
        );
      })}

      {/* Campaign Finance */}
      {finance.length > 0 && (
        <section id="finance" className="mb-10 scroll-mt-6">
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
                  className="border-b border-neutral-100 pb-4 last:border-0"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-xs text-neutral-400">
                      {f.electionCycle} cycle
                    </span>
                    <span className="font-mono text-lg font-semibold text-neutral-900">
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
                          <span className="mr-0.5 inline-block size-1.5 rounded-full bg-emerald-600" />
                          Small donors {fmt(smallAmt)}
                        </span>
                        <span>
                          <span className="mr-0.5 inline-block size-1.5 rounded-full bg-blue-500" />
                          Large individual {fmt(largeAmt)}
                        </span>
                        <span>
                          <span className="mr-0.5 inline-block size-1.5 rounded-full bg-amber-500" />
                          PACs {fmt(pacAmt)}
                        </span>
                      </div>
                    </>
                  )}

                  <div className="mt-2 flex gap-6 font-mono text-[11px]">
                    <span className="text-neutral-400">
                      Spent{" "}
                      <span className="text-neutral-600">
                        {fmt(f.totalDisbursements)}
                      </span>
                    </span>
                    <span className="text-neutral-400">
                      Cash{" "}
                      <span className="text-neutral-600">
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
        <section id="contributors" className="mb-10 scroll-mt-6">
          <h2 className="mb-3 font-serif text-lg font-semibold">
            Top Contributors
          </h2>
          <div>
            {contributors.map((c) => (
              <div
                key={`${c.contributorName}-${c.totalAmount}`}
                className="flex items-baseline justify-between border-b border-neutral-100 py-1.5 last:border-0"
              >
                <span className="truncate text-sm text-neutral-700">
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
        <section id="committees" className="mb-10 scroll-mt-6">
          <h2 className="mb-3 font-serif text-lg font-semibold">Committees</h2>
          <div className="space-y-3">
            {topCommittees.map((c) => {
              const subs = subCommittees.filter((s) =>
                s.committeeId.startsWith(c.committeeId)
              );
              return (
                <div
                  key={c.committeeId}
                  className="border-b border-neutral-100 pb-3 last:border-0"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-neutral-900">
                      {c.name}
                    </p>
                    {c.role && c.role !== "member" && (
                      <span className="font-mono text-[10px] uppercase text-amber-700">
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

      {/* Activity Timeline */}
      {(() => {
        const timeline = buildActivityTimeline(
          [],
          activityData.bills,
          activityData.votes
        ).slice(0, 30);

        if (timeline.length === 0) return null;

        const typeColor: Record<string, string> = {
          press: "bg-sky-500",
          bill: "bg-blue-600",
          vote: "bg-emerald-600",
        };
        const typeLabel: Record<string, string> = {
          press: "statement",
          bill: "legislation",
          vote: "vote",
        };

        return (
          <section className="mb-10">
            <h2 className="mb-3 font-serif text-lg font-semibold">
              Activity Timeline
            </h2>
            <div className="mb-2 flex gap-3 text-[10px] text-neutral-400">
              <span className="flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full bg-blue-600" />
                Legislation
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block size-1.5 rounded-full bg-emerald-600" />
                Votes
              </span>
            </div>
            <CollapsibleList initial={8} label="entries">
              {timeline.map((item, i) => (
                <div
                  key={`${item.type}-${item.date}-${i}`}
                  className="flex items-start gap-2.5 border-b border-neutral-100 py-2 last:border-0"
                >
                  <span
                    className={`mt-1.5 size-1.5 shrink-0 rounded-full ${typeColor[item.type]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-700">
                      {item.relatedUrl ? (
                        <a
                          href={item.relatedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-neutral-700 underline decoration-neutral-200 underline-offset-2 hover:decoration-neutral-400"
                        >
                          {item.title}
                        </a>
                      ) : (
                        item.title
                      )}
                    </p>
                    {item.position && (
                      <span
                        className={`mt-0.5 inline-block font-mono text-[10px] uppercase ${
                          item.position === "yea"
                            ? "text-emerald-600"
                            : item.position === "nay"
                              ? "text-rose-600"
                              : "text-neutral-400"
                        }`}
                      >
                        {item.position}
                      </span>
                    )}
                    {item.detail && !item.position && (
                      <span className="mt-0.5 inline-block text-[10px] text-neutral-400">
                        {item.detail}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-mono text-[10px] text-neutral-300">
                      {item.date}
                    </span>
                    <p className="font-mono text-[9px] uppercase text-neutral-300">
                      {typeLabel[item.type]}
                    </p>
                  </div>
                </div>
              ))}
            </CollapsibleList>
          </section>
        );
      })()}

      {/* Service History */}
      <section id="terms" className="scroll-mt-6">
        <h2 className="mb-3 font-serif text-lg font-semibold">
          Service History
        </h2>
        <CollapsibleList initial={8} label="terms">
          {memberTerms.map((t) => (
            <div
              key={`${t.chamber}-${t.startDate}-${t.endDate ?? "present"}-${t.district ?? "statewide"}`}
              className="flex items-center gap-3 border-b border-neutral-100 py-2 text-sm last:border-0"
            >
              <span
                className={`size-1.5 rounded-full ${
                  t.isCurrent
                    ? "bg-green-600"
                    : "bg-neutral-200"
                }`}
              />
              <span className="text-neutral-900">
                {t.chamber === "senate" ? "Senate" : "House"}
                {t.district ? `, Dist. ${t.district}` : ""}
              </span>
              <span className="font-mono text-xs text-neutral-400">
                {t.startDate}, {t.endDate || "present"}
              </span>
              <span className="text-xs text-neutral-300">
                {t.party}
              </span>
            </div>
          ))}
        </CollapsibleList>
      </section>

      <MemberCoverageCard items={coverageDetail} />
    </div>
  );
}

// Official-biography facts, grouped by what kind of fact they are. Ungrouped
// facts keep a neutral heading rather than being dropped or forced into a
// category the classifier could not justify.
function BiographyGroups({
  facts,
}: {
  facts: NonNullable<Awaited<ReturnType<typeof getPublishedMemberBiography>>>["facts"];
}) {
  const grouped = new Map<string, typeof facts>();
  for (const fact of facts) {
    const key = fact.factType ?? "other";
    grouped.set(key, [...(grouped.get(key) ?? []), fact]);
  }
  const ordered: Array<[string, typeof facts]> = [];
  for (const type of FACT_TYPE_ORDER) {
    const group = grouped.get(type);
    if (group?.length) ordered.push([FACT_TYPE_LABEL[type], group]);
  }
  const other = grouped.get("other");
  if (other?.length) ordered.push(["Also stated", other]);

  return (
    <div className="mt-3 space-y-3">
      {ordered.map(([label, group]) => (
        <div key={label}>
          <p className="font-mono text-[11px] uppercase tracking-wide text-neutral-400">
            {label}
          </p>
          <ul className="mt-1 space-y-1.5 text-sm leading-relaxed text-neutral-700">
            {group.map((fact) => (
              <li key={fact.claimId}>
                <span className="italic">&ldquo;{fact.sourceQuote}&rdquo;</span>{" "}
                <a
                  href={fact.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-neutral-400 underline decoration-neutral-300 underline-offset-2"
                >
                  source
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// No build-time prerender: pages generate on first request, then serve
// from the ISR cache for the site-wide revalidate window.
export function generateStaticParams() {
  return [];
}
