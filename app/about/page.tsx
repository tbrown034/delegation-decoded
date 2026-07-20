export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { getTotalMemberCount } from "@/lib/queries";
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
import { count, eq, desc } from "drizzle-orm";

export const metadata: Metadata = {
  title: "About & Methodology",
  description:
    "How Delegation Decoded works, data sources, collection methodology, known limitations, and technical details.",
};

async function getDataStats() {
  const [[b], [s], [f], [c], [a], [tx], [df], [v], [pr]] = await Promise.all([
    db.select({ count: count() }).from(bills),
    db.select({ count: count() }).from(billSponsorships),
    db.select({ count: count() }).from(campaignFinance),
    db.select({ count: count() }).from(committees),
    db.select({ count: count() }).from(committeeAssignments),
    db.select({ count: count() }).from(stockTransactions),
    db.select({ count: count() }).from(disclosureFilings),
    db.select({ count: count() }).from(votes),
    db.select({ count: count() }).from(pressReleases),
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
  };
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
  const [totalMembers, stats, syncs] = await Promise.all([
    getTotalMemberCount(),
    getDataStats(),
    getSyncHistory(),
  ]);

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
            organized by state delegation. Each state gets a dashboard tracking
            its senators and representatives across legislation, committee
            assignments, and campaign finance, drawn directly from official
            government records.
          </p>
          <p className="mt-2">
            This is a public records project built for reporters, researchers,
            and anyone who wants to know what their state&apos;s delegation is
            actually doing. It is not a consumer app, a voter guide, or a
            partisan tool.
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
              { n: stats.filings, label: "STOCK Act filings" },
              { n: stats.trades, label: "disclosed trades" },
              { n: stats.pressReleases, label: "press releases" },
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
                actions for the 119th Congress. This is the authoritative source
                for what legislation a member has introduced, cosponsored, or
                acted on.
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
                Members are matched by their FEC candidate ID stored in the
                @unitedstates dataset.
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
                Access: Public XML, no key. Coverage: 119th Congress,
                {" "}{stats.votes.toLocaleString()} roll calls ingested.
              </p>
            </div>

            <div className="border-b border-neutral-100 pb-4">
              <h3 className="font-medium text-neutral-900">
                House Clerk financial disclosures
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                disclosures-clerk.house.gov
              </p>
              <p className="mt-1">
                STOCK Act Periodic Transaction Reports for House members. The
                Clerk publishes annual ZIPs of PTR PDFs. Each PDF is parsed
                with Anthropic Claude Sonnet 4.6 in vision mode, the model
                reads the rendered form and returns structured JSON: ticker,
                asset description, owner, transaction type, transaction date,
                amount band, and a per-row confidence score. Rows below 80%
                confidence are flagged for review and rendered with a warning
                badge in the UI.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Access: PDF bulk download. Re-parsing is idempotent via PDF
                hash. Of {stats.filings.toLocaleString()} House and Senate
                filings ingested, 99.95% of rows score ≥80% confidence.
              </p>
            </div>

            <div className="border-b border-neutral-100 pb-4">
              <h3 className="font-medium text-neutral-900">
                Senate Electronic Financial Disclosures (eFD)
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                efdsearch.senate.gov
              </p>
              <p className="mt-1">
                STOCK Act PTRs for senators. The Senate filing system serves
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
                Official press releases from member office websites. Each
                member&apos;s site is probed for one of six standard RSS feed
                paths (`/rss.xml`, `/feed/`, `/news/rss.xml`, etc.) and parsed
                with a small inline XML reader, no third-party dependencies.
                Used to power the press-release timeline and keyword analytics.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Coverage: {stats.pressReleases.toLocaleString()} releases from
                members whose offices publish a feed. Members without an
                accessible feed are silently skipped.
              </p>
            </div>
          </div>
        </section>

        <AboutProcessDetails syncs={syncs} />
      </div>
    </div>
  );
}

