import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { fmt } from "@/lib/finance";
import { PartyMark, partyDisplayName } from "@/components/party-mark";
import {
  getCandidateProfile,
  getFecCandidateProfile,
  type CandidateProfile,
  type FecCandidateProfile,
} from "@/lib/elections/queries";
import { STATE_BY_CODE } from "@/lib/states";
import { CAMPAIGN_CLAIM_LABEL, CAMPAIGN_CLAIM_ORDER } from "@/lib/elections/campaign-research";

type Props = { params: Promise<{ contestPersonId: string }> };

const FEC_PREFIX = "fec-";

async function load(rawId: string) {
  const id = decodeURIComponent(rawId);
  if (id.startsWith(FEC_PREFIX)) {
    const fec = await getFecCandidateProfile(id.slice(FEC_PREFIX.length));
    return fec ? ({ kind: "fec", fec } as const) : null;
  }
  const profile = await getCandidateProfile(id);
  return profile ? ({ kind: "person", profile } as const) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { contestPersonId } = await params;
  const loaded = await load(contestPersonId);
  if (!loaded) return { title: "Candidate Not Found" };
  const name = loaded.kind === "fec" ? loaded.fec.name : loaded.profile.name;
  return {
    title: name,
    description: `2026 candidacy records for ${name}, with the source behind every statement.`,
    alternates: { canonical: `/candidate/${contestPersonId}` },
  };
}

export default async function CandidatePage({ params }: Props) {
  const loaded = await load((await params).contestPersonId);
  if (!loaded) notFound();
  if (loaded.kind === "fec") return <FecOnlyProfile candidate={loaded.fec} />;
  // A sitting member's record lives on the member page; do not maintain two.
  if (loaded.profile.bioguideId) redirect(`/member/${loaded.profile.bioguideId}`);
  return <PersonProfile profile={loaded.profile} />;
}

