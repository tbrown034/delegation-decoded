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
  syncLog,
} from "@/lib/schema";
import { count, eq, desc } from "drizzle-orm";

export const metadata: Metadata = {
  title: "About & Methodology",
  description:
    "How Delegation Decoded works — data sources, collection methodology, known limitations, and technical details.",
};

async function getDataStats() {
  const [[b], [s], [f], [c], [a]] = await Promise.all([
    db.select({ count: count() }).from(bills),
    db.select({ count: count() }).from(billSponsorships),
    db.select({ count: count() }).from(campaignFinance),
    db.select({ count: count() }).from(committees),
    db.select({ count: count() }).from(committeeAssignments),
  ]);

  return {
    bills: b?.count || 0,
    sponsorships: s?.count || 0,
    finance: f?.count || 0,
    committees: c?.count || 0,
    assignments: a?.count || 0,
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

      <div className="mt-8 space-y-10 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        {/* What this is */}
        <section>
          <p>
            Delegation Decoded is a congressional accountability platform
            organized by state delegation. Each state gets a dashboard tracking
            its senators and representatives across legislation, committee
            assignments, and campaign finance — drawn directly from official
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
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Data at a glance
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              { n: totalMembers, label: "members tracked" },
              { n: stats.bills, label: "bills ingested" },
              { n: stats.sponsorships, label: "sponsorship links" },
              { n: stats.finance, label: "finance records" },
              { n: stats.committees, label: "committees" },
              { n: stats.assignments, label: "committee assignments" },
            ].map(({ n, label }) => (
              <div key={label}>
                <p className="font-mono text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                  {n.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-400">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Data sources */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Data sources
          </h2>
          <div className="space-y-5">
            <div className="border-b border-neutral-100 pb-4 dark:border-neutral-800">
              <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
                @unitedstates/congress-legislators
              </h3>
              <p className="mt-1 text-xs text-neutral-400">
                github.com/unitedstates/congress-legislators
              </p>
              <p className="mt-1">
                Canonical member database. Biographical data, party affiliation,
                state, district, terms of service, social media handles, and
                cross-reference IDs to other government systems. This is the
                gold standard reference dataset used across civic tech — it
                provides the bioguide ID that links a member across Congress.gov,
                FEC, and every other system.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Access: Raw JSON from GitHub. No API key required. Updated
                weekly.
              </p>
            </div>

            <div className="border-b border-neutral-100 pb-4 dark:border-neutral-800">
              <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
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

            <div>
              <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
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
                1,000 requests/hour. FEC data reflects filings as reported —
                quarterly filing schedules mean data can lag by weeks or months.
              </p>
            </div>
          </div>
        </section>

        {/* Collection process */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Collection process
          </h2>
          <ol className="list-inside list-decimal space-y-2 marker:font-mono marker:text-neutral-300">
            <li>
              <strong className="text-neutral-900 dark:text-neutral-100">Seed states.</strong>{" "}
              All 50 states plus DC and 5 territories are loaded as reference
              data with FIPS codes and current district counts.
            </li>
            <li>
              <strong className="text-neutral-900 dark:text-neutral-100">Ingest members.</strong>{" "}
              Current legislators are fetched from @unitedstates, including
              full term histories and social media. Each member is upserted by
              bioguide ID. Congressional headshots are loaded from the companion
              images repository.
            </li>
            <li>
              <strong className="text-neutral-900 dark:text-neutral-100">Ingest committees.</strong>{" "}
              Committee rosters and membership assignments are fetched from
              @unitedstates for the 119th Congress. Subcommittees are linked to
              parent committees.
            </li>
            <li>
              <strong className="text-neutral-900 dark:text-neutral-100">Ingest bills.</strong>{" "}
              The Congress.gov API is queried for all bills in the 119th
              Congress. Each bill&apos;s detail endpoint is hit to retrieve
              sponsors and cosponsors. Only bills linked to a tracked member
              are stored. Rate-limited to stay under API caps.
            </li>
            <li>
              <strong className="text-neutral-900 dark:text-neutral-100">Ingest finance.</strong>{" "}
              For each member with an FEC candidate ID, financial totals are
              pulled per election cycle. Contribution breakdowns distinguish
              small dollar (under $200), large individual, and PAC money.
            </li>
            <li>
              <strong className="text-neutral-900 dark:text-neutral-100">Log everything.</strong>{" "}
              Every ingestion run is tracked in a sync log with start time,
              completion time, record count, and success/failure status.
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
            <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Recent sync history
            </h2>
            <div>
              {syncs.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 border-b border-neutral-100 py-1.5 font-mono text-xs last:border-0 dark:border-neutral-800"
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
                  <span className="text-neutral-700 dark:text-neutral-300">
                    {s.recordsCount?.toLocaleString() || 0} records
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Known limitations */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900 dark:text-neutral-100">
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
              The Congress.gov API provides limited structured vote-by-member
              data. Roll call votes are not yet included. This is a known gap
              in the ecosystem since the ProPublica Congress API was
              discontinued.
            </li>
            <li>
              Press releases and official statements are not yet tracked.
              Adding this requires per-member RSS discovery and scraping
              infrastructure.
            </li>
            <li>
              Financial disclosures (stock trades, assets) are not included.
              These are typically filed as PDFs and require OCR or specialized
              parsing.
            </li>
            <li>
              Bill coverage is limited to the 119th Congress. Historical
              coverage is available through the API but has not been backfilled.
            </li>
            <li>
              Territory delegates (DC, PR, GU, AS, MP, VI) have limited
              legislative data — they cannot vote on the House floor.
            </li>
          </ul>
        </section>

        {/* AI transparency */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            AI transparency
          </h2>
          <p>
            No AI-generated content is currently displayed on this site. All
            data shown traces directly to an official government API or
            community-maintained dataset. When AI analysis features are added
            (e.g., delegation summaries, contradiction detection), they will be
            clearly labeled as AI-generated and this section will disclose the
            specific models and validation methods used.
          </p>
          <p className="mt-2">
            The codebase was built with the assistance of Claude Code.
          </p>
        </section>

        {/* Tech stack */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Technical details
          </h2>
          <div className="font-mono text-xs text-neutral-400">
            <p>Next.js 16 / TypeScript / Tailwind CSS 4</p>
            <p>Neon Postgres / Drizzle ORM</p>
            <p>Deployed on Vercel</p>
            <p>Ingestion scripts: TypeScript + tsx</p>
          </div>
        </section>

        {/* Contact */}
        <section className="border-t border-neutral-100 pt-8 dark:border-neutral-800">
          <p>
            Built by{" "}
            <a
              href="https://trevorthewebdeveloper.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500 dark:text-neutral-100 dark:decoration-neutral-600"
            >
              Trevor Brown
            </a>
            . For corrections, questions, or licensing inquiries, reach out
            through the portfolio site.
          </p>
          <p className="mt-4">
            <Link
              href="/"
              className="font-mono text-xs text-neutral-400 no-underline hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              Back to all states
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
