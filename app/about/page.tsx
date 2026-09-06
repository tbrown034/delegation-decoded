import type { Metadata } from "next";
import Link from "next/link";
import { getTotalMemberCount, getChamberComposition } from "@/lib/queries";
import { db } from "@/lib/db";
import {
  bills,
  billSponsorships,
  campaignFinance,
  committees,
  committeeAssignments,
  disclosureFilings,
  pressReleases,
  stockTransactions,
  syncLog,
  votes,
} from "@/lib/schema";
import { count, eq, desc, sql } from "drizzle-orm";

export const metadata: Metadata = {
  title: "About & Methodology",
  description:
    "How Delegation Decoded works, data sources, collection methodology, known limitations, and technical details.",
  alternates: { canonical: "/about" },
};

async function getDataStats() {
  const [[b], [s], [f], [c], [a], [tx], [df], [v], [pr], [bc], [vc]] =
    await Promise.all([
      db.select({ count: count() }).from(bills),
      db.select({ count: count() }).from(billSponsorships),
      db.select({ count: count() }).from(campaignFinance),
      db.select({ count: count() }).from(committees),
      db.select({ count: count() }).from(committeeAssignments),
      db.select({ count: count() }).from(stockTransactions),
      db.select({ count: count() }).from(disclosureFilings),
      db.select({ count: count() }).from(votes),
      db.select({ count: count() }).from(pressReleases),
      db
        .select({
          min: sql<number>`MIN(congress)`,
          max: sql<number>`MAX(congress)`,
        })
        .from(bills),
      db
        .select({
          min: sql<number>`MIN(congress)`,
          max: sql<number>`MAX(congress)`,
        })
        .from(votes),
    ]);

  return {
    bills: b?.count || 0,
    sponsorships: s?.count || 0,
    finance: f?.count || 0,
    committees: c?.count || 0,
    assignments: a?.count || 0,
    trades: tx?.count || 0,
    filings: df?.count || 0,
    votes: v?.count || 0,
    pressReleases: pr?.count || 0,
    billsCongress: { min: Number(bc?.min) || 119, max: Number(bc?.max) || 119 },
    votesCongress: { min: Number(vc?.min) || 119, max: Number(vc?.max) || 119 },
  };
}

// "the 119th Congress" or "the 118th and 119th Congresses" — derived from the
// rows actually in the database so this page can never claim coverage the
// backfill hasn't delivered yet.
function congressLabel(range: { min: number; max: number }) {
  if (range.min === range.max) return `the ${range.max}th Congress`;
  return `the ${range.min}th and ${range.max}th Congresses`;
}

async function getSyncHistory() {
  return db
    .select()
    .from(syncLog)
    .where(eq(syncLog.status, "success"))
    .orderBy(desc(syncLog.completedAt))
    .limit(10);
}