function PersonProfile({ profile }: { profile: CandidateProfile }) {
  const current = profile.candidacies.find((candidacy) => candidacy.isActive) ?? profile.candidacies[0];
  const stateName = current ? STATE_BY_CODE[current.stateCode]?.name ?? current.stateCode : null;
  const biographyClaims = profile.claims.filter((claim) => claim.claimType === "biography");
  const positionClaims = profile.claims.filter((claim) => claim.claimType !== "biography");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <nav className="font-mono text-xs text-neutral-400">
        <Link href="/races" className="no-underline hover:text-neutral-800">Races</Link>
        {current && (
          <>
            <span className="mx-1.5">/</span>
            <Link href={`/races?state=${current.stateCode}`} className="no-underline hover:text-neutral-800">
              {current.stateCode}
            </Link>
          </>
        )}
      </nav>

      <div className="mt-6 flex items-start gap-4">
        <PartyMark party={current?.party} size="lg" />
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{profile.name}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {partyDisplayName(current?.party)}
            {stateName ? ` · 2026 candidate in ${stateName}` : ""}
          </p>
        </div>
      </div>

      <p className="mt-4 rounded border border-neutral-200 bg-stone-50 p-3 text-xs leading-relaxed text-neutral-600">
        This is a candidate record, not an officeholder record. It carries no
        voting history because this person does not hold the seat.
      </p>

      <section className="mt-8">
        <h2 className="font-serif text-xl font-semibold">2026 candidacies</h2>
        <ul className="mt-3 divide-y divide-neutral-100 rounded border border-neutral-200 bg-white">
          {profile.candidacies.map((candidacy) => (
            <li key={candidacy.candidacyId} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`/race/${candidacy.contestId}`} className="font-medium text-neutral-900 no-underline hover:underline">
                    {candidacy.contestTitle}
                  </Link>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {partyDisplayName(candidacy.party)} · {candidacy.status.replaceAll("_", " ")}
                    {!candidacy.isActive && " · no longer active"}
                  </p>
                </div>
                {candidacy.totalReceipts != null && (
                  <span className="shrink-0 font-mono text-xs text-neutral-500">
                    {fmt(candidacy.totalReceipts)} raised
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-neutral-500">
                Ballot status from{" "}
                <a href={candidacy.authorityUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-300 underline-offset-2">
                  {candidacy.authorityName}
                </a>
              </p>
            </li>
          ))}
        </ul>
      </section>

      {profile.priorService.length > 0 && (
        <section className="mt-10">
          <h2 className="font-serif text-xl font-semibold">Prior service stated by the campaign</h2>
          <ul className="mt-3 space-y-2 text-sm text-neutral-700">
            {profile.priorService.map((service) => (
              <li key={service.serviceId}>
                {/* The title, jurisdiction and dates are the extractor's
                    reading of the quote; only words present in the quote
                    are shown. The quote itself is the record. */}
                {service.officeInQuote && (
                  <span className="font-medium text-neutral-900">
                    {service.officeTitle}
                    {service.jurisdictionInQuote ? `, ${service.jurisdiction}` : ""}
                  </span>
                )}
                {service.officeInQuote &&
                  (service.startedOn || service.endedOn) &&
                  [service.startedOn, service.endedOn].every(
                    (d) => !d || service.sourceQuote.includes(d.slice(0, 4))
                  ) && (
                    <span className="text-neutral-500">
                      {" "}
                      · {service.startedOn ?? "?"}–{service.endedOn ?? "present"}
                    </span>
                  )}
                <blockquote className="mt-1 border-l-2 border-neutral-200 pl-3 text-xs italic text-neutral-600">
                  &ldquo;{service.sourceQuote}&rdquo;{" "}
                  <a href={service.sourceUrl} target="_blank" rel="noopener noreferrer" className="not-italic underline decoration-neutral-300 underline-offset-2">
                    source
                  </a>
                </blockquote>
              </li>
            ))}
          </ul>
        </section>
      )}

      {biographyClaims.length > 0 && (
        <QuoteSection
          heading="Biography, in the campaign's words"
          note="Quoted from the candidate's own campaign site. It is a self-description, not an independent account."
          quotes={biographyClaims}
        />
      )}

      {CAMPAIGN_CLAIM_ORDER.map((claimType) => {
        const group = positionClaims.filter((claim) => claim.claimType === claimType);
        if (group.length === 0) return null;
        return (
          <QuoteSection
            key={claimType}
            heading={`${CAMPAIGN_CLAIM_LABEL[claimType]}, in the campaign's words`}
            note="Quoted from the candidate's own campaign site. These are statements the campaign publishes, not an assessment of a record."
            quotes={group}
          />
        );
      })}

      {profile.site && (
        <p className="mt-8 text-xs text-neutral-500">
          Campaign site{" "}
          <a href={profile.site.siteUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-300 underline-offset-2">
            {new URL(profile.site.siteUrl).hostname}
          </a>
          , established through{" "}
          <a href={profile.site.verifiedSourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-300 underline-offset-2">
            an FEC committee filing
          </a>
          . Passages are selected automatically and quoted verbatim; the wording is the campaign&apos;s, unedited.
        </p>
      )}
    </div>
  );
}

function QuoteSection({
  heading,
  note,
  quotes,
}: {
  heading: string;
  note: string;
  quotes: CandidateProfile["claims"];
}) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-xl font-semibold">{heading}</h2>
      <p className="mt-1 text-xs text-neutral-500">{note}</p>
      <ul className="mt-3 space-y-3">
        {quotes.map((claim) => (
          <li key={claim.claimId} className="border-l-2 border-neutral-200 pl-3">
            <p className="text-sm italic leading-relaxed text-neutral-700">&ldquo;{claim.sourceQuote}&rdquo;</p>
            <a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-neutral-500 underline decoration-neutral-300 underline-offset-2">
              source
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FecOnlyProfile({ candidate }: { candidate: FecCandidateProfile }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <nav className="font-mono text-xs text-neutral-400">
        <Link href="/races" className="no-underline hover:text-neutral-800">Races</Link>
        <span className="mx-1.5">/</span>
        <Link href={`/races?state=${candidate.stateCode}`} className="no-underline hover:text-neutral-800">
          {candidate.stateCode}
        </Link>
      </nav>

      <div className="mt-6 flex items-start gap-4">
        <PartyMark party={candidate.party} size="lg" />
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{candidate.name}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {partyDisplayName(candidate.party)} · federal filer for{" "}
            <Link href={`/race/${candidate.contestId}`} className="underline decoration-neutral-300 underline-offset-2">
              {candidate.contestTitle}
            </Link>
          </p>
        </div>
      </div>

      <p className="mt-4 rounded border border-neutral-200 bg-stone-50 p-3 text-sm leading-relaxed text-neutral-600">
        Everything here comes from federal campaign-finance paperwork. This
        state has no verified ballot adapter yet, so nothing on this page
        establishes ballot access or that this person is still running.
      </p>

      <dl className="mt-6 divide-y divide-neutral-100 rounded border border-neutral-200 bg-white text-sm">
        <Row label="Total raised" value={candidate.totalReceipts == null ? "Not reported" : fmt(candidate.totalReceipts)} />
        <Row label="First filing" value={candidate.firstFileDate ?? "Not reported"} />
        <Row label="Most recent filing" value={candidate.lastFileDate ?? "Not reported"} />
        <Row
          label="Filed as"
          value={
            candidate.incumbentChallenge === "I"
              ? "Incumbent"
              : candidate.incumbentChallenge === "O"
                ? "Open-seat candidate"
                : candidate.incumbentChallenge === "C"
                  ? "Challenger"
                  : "Not stated"
          }
        />
      </dl>

      <p className="mt-6 text-xs text-neutral-500">
        No verified campaign website is on file for this candidate, so no
        statements are quoted here.{" "}
        <a href={candidate.fecProfileUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-neutral-300 underline-offset-2">
          FEC candidate record
        </a>
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-mono text-xs text-neutral-800">{value}</dd>
    </div>
  );
}

// No build-time prerender: pages generate on first request, then serve
// from the ISR cache for the site-wide revalidate window.
export function generateStaticParams() {
  return [];
}
