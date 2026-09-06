import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fmt } from "@/lib/finance";
import {
  getPublishedCampaignResearch,
  getRaceByContestId,
  getCampaignSiteStatus,
  CAMPAIGN_SITE_STATUS_NOTE,
  type PublishedCandidateResearch,
} from "@/lib/elections/queries";
import { deriveMatchup, type Matchup } from "@/lib/elections/matchup";
import { CAMPAIGN_CLAIM_LABEL, CAMPAIGN_CLAIM_ORDER } from "@/lib/elections/campaign-research";
import { CandidateName } from "@/components/candidate-name";
import { PartyMark } from "@/components/party-mark";
import AskClient from "@/components/ask-client";
import { getMembersByState, getStateByCode } from "@/lib/queries";

type Props = { params: Promise<{ contestId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { contestId } = await params;
  const race = await getRaceByContestId(contestId);
  if (!race) return { title: "Race Not Found" };
  return {
    title: race.title,
    description: `Current 2026 candidate field for ${race.title}, with source and verification status.`,
    alternates: { canonical: `/race/${contestId}` },
  };
}

export default async function RacePage({ params }: Props) {
  const contestId = (await params).contestId;
  const [race, research, siteStatus] = await Promise.all([
    getRaceByContestId(contestId),
    getPublishedCampaignResearch(contestId),
    getCampaignSiteStatus(contestId),
  ]);
  if (!race) notFound();
  const [stateInfo, stateMembers] = await Promise.all([
    getStateByCode(race.stateCode),
    getMembersByState(race.stateCode),
  ]);
  const stateName = stateInfo?.name ?? race.stateCode;
  const active = race.candidates.filter((candidate) => candidate.isActive);
  const inactive = race.candidates.filter((candidate) => !candidate.isActive);
  const partyIsPreference = race.stateCode === "WA";
  const matchup = deriveMatchup(race.stateCode, race.coverage, race.candidates);
  const raceIncumbent = active.find((candidate) => candidate.isIncumbent) ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <nav className="font-mono text-xs text-neutral-400">
        <Link href="/races" className="no-underline hover:text-neutral-800">Races</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/races?state=${race.stateCode}`} className="no-underline hover:text-neutral-800">{race.stateCode}</Link>
      </nav>
      <h1 className="mt-6 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{race.title}</h1>
      <div className="mt-4 rounded border border-neutral-200 bg-stone-50 p-4 text-sm text-neutral-600">
        <p className="font-medium text-neutral-900">
          {race.coverage === "verified_ballot"
            ? "State-verified ballot"
            : race.coverage === "verification_pending"
              ? "State records available; final verification pending"
              : "FEC filers only"}
        </p>
        <p className="mt-1 leading-relaxed">
          {race.coverage === "fec_only"
            ? "These people filed federal campaign-finance paperwork. That does not prove ballot access or that they remain in the race."
            : "The current field comes from the state election authority. Any unofficial primary result remains labeled unofficial, and an incomplete state list is not presented as final."}
        </p>
        {partyIsPreference && (
          <p className="mt-2 leading-relaxed">
            Washington uses a top-two primary. Party labels below are each
            candidate&apos;s preference, not a party nomination.
          </p>
        )}
        <a href={race.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-medium text-neutral-800 underline decoration-neutral-300 underline-offset-2">
          {race.sourceName}
        </a>
      </div>

      {/* Scoped records assistant — kept above the fold, same surface the
          state page embeds. */}
      <section className="mt-4 rounded-lg border border-neutral-200 bg-stone-50 p-5">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-serif text-lg font-semibold">Ask about this race</h2>
          <p className="text-sm text-neutral-500">
            {race.coverage === "fec_only"
              ? `Answers come from FEC filings and this site's ${stateName} records, and cite what was checked.`
              : `Answers come from official ${stateName} records and cite what was checked.`}
          </p>
        </div>
        <AskClient
          scope={{ type: "state", stateCode: race.stateCode }}
          initialLocated={{
            stateCode: race.stateCode,
            stateName,
            district: null,
            matchedAddress: null,
            members: stateMembers.map((m) => ({
              bioguideId: m.bioguideId,
              fullName: m.fullName,
              party: m.party,
              chamber: m.chamber,
              district: m.district,
              photoUrl: m.photoUrl,
            })),
          }}
          exampleQuestions={[
            `Who is running in the ${race.title} race?`,
            raceIncumbent
              ? `How did ${raceIncumbent.name} vote recently?`
              : `Which ${stateName} seats are up in 2026?`,
            `How much have candidates in the ${race.title} race raised?`,
          ]}
        />
      </section>

      {!(matchup.status === "no_basis" && race.coverage === "fec_only") && (
        <MatchupBlock matchup={matchup} sourceName={race.sourceName} sourceUrl={race.sourceUrl} />
      )}

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-xl font-semibold">Current field</h2>
          <span className="font-mono text-xs text-neutral-400">{active.length} candidates</span>
        </div>
        {active.length > 0 ? (
          <CandidateList
            candidates={active}
            research={research}
            siteStatus={siteStatus}
            partyIsPreference={partyIsPreference}
            raceHasIncumbent={raceIncumbent != null}
          />
        ) : (
          <p className="mt-3 text-sm text-neutral-500">No current candidate records are loaded. This is not evidence that nobody is running.</p>
        )}
      </section>

      {inactive.length > 0 && race.coverage !== "fec_only" && (
        <section className="mt-10">
          <h2 className="font-serif text-xl font-semibold">Earlier or withdrawn candidates</h2>
          <p className="mt-1 text-xs text-neutral-500">Historical records remain visible; status events are append-only.</p>
          <CandidateList
            candidates={inactive}
            research={research}
            siteStatus={siteStatus}
            partyIsPreference={partyIsPreference}
            raceHasIncumbent={false}
          />
        </section>
      )}
    </div>
  );
}