export default async function AboutPage() {
  const [totalMembers, stats, syncs, composition] = await Promise.all([
    getTotalMemberCount(),
    getDataStats(),
    getSyncHistory(),
    getChamberComposition(),
  ]);
  const vacantSeats = composition.house.vacant + composition.senate.vacant;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
        About & Methodology
      </h1>

      <div className="mt-8 space-y-10 text-sm leading-relaxed text-neutral-600">
        {/* What this is */}
        <section>
          <p>
            Delegation Decoded is a congressional accountability platform
            organized by state delegation, covering Congress year-round and the
            2026 midterms.
            Each state dashboard connects its current lawmakers, votes,
            legislation, committees, campaign finance and 2026 candidate fields
            to the official records behind them, and the{" "}
            <Link
              href="/compare"
              className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500"
            >
              Compare
            </Link>{" "}
            tool places any two delegations side by side.
          </p>
          <p className="mt-2">
            It is built for voters who need a factual starting point and
            journalists who need a transparent reporting tool. It is not an
            endorsement guide, election forecast or partisan scorecard.
          </p>
        </section>

        {/* Data quality */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900">
            Data at a glance
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              { n: totalMembers, label: "members tracked" },
              { n: stats.bills, label: "bills ingested" },
              { n: stats.sponsorships, label: "sponsorship links" },
              { n: stats.votes, label: "roll-call votes" },
              { n: stats.committees, label: "committees" },
              { n: stats.assignments, label: "committee assignments" },
              { n: stats.finance, label: "finance records" },
            ].map(({ n, label }) => (
              <div key={label}>
                <p className="font-mono text-2xl font-semibold text-neutral-900">
                  {n.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-400">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950">
          <h2 className="font-serif text-lg font-semibold">
            Stock disclosures are a coming feature
          </h2>
          <p className="mt-2">
            The House and Senate disclosure pipelines and preview pages remain
            available while coverage, parser accuracy and member matching are
            validated. They are not yet a complete reporting dataset and are
            intentionally excluded from the main navigation, search emphasis
            and records assistant.
          </p>
          <p className="mt-2 text-xs text-amber-900">
            Preview infrastructure currently contains {stats.filings.toLocaleString()} filings
            and {stats.trades.toLocaleString()} parsed transaction rows. Those
            counts measure loaded records, not comprehensive member coverage.
          </p>
        </section>

        {/* Data sources */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900">
            Data sources
          </h2>
          <div className="space-y-5">
            <div className="border-b border-neutral-100 pb-4">
              <h3 className="font-medium text-neutral-900">
                @unitedstates/congress-legislators
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                github.com/unitedstates/congress-legislators
              </p>
              <p className="mt-1">
                Canonical member database. Biographical data, party affiliation,
                state, district, terms of service, social media handles, and
                cross-reference IDs to other government systems. This is the
                gold standard reference dataset used across civic tech, it
                provides the bioguide ID that links a member across Congress.gov,
                FEC, and every other system.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Access: Raw JSON from GitHub. No API key required. Updated
                weekly.
              </p>
            </div>

            <div className="border-b border-neutral-100 pb-4">
              <h3 className="font-medium text-neutral-900">
                Congress.gov API
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                api.congress.gov/v3
              </p>
              <p className="mt-1">
                Official Library of Congress API. Bills, resolutions,
                sponsorships, cosponsorships, committee reports, and legislative
                actions for {congressLabel(stats.billsCongress)}. This is the
                authoritative source for what legislation a member has
                introduced, cosponsored, or acted on.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Access: REST API with free key. Rate limit: 5,000 requests/hour.
                Bills are scanned sequentially; only those with a sponsor in the
                current member database are ingested.
              </p>
            </div>

            <div className="border-b border-neutral-100 pb-4">
              <h3 className="font-medium text-neutral-900">
                FEC API
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                api.open.fec.gov/v1
              </p>
              <p className="mt-1">
                Federal Election Commission campaign finance data. Candidate
                financial totals, receipts, disbursements, cash on hand, and
                contribution breakdowns (small dollar, large individual, PAC).
                Linked committees are also ingested — principal campaign
                committees, leadership PACs, and joint fundraising committees,
                with per-cycle totals — plus top contributors aggregated by
                donor employer from Schedule A itemizations. Members are
                matched by their FEC candidate ID stored in the @unitedstates
                dataset.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Access: REST API with free key via api.data.gov. Rate limit:
                1,000 requests/hour. FEC data reflects filings as reported, quarterly filing schedules mean data can lag by weeks or months.
              </p>
            </div>

            <div className="border-b border-neutral-100 pb-4">
              <h3 className="font-medium text-neutral-900">
                House and Senate roll-call XML
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                clerk.house.gov/evs · senate.gov/legislative
              </p>
              <p className="mt-1">
                Official roll-call vote records. House votes are scraped from
                the Clerk&apos;s per-vote XML files; Senate votes are pulled
                from the Senate&apos;s legislative XML feed. Each vote is stored
                with the bill or measure it relates to, the result, and a
                position record per member.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Access: Public XML, no key. Coverage:{" "}
                {congressLabel(stats.votesCongress)},
                {" "}{stats.votes.toLocaleString()} roll calls ingested.
                Historical roll calls are stored for current members only.
              </p>
            </div>

            <div className="border-b border-neutral-100 pb-4">
              <h3 className="font-medium text-neutral-900">
                House Clerk financial disclosures — coming feature pipeline
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                disclosures-clerk.house.gov
              </p>
              <p className="mt-1">
                House PTR ingestion has been paused since August 31, 2026. The
                Clerk publishes annual ZIPs of PTR PDFs. Historically, PDFs were parsed
                with Anthropic Claude Sonnet 4.6 in vision mode, the model
                reads the rendered form and returns structured JSON: ticker,
                asset description, owner, transaction type, transaction date,
                amount band, and a per-row confidence score. Rows below 80%
                confidence are flagged for review and rendered with a warning
                badge in the UI.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Access: PDF bulk download. Re-parsing is idempotent via PDF
                hash. Coverage and parser accuracy are still being audited;
                loaded rows must not be treated as a complete universe.
              </p>
            </div>

            <div className="border-b border-neutral-100 pb-4">
              <h3 className="font-medium text-neutral-900">
                Senate Electronic Financial Disclosures — coming feature pipeline
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                efdsearch.senate.gov
              </p>
              <p className="mt-1">
                Preview ingestion of STOCK Act PTRs for senators. The Senate filing system serves
                structured HTML tables, every row already has a discrete
                ticker, owner code, asset type, transaction type, and amount
                band. Parsed deterministically with a cookie-jar + regex
                pipeline; no LLM required. Faster, free, and reliably high
                confidence (95% baseline when ticker present).
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Access: Public web form, requires accepting an electronic
                terms-of-service before each session.
              </p>
            </div>

            <div>
              <h3 className="font-medium text-neutral-900">
                Member office RSS feeds
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                house.gov · senate.gov subdomains
              </p>
              <p className="mt-1">
                Press-release collection was retired on August 31, 2026.
                The historical records remain stored. Current statements
                coverage lives at the companion project,{' '}
                <a href="https://capitolreleases.com" className="underline">Capitol Releases</a>.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Historical archive: {stats.pressReleases.toLocaleString()} records.
                This is not current collection coverage.
              </p>
            </div>
          </div>
        </section>

        <AboutProcessDetails
          syncs={syncs}
          totalMembers={totalMembers}
          vacantSeats={vacantSeats}
          billsCongress={stats.billsCongress}
        />
      </div>
    </div>
  );
}

function AboutProcessDetails({
  syncs,
  totalMembers,
  vacantSeats,
  billsCongress,
}: {
  syncs: Awaited<ReturnType<typeof getSyncHistory>>;
  totalMembers: number;
  vacantSeats: number;
  billsCongress: { min: number; max: number };
}) {
  return (
    <>
        {/* Collection process */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900">
            Collection process
          </h2>
          <ol className="list-inside list-decimal space-y-2 marker:font-mono marker:text-neutral-300">
            <li>
              <strong className="text-neutral-900">Seed states.</strong>{" "}
              All 50 states plus DC and 5 territories are loaded as reference
              data with FIPS codes and current district counts.
            </li>
            <li>
              <strong className="text-neutral-900">Ingest members.</strong>{" "}
              Current legislators are fetched from @unitedstates, including
              full term histories and social media. Each member is upserted by
              bioguide ID. Congressional headshots are loaded from the companion
              images repository.
            </li>
            <li>
              <strong className="text-neutral-900">Ingest committees.</strong>{" "}
              Committee rosters and membership assignments are fetched from
              @unitedstates for the 119th Congress. Subcommittees are linked to
              parent committees.
            </li>
            <li>
              <strong className="text-neutral-900">Ingest bills.</strong>{" "}
              The Congress.gov API is queried for all bills in{" "}
              {congressLabel(billsCongress)}. Each bill&apos;s detail
              endpoint is hit to retrieve sponsors and cosponsors. Only bills
              linked to a tracked member are stored, in historical congresses
              as well as the current one. Rate-limited to stay under API caps.
            </li>
            <li>
              <strong className="text-neutral-900">Ingest finance.</strong>{" "}
              For each member with an FEC candidate ID, financial totals are
              pulled per election cycle, and current-cycle totals are refreshed
              weekly. Contribution breakdowns distinguish small dollar (under
              $200), large individual, and PAC money. A separate weekly pass
              ingests each member&apos;s linked committees and top contributors
              by donor employer.
            </li>
            <li>
              <strong className="text-neutral-900">Ingest votes.</strong>{" "}
              House and Senate roll-call XML is fetched per session. Each
              vote becomes one row with a position record per member. Used
              to power the legislative activity feed and per-member voting
              record.
            </li>
            <li>
              <strong className="text-neutral-900">Track 2026 races.</strong>{" "}
              The verified layer starts from state election-authority ballot and
              result records, stores each raw response as a hash-addressed private
              snapshot, and appends status events rather than rewriting history.
              Indiana and Nebraska backfill completed primaries while Delaware,
              Florida, Rhode Island and Washington track still-active
              primaries; Michigan moved to its verified general ballot in
              September. Indiana remains verification pending because
              the statewide primary feed marks itself unofficial and the state&apos;s
              general candidate spreadsheet warns that it is incomplete. Delaware
              remains verification pending because its official lists establish
              qualified and withdrawn candidates, but are not yet a sample ballot
              or certified result. Florida&apos;s export distinguishes qualified,
              unopposed, withdrawn and failed-to-qualify records, but its candidate
              tracking system describes itself as an unofficial reference. Rhode
              Island&apos;s official workbook explicitly identifies ballot
              qualification and primary or general ballot inclusion, so those
              contests are labeled verified ballot. Nebraska&apos;s current federal
              list is reconciled against its June 8 certified primary canvass,
              and its petition candidate is backed by a separate state
              certification record, so those contests are also labeled verified
              ballot. Michigan&apos;s August report is an official candidate listing,
              so qualified primary candidates received primary ballot lines.
              The state labeled its November report unofficial until the
              primary was canvassed, and those filings stayed provisional
              with no general-election ballot lines. After the August 4
              primary the state republished the November report as an
              official candidate listing; the parser refused the changed
              page for five nights until it was taught to read the state&apos;s
              own label, and Michigan contests are now labeled verified
              ballot with general-election ballot lines. Candidates the
              state no longer lists are retired as absent from the official
              list, not as defeated, because this site does not ingest
              Michigan primary results. Washington&apos;s VoteWA list explicitly identifies active
              candidates whose election status is &quot;In Primary,&quot; so its
              House contests are labeled verified ballot. Washington uses a
              top-two primary, and the displayed party values are candidate
              preferences rather than party nominations. The
              structured parser excludes voter IDs, addresses, phone numbers and
              email addresses from candidate records; the complete source export
              is retained only as a private, content-addressed evidence snapshot.
              Everywhere else, FEC Form 2 filings remain
              visible only as a labeled fallback. An FEC filing is never presented
              as ballot access.
            </li>
            <li>
              <strong className="text-neutral-900">Research campaign sites.</strong>{" "}
              For state-authority candidacies with an exact FEC ID match, the
              weekly pipeline accepts only the website reported by a current
              principal or authorized campaign committee. It respects robots
              rules, stays on that domain, blocks private and metadata network
              addresses, caps pages, bytes, time and model tokens, and stores
              every page as a private immutable snapshot. What publishes is the
              candidate&apos;s own words: race pages show the exact quoted
              passage next to a link to the page it came from, never a model&apos;s
              paraphrase of it. A model selects which passages to surface and
              labels them, and every quote is checked against the stored
              snapshot before it appears, so nothing can be published that is
              not present in the source. These are statements a campaign makes
              about itself, not claims this site has independently confirmed.
            </li>
            <li>
              <strong className="text-neutral-900">Build official member biographies.</strong>{" "}
              Current House and Senate website URLs come from the member roster
              and must remain on a house.gov or senate.gov host. A bounded,
              robots-aware crawler uses the same CMS reconnaissance patterns as
              Capitol Releases, and stores private content-addressed snapshots.
              Member pages publish the exact passage the office wrote, linked to
              the page it came from, grouped by what kind of fact it is —
              education, military service, public service, career, family,
              roots. A model selects and groups; it does not rewrite. Every
              quote is verified against the stored snapshot before it appears.
              An official biography is a lawmaker&apos;s account of themselves,
              which is why it is quoted rather than restated as fact.
            </li>
            <li>
              <strong className="text-neutral-900">Validate disclosure infrastructure.</strong>{" "}
              House PTR PDF parsing with Claude Sonnet 4.6 has been paused
              since August 31, 2026 because oversized filings aborted the queue.
              Historical parsed records remain available. Senate PTRs come from the
              eFD HTML tables and are parsed deterministically. The active Senate pipeline
              upserts into shared disclosure tables and runs incrementally;
              already-seen hashes are skipped. Reader-facing coverage remains
              labeled as a coming feature until the audits are complete.
            </li>
            <li>
              <strong className="text-neutral-900">Retain the press-release archive.</strong>{" "}
              Collection stopped August 31, 2026. Historical rows remain stored;
              current statements coverage belongs to Capitol Releases.
            </li>
            <li>
              <strong className="text-neutral-900">Log everything.</strong>{" "}
              Every ingestion run is tracked in a sync log with start time,
              completion time, record count, and success/failure status. The
              homepage data-freshness panel reads directly from this log.
            </li>
          </ol>
          <p className="mt-3">
            All writes are idempotent upserts. Running the same ingestion
            twice produces the same result. No data is deleted during updates.
          </p>
        </section>

        {/* Sync history */}
        {syncs.length > 0 && (
          <section>
            <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900">
              Recent sync history
            </h2>
            <div>
              {syncs.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 border-b border-neutral-100 py-1.5 font-mono text-xs last:border-0"
                >
                  <span className="w-28 text-neutral-400">
                    {s.completedAt
                      ? new Date(s.completedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "—"}
                  </span>
                  <span className="w-24 text-neutral-500">{s.source}</span>
                  <span className="w-24 text-neutral-500">{s.entityType}</span>
                  <span className="text-neutral-700">
                    {s.recordsCount?.toLocaleString() || 0} records
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Known limitations */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900">
            Known limitations
          </h2>
          <ul className="list-inside list-disc space-y-1.5 marker:text-neutral-300">
            <li>
              FEC campaign finance data is reported on filing schedules.
              Quarterly filers may have data that is weeks or months old.
            </li>
            <li>
              Some members have FEC candidate IDs that point to old campaign
              committees (e.g., a senator&apos;s prior House campaign). This can
              result in missing or incomplete finance data for their current
              office.
            </li>
            <li>
              Stock disclosure coverage is incomplete and still under
              validation. Preview pages cannot establish that a member did or
              did not trade, and every row must be checked against its official filing.
            </li>
            <li>
              House PTR rows below 80% parse confidence are flagged for review
              rather than hidden. Automated confidence is a triage signal, not
              independent verification.
            </li>
            <li>
              The retired press-release archive is incomplete and no longer
              updated. It cannot establish a member&apos;s current statements.
            </li>
            <li>
              Bill and vote coverage is limited to{" "}
              {congressLabel(billsCongress)}. Earlier congresses are
              available upstream but have not been backfilled.
            </li>
            <li>
              Historical roll calls and bills are stored for current members
              only. A member who left office before the current Congress does
              not appear in vote or sponsorship records here.
            </li>
            <li>
              Territory delegates (DC, PR, GU, AS, MP, VI) have limited
              legislative data, they cannot vote on the House floor.
            </li>
            <li>
              The roster is sourced from{" "}
              <a
                href="https://github.com/unitedstates/congress-legislators"
                className="underline hover:text-neutral-900"
              >
                @unitedstates/congress-legislators
              </a>
              . Congress has 435 voting House seats, 100 Senate seats, and six
              non-voting delegate seats. The site currently tracks{" "}
              {totalMembers} sitting members
              {vacantSeats > 0 && (
                <>
                  , with {vacantSeats} voting seat{vacantSeats === 1 ? "" : "s"}{" "}
                  vacant pending special elections
                </>
              )}
              . These numbers are computed from the live database, not written
              by hand. Vacant seats have no member page until a successor is
              sworn in; members who die or leave office are marked out of
              office on the next nightly sync.
            </li>
            <li>
              Official and campaign biography text is the subject&apos;s own
              description. Automated extraction checks that each quoted passage
              occurs in its captured source. These passages are not routinely
              reviewed by a person before display and are not independently
              verified biographical findings. Rejected records are withheld.
            </li>
          </ul>
        </section>

        {/* AI transparency */}
        <section id="ai-transparency">
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900">
            AI transparency
          </h2>
          <p>
            The <Link href="/ask" className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500">Ask</Link>{" "}
            feature uses OpenAI GPT-5.6 Terra as its primary provider and
            Anthropic Claude Sonnet 5 as an independent fallback. OpenAI uses
            strict schemas for every tool. Anthropic uses a deterministic topic
            router to expose only the relevant strict retrieval schemas, keeping
            grammar compilation within the request deadline. Both providers
            send arguments through server-side type, range and scope
            validation before any query runs. A terminal answer tool is required, and a factual answer is
            rejected unless it includes a server-issued citation to a retrieved record.
            Unknown citation references also reject the answer. These checks do
            not establish that every claim correctly interprets its source.
          </p>
          <p className="mt-2">
            Exact SQL retrieval is used instead of embedding search for votes,
            bills, finance, committees, terms and races because those are
            structured records where identifiers and dates must match.
            Race answers dual-read state-authority candidacies where a verified
            adapter exists and FEC filings elsewhere, preserving the coverage
            label in the model context. Each answer shows the record categories checked. Stock disclosures are
            not exposed to the assistant while that feature is under validation.
          </p>
          <p className="mt-2">
            Questions are capped in length, same-origin POST requests are
            enforced, provider retries are disabled, and one provider fallback
            is allowed only when the primary is unavailable. Per-connection and
            daily provider limits cap abuse and spend. Fresh questions are
            screened with a free moderation model before any paid provider
            call; that check fails open, so a moderation outage never blocks
            the feature. IP-derived identifiers and cache keys are HMACed or
            hashed; questions are not stored in plaintext in the answer cache.
          </p>
          <p className="mt-2">
            Every question and answer is kept in an audit log for 90 days,
            keyed to a hashed connection identifier rather than an address.
            The log records the model&apos;s own status for each reply —
            answered, no matching record, out of scope, or declined — plus the
            records checked, the provider used, latency, and what share of the
            answer&apos;s sentences carry a validated citation. This supports investigation and corrections; it does not preserve
            every retrieved payload or guarantee an identical rerun. The{" "}
            <Link href="/health" className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500">
              health page
            </Link>{" "}
            publishes live totals from it. Replies that are not grounded
            answers are labeled in the interface, no answer is reviewed by a
            person before display, and every answer carries a report link for
            corrections.
          </p>
          <p className="mt-2">
            AI also supports extraction. House PTR parsing with
            Anthropic Claude Sonnet 4.6 in vision mode has been paused since
            August 31, 2026; the following describes historical parsed records. The model reads the
            rendered disclosure form and returns structured JSON, ticker,
            asset description, owner, transaction type, transaction date,
            amount band, plus a per-row confidence score (0–100). Every row is
            stored with its score; rows below 80% are flagged in the UI and
            the user can see exactly which rows the parser was uncertain
            about. Senate PTRs do not use AI: they come back as structured
            HTML and are parsed deterministically.
          </p>
          <p className="mt-2">
            Campaign-site and official-member biography research uses OpenAI
            GPT-5.6 Terra with low reasoning and strict Structured Outputs,
            then falls back to Anthropic Claude Sonnet 5 when the primary
            provider is unavailable. Retrieval is deterministic and bounded:
            crawlers select only approved same-domain research pages, then
            supply their text directly. The model cannot browse or choose new
            URLs. Application code drops any output whose quote is not present
            in the cited snapshot, and only the verbatim quote is published or
            supplied to Ask, never the model&apos;s paraphrase. Non-rejected
            source quotes then appear on pages and in Ask without individual
            human approval. A person can reject a record using the review
            tools; as of September 2026 no record has been rejected or
            approved. A quote-presence check establishes what a source said,
            not whether the statement is true.
          </p>
          <p className="mt-2">
            All other data — bills, sponsorships, votes, finance, committees
            and members — traces directly to an official API or
            community-maintained dataset, with no model in the loop.
          </p>
        </section>

        {/* Tech stack */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900">
            Technical details
          </h2>
          <div className="font-mono text-xs text-neutral-400">
            <p>Next.js 16 / TypeScript / Tailwind CSS 4</p>
            <p>Neon Postgres / Drizzle ORM</p>
            <p>Deployed on Vercel</p>
            <p>Ingestion scripts: TypeScript + tsx</p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900">
            For journalists & site health
          </h2>
          <p>
            Reporters can bulk-download every dataset as CSV, with freshness
            timestamps and reporting tips, on the{" "}
            <Link
              href="/for-journalists"
              className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500"
            >
              For Journalists
            </Link>{" "}
            page. The full pipeline status — per-source coverage, sync history,
            and any active issues — is public at{" "}
            <Link
              href="/health"
              className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500"
            >
              /health
            </Link>
            .
          </p>
        </section>

        {/* Contact */}
        <section className="border-t border-neutral-100 pt-8">
          <p>
            Built by{" "}
            <a
              href="https://trevorthewebdeveloper.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500"
            >
              Trevor Brown
            </a>
            . For corrections, questions, or licensing inquiries, reach out
            through the portfolio site.
          </p>
          <p className="mt-4">
            <Link
              href="/"
              className="font-mono text-xs text-neutral-400 no-underline hover:text-neutral-700"
            >
              Back to all states
            </Link>
          </p>
        </section>
    </>
  );
}