function AboutProcessDetails({
  syncs,
}: {
  syncs: Awaited<ReturnType<typeof getSyncHistory>>;
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
              The Congress.gov API is queried for all bills in the 119th
              Congress. Each bill&apos;s detail endpoint is hit to retrieve
              sponsors and cosponsors. Only bills linked to a tracked member
              are stored. Rate-limited to stay under API caps.
            </li>
            <li>
              <strong className="text-neutral-900">Ingest finance.</strong>{" "}
              For each member with an FEC candidate ID, financial totals are
              pulled per election cycle. Contribution breakdowns distinguish
              small dollar (under $200), large individual, and PAC money.
            </li>
            <li>
              <strong className="text-neutral-900">Ingest votes.</strong>{" "}
              House and Senate roll-call XML is fetched per session. Each
              vote becomes one row with a position record per member. Used
              to power the legislative activity feed and per-member voting
              record.
            </li>
            <li>
              <strong className="text-neutral-900">Ingest disclosures.</strong>{" "}
              House PTR PDFs are downloaded from the Clerk, hashed, and parsed
              with Claude Sonnet 4.6 in vision mode. Senate PTRs come from the
              eFD HTML tables and are parsed deterministically. Both pipelines
              upsert into the same `disclosure_filings` and
              `stock_transactions` tables and run incrementally, already-seen
              hashes are skipped.
            </li>
            <li>
              <strong className="text-neutral-900">Ingest press releases.</strong>{" "}
              Each member office&apos;s website is probed for an RSS feed. New
              items since the last sync are stored with title, link, pub date,
              and description for the activity timeline.
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
              STOCK Act PTRs are filed up to 45 days after a transaction.
              Members who fail to file are flagged late but the data still
              arrives, sometimes with a multi-month lag.
            </li>
            <li>
              House PTR rows below 80% parse confidence are flagged for
              review rather than hidden. About 0.05% of current rows are in
              this state, typically because the PDF is hand-annotated or
              uses an unusual asset description.
            </li>
            <li>
              Press release coverage depends on each member office publishing
              an RSS feed at a discoverable path. Offices without a feed are
              not represented in the timeline.
            </li>
            <li>
              Bill coverage is limited to the 119th Congress. Historical
              coverage is available through the API but has not been backfilled.
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
              , which currently lists 536 of the 538 voting House districts +
              100 Senate seats. A handful of sitting House members are missing
              from that upstream feed (CA-01, CA-14, TX-23 as of this writing).
              Those member pages return 404 until the upstream JSON catches up
              or a secondary backfill is wired in.
            </li>
          </ul>
        </section>

        {/* AI transparency */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900">
            AI transparency
          </h2>
          <p>
            The <Link href="/ask" className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500">Ask</Link>{" "}
            feature uses Anthropic Claude to answer questions, but the model
            never answers from its own knowledge. It can only call this
            site&apos;s own database queries — the same ones that render every
            page — and compose an answer from what they return. If the data
            can&apos;t answer, it is instructed to say so rather than guess.
            Each answer lists which records were checked, and every member and
            bill it names links to the underlying page so you can verify.
            Questions are rate-limited and common answers are cached for a day.
          </p>
          <p className="mt-2">
            One ingestion pipeline uses AI: House PTR PDFs are parsed with
            Anthropic Claude Sonnet 4.6 in vision mode. The model reads the
            rendered disclosure form and returns structured JSON, ticker,
            asset description, owner, transaction type, transaction date,
            amount band, plus a per-row confidence score (0–100). Every row is
            stored with its score; rows below 80% are flagged in the UI and
            the user can see exactly which rows the parser was uncertain
            about. Senate PTRs do not use AI: they come back as structured
            HTML and are parsed deterministically.
          </p>
          <p className="mt-2">
            All other data, bills, sponsorships, votes, finance, committees,
            members, traces directly to an official API or
            community-maintained dataset, with no model in the loop.
          </p>
          <p className="mt-2">
            The codebase was built with the assistance of Claude Code.
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
