import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fmt } from "@/lib/finance";
import {
  getPublishedCampaignResearch,
  getRaceByContestId,
  type PublishedCandidateResearch,
} from "@/lib/elections/queries";

type Props = { params: Promise<{ contestId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const race = await getRaceByContestId((await params).contestId);
  if (!race) return { title: "Race Not Found" };
  return {
    title: race.title,
    description: `Current 2026 candidate field for ${race.title}, with source and verification status.`,
  };
}

export default async function RacePage({ params }: Props) {
  const contestId = (await params).contestId;
  const [race, research] = await Promise.all([
    getRaceByContestId(contestId),
    getPublishedCampaignResearch(contestId),
  ]);
  if (!race) notFound();
  const active = race.candidates.filter((candidate) => candidate.isActive);
  const inactive = race.candidates.filter((candidate) => !candidate.isActive);
  const partyIsPreference = race.stateCode === "WA";

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

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-serif text-xl font-semibold">Current field</h2>
          <span className="font-mono text-xs text-neutral-400">{active.length} candidates</span>
        </div>
        {active.length > 0 ? (
          <CandidateList
            candidates={active}
            research={research}
            partyIsPreference={partyIsPreference}
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
            partyIsPreference={partyIsPreference}
          />
        </section>
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  research,
  partyIsPreference,
}: {
  candidates: NonNullable<Awaited<ReturnType<typeof getRaceByContestId>>>["candidates"];
  research: Map<string, PublishedCandidateResearch>;
  partyIsPreference: boolean;
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
            <div className="min-w-0">
              <p className="font-medium text-neutral-900">{candidate.name}</p>
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
                <div>
                  <p className="font-medium text-neutral-800">Biography from the campaign site</p>
                  <ul className="mt-1 space-y-1.5">
                    {biographyClaims.map((claim) => (
                      <li key={claim.claimId}>
                        {claim.claimText}{" "}
                        <a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-neutral-500 underline decoration-neutral-300 underline-offset-2">
                          Source
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-neutral-400">Campaign description, not an independent characterization.</p>
                </div>
              )}
              {candidateResearch.priorService.length > 0 && (
                <div className={biographyClaims.length > 0 ? "mt-3" : ""}>
                  <p className="font-medium text-neutral-800">Prior service stated by the campaign</p>
                  <ul className="mt-1 space-y-1">
                    {candidateResearch.priorService.map((service) => (
                      <li key={service.serviceId}>
                        <a href={service.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-300 underline-offset-2">
                          {service.officeTitle}{service.jurisdiction ? `, ${service.jurisdiction}` : ""}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-neutral-400">The source and quote were reviewed; the underlying claim is not independently characterized.</p>
                </div>
              )}
              {campaignClaims.length > 0 && (
                <div className={candidateResearch.priorService.length > 0 || biographyClaims.length > 0 ? "mt-3" : ""}>
                  <p className="font-medium text-neutral-800">Reviewed campaign-site statements</p>
                  <ul className="mt-1 space-y-1.5">
                    {campaignClaims.map((claim) => (
                      <li key={claim.claimId}>
                        {claim.claimText}{" "}
                        <a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-neutral-500 underline decoration-neutral-300 underline-offset-2">
                          Source
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </li>
        );
      })}
    </ul>
  );
}