const MATCHUP_TONE: Record<Matchup["status"], string> = {
  set_certified: "border-emerald-200 bg-emerald-50",
  set_unofficial: "border-emerald-200 bg-emerald-50",
  set_state_list: "border-neutral-200 bg-stone-50",
  partial: "border-amber-200 bg-amber-50",
  pending_primary: "border-neutral-200 bg-stone-50",
  pending_runoff: "border-amber-200 bg-amber-50",
  no_basis: "border-neutral-200 bg-stone-50",
};

const MATCHUP_HEADING: Record<Matchup["status"], string> = {
  set_certified: "November matchup set",
  set_unofficial: "November matchup set (unofficial)",
  set_state_list: "November matchup (state list)",
  partial: "November matchup forming",
  pending_primary: "November matchup not yet formed",
  pending_runoff: "November matchup waiting on a runoff",
  no_basis: "November matchup unknown",
};

function MatchupBlock({
  matchup,
  sourceName,
  sourceUrl,
}: {
  matchup: Matchup;
  sourceName: string;
  sourceUrl: string;
}) {
  const ballotLanes = matchup.lanes.filter((lane) => !lane.isWriteIn);
  const writeIns = matchup.lanes.filter((lane) => lane.isWriteIn);
  return (
    <section className={`mt-4 rounded border p-4 ${MATCHUP_TONE[matchup.status]}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {MATCHUP_HEADING[matchup.status]}
      </p>
      {ballotLanes.length > 0 && (
        <p className="mt-2 text-sm font-medium leading-relaxed text-neutral-900">
          {ballotLanes.map((lane, index) => (
            <span key={lane.candidacyId}>
              {index > 0 && <span className="mx-1.5 font-normal text-neutral-400">vs</span>}
              <CandidateName
                name={lane.name}
                bioguideId={lane.bioguideId}
                personId={lane.personId}
                fecCandidateId={lane.fecCandidateId}
              />
              <span className="ml-1 font-normal text-neutral-500">({lane.partyLabel})</span>
            </span>
          ))}
        </p>
      )}
      {writeIns.length > 0 && (
        <p className="mt-1 text-xs text-neutral-500">
          Qualified write-ins:{" "}
          {writeIns.map((lane, index) => (
            <span key={lane.candidacyId}>
              {index > 0 && ", "}
              <CandidateName
                name={lane.name}
                bioguideId={lane.bioguideId}
                personId={lane.personId}
                fecCandidateId={lane.fecCandidateId}
              />
            </span>
          ))}
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-neutral-600">{matchup.statusLabel}</p>
      <p className="mt-1 text-xs text-neutral-500">
        Basis:{" "}
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-300 underline-offset-2">
          {sourceName}
        </a>
        {matchup.nextEvent && ` · next event ${matchup.nextEvent}`}
      </p>
    </section>
  );
}

// Published text is always the source's own words. The extractor's paraphrase
// is never rendered, which is what keeps a page honest without a reviewer.
function QuoteGroup({
  heading,
  quotes,
}: {
  heading: string;
  quotes: PublishedCandidateResearch["claims"];
}) {
  return (
    <div>
      <p className="font-medium text-neutral-800">{heading}</p>
      <ul className="mt-1.5 space-y-1.5">
        {quotes.map((claim) => (
          <li key={claim.claimId} className="border-l-2 border-neutral-200 pl-2.5">
            <span className="italic leading-relaxed text-neutral-700">
              &ldquo;{claim.sourceQuote}&rdquo;
            </span>{" "}
            <a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer" className="not-italic text-neutral-500 underline decoration-neutral-300 underline-offset-2">
              source
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CandidateList({
  candidates,
  research,
  siteStatus,
  partyIsPreference,
  raceHasIncumbent,
}: {
  candidates: NonNullable<Awaited<ReturnType<typeof getRaceByContestId>>>["candidates"];
  research: Map<string, PublishedCandidateResearch>;
  siteStatus: Awaited<ReturnType<typeof getCampaignSiteStatus>>;
  partyIsPreference: boolean;
  // Challenger is a relative label: it renders only when the field actually
  // contains the seat's sitting member, never on open seats.
  raceHasIncumbent: boolean;
}) {
  return (
    <ul className="mt-3 divide-y divide-neutral-100 rounded border border-neutral-200 bg-white">
      {candidates.map((candidate) => {
        const candidateResearch = research.get(candidate.candidacyId);
        const biographyClaims =
          candidateResearch?.claims.filter((claim) => claim.claimType === "biography") ?? [];
        const campaignClaims =
          candidateResearch?.claims.filter((claim) => claim.claimType !== "biography") ?? [];
        return (
        <li key={candidate.candidacyId} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <PartyMark party={candidate.party} size="md" />
              <div className="min-w-0">
              <p className="font-medium text-neutral-900">
                <CandidateName
                  name={candidate.name}
                  bioguideId={candidate.bioguideId}
                  personId={candidate.personId}
                  fecCandidateId={candidate.fecCandidateId}
                />
                {candidate.isActive && candidate.isIncumbent && (
                  <span className="ml-2 inline-block rounded-sm bg-neutral-900 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-white">
                    Incumbent
                  </span>
                )}
                {candidate.isActive && !candidate.isIncumbent && raceHasIncumbent && (
                  <span className="ml-2 inline-block rounded-sm border border-neutral-300 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                    Challenger
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                {candidate.party
                  ? `${candidate.party}${partyIsPreference ? " preference" : ""}`
                  : "No party listed"} · {candidate.status.replaceAll("_", " ")}
              </p>
              {candidate.ballotLines.length > 1 && (
                <p className="mt-1 text-xs text-neutral-500">Ballot lines: {candidate.ballotLines.join(", ")}</p>
              )}
              {candidateResearch && (
                <p className="mt-1 text-xs">
                  <a href={candidateResearch.siteUrl} target="_blank" rel="noopener noreferrer" className="text-neutral-700 underline decoration-neutral-300 underline-offset-2">
                    Campaign site
                  </a>
                  <span className="text-neutral-400"> · linked through an FEC committee filing</span>
                </p>
              )}
              </div>
            </div>
            <div className="shrink-0 text-right font-mono text-xs text-neutral-500">
              {candidate.primaryVotes != null && <p>{candidate.primaryVotes.toLocaleString()} primary votes</p>}
              {candidate.totalReceipts != null && <p>{fmt(candidate.totalReceipts)} raised</p>}
            </div>
          </div>
          {candidate.resultStatus === "unofficial" && (
            <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-amber-700">Unofficial result</p>
          )}
          {candidateResearch && (candidateResearch.claims.length > 0 || candidateResearch.priorService.length > 0) && (
            <div className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
              {biographyClaims.length > 0 && (
                <QuoteGroup
                  heading="Biography, in the campaign's words"
                  quotes={biographyClaims}
                />
              )}
              {candidateResearch.priorService.length > 0 && (
                <div className={biographyClaims.length > 0 ? "mt-3" : ""}>
                  <p className="font-medium text-neutral-800">Prior service stated by the campaign</p>
                  <ul className="mt-1.5 space-y-1.5">
                    {candidateResearch.priorService.map((service) => (
                      <li key={service.serviceId}>
                        {service.officeInQuote && (
                          <span className="text-neutral-800">
                            {service.officeTitle}
                            {service.jurisdictionInQuote ? `, ${service.jurisdiction}` : ""}
                          </span>
                        )}
                        <span className={service.officeInQuote ? "ml-1.5 text-neutral-400" : "text-neutral-400"}>
                          &ldquo;{service.sourceQuote}&rdquo;
                        </span>{" "}
                        <a href={service.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-neutral-500 underline decoration-neutral-300 underline-offset-2">
                          source
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {CAMPAIGN_CLAIM_ORDER.map((claimType) => {
                const group = campaignClaims.filter((claim) => claim.claimType === claimType);
                if (group.length === 0) return null;
                return (
                  <div key={claimType} className="mt-3">
                    <QuoteGroup
                      heading={`${CAMPAIGN_CLAIM_LABEL[claimType]}, in the campaign's words`}
                      quotes={group}
                    />
                  </div>
                );
              })}
              <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
                Quoted verbatim from the candidate&apos;s own campaign site, which
                is linked to them through an FEC committee filing. Passages are
                selected automatically; the wording is the campaign&apos;s, and it
                is a self-description rather than an independent account.
              </p>
            </div>
          )}
          {!candidateResearch && siteStatus.get(candidate.candidacyId) && (
            <p className="mt-3 border-t border-neutral-100 pt-3 text-[11px] text-neutral-400">
              {CAMPAIGN_SITE_STATUS_NOTE[siteStatus.get(candidate.candidacyId)!]}
            </p>
          )}
        </li>
        );
      })}
    </ul>
  );
}

// No build-time prerender: pages generate on first request, then serve
// from the ISR cache for the site-wide revalidate window.
export function generateStaticParams() {
  return [];
}
