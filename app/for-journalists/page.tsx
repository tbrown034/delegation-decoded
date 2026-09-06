import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  members,
  stockTransactions,
  disclosureFilings,
  campaignFinance,
  electionCandidates,
  votePositions,
} from "@/lib/schema";
import { count, eq } from "drizzle-orm";
import { getRaceExportRows } from "@/lib/elections/queries";
import { JsonLd, SITE_URL } from "@/components/json-ld";

export const metadata: Metadata = {
  title: "For Journalists",
  description:
    "Bulk CSV downloads, methodology, contact, and reporting tips for journalists using Delegation Decoded data.",
  alternates: { canonical: "/for-journalists" },
};

async function getCounts() {
  const [[tradeRow], [filingRow], [financeRow], [memberRow], [candidateRow], [voteRow], raceRows] =
    await Promise.all([
      db.select({ n: count() }).from(stockTransactions),
      db.select({ n: count() }).from(disclosureFilings),
      db.select({ n: count() }).from(campaignFinance),
      db.select({ n: count() }).from(members).where(eq(members.inOffice, true)),
      db.select({ n: count() }).from(electionCandidates).where(eq(electionCandidates.electionYear, 2026)),
      db.select({ n: count() }).from(votePositions),
      getRaceExportRows(),
    ]);
  return {
    trades: tradeRow?.n ?? 0,
    filings: filingRow?.n ?? 0,
    finance: financeRow?.n ?? 0,
    members: memberRow?.n ?? 0,
    candidates: candidateRow?.n ?? 0,
    raceCandidates: raceRows.length,
    votePositions: voteRow?.n ?? 0,
  };
}

const CSV_DISTRIBUTIONS: { path: string; name: string }[] = [
  { path: "/api/data/members.csv", name: "Current congressional roster" },
  { path: "/api/data/races.csv", name: "2026 race candidate field" },
  { path: "/api/data/candidates.csv", name: "Raw 2026 FEC candidate filers" },
  { path: "/api/data/votes.csv", name: "Roll-call positions" },
  { path: "/api/data/finance.csv", name: "Campaign finance summaries" },
  { path: "/api/data/trades.csv", name: "Stock transactions (preview)" },
  { path: "/api/data/filings.csv", name: "Disclosure filings (preview)" },
];

export default async function ForJournalistsPage() {
  const c = await getCounts();

  // The page copy names no license beyond "no registration is required", so
  // the terms link points back at the page itself rather than inventing one.
  const datasetLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "Delegation Decoded congressional accountability data",
    description:
      "Bulk CSV exports of the current congressional roster, 2026 race candidate fields, FEC candidate filings, roll-call positions, campaign finance summaries and stock disclosure previews.",
    url: `${SITE_URL}/for-journalists`,
    creator: {
      "@type": "Person",
      name: "Trevor Brown",
    },
    isAccessibleForFree: true,
    license: `${SITE_URL}/for-journalists`,
    distribution: CSV_DISTRIBUTIONS.map((d) => ({
      "@type": "DataDownload",
      name: d.name,
      contentUrl: `${SITE_URL}${d.path}`,
      encodingFormat: "text/csv",
    })),
  };

  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <JsonLd data={datasetLd} />
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">
          For journalists
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold tracking-tight">
          Use this data in your reporting.
        </h1>
        <p className="mt-3 text-base text-neutral-700">
          Live CSV exports, source notes and coverage warnings for reporting on
          Congress and the 2026 midterms. No registration is required.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-4 font-serif text-xl font-semibold tracking-tight">
          Downloads
        </h2>
        <div className="space-y-3">
          <DownloadRow
            href="/api/data/members.csv"
            title="Current congressional roster"
            count={c.members}
            label="rows"
            description="One row per sitting member, with Bioguide and FEC identifiers, chamber, state, district, party, official site and roster update time."
          />
          <DownloadRow
            href="/api/data/races.csv"
            title="2026 race candidate field"
            count={c.raceCandidates}
            label="candidate records"
            description="State-authority candidacies and primary history where covered, with an explicit coverage column and FEC-only fallback everywhere else. Unofficial results remain labeled."
          />
          <DownloadRow
            href="/api/data/candidates.csv"
            title="Raw 2026 FEC candidate filers"
            count={c.candidates}
            label="filers"
            description="Federal candidate filings for House and Senate races. This is not a ballot list and does not include primary results."
          />
          <DownloadRow
            href="/api/data/votes.csv"
            title="Roll-call positions"
            count={c.votePositions}
            label="member-votes"
            description="One row per recorded member position, joined to the roll number, date, question, result, tally and linked bill identifier when available."
          />
          <DownloadRow
            href="/api/data/finance.csv"
            title="Campaign finance summaries"
            count={c.finance}
            label="member-cycles"
            description="Top-line FEC numbers per member per election cycle: receipts, disbursements, cash on hand, individual vs PAC breakdowns."
          />
        </div>
      </section>

      <section className="mb-10 rounded border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950">
        <h2 className="font-serif text-xl font-semibold tracking-tight">
          Stock disclosure downloads — coming feature
        </h2>
        <p className="mt-2">
          These preview exports preserve the reporting infrastructure while
          member coverage and automated parsing are audited. They are not a
          complete universe and cannot establish that a member did or did not trade.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          <a href="/api/data/trades.csv" className="font-medium underline underline-offset-2">
            Preview transactions ({c.trades.toLocaleString()} rows)
          </a>
          <a href="/api/data/filings.csv" className="font-medium underline underline-offset-2">
            Preview filings ({c.filings.toLocaleString()} rows)
          </a>
          <Link href="/trades/methodology" className="font-medium underline underline-offset-2">
            Preview methodology
          </Link>
        </div>
      </section>

      <section className="mb-10 space-y-3 text-sm leading-relaxed text-neutral-800">
        <h2 className="font-serif text-xl font-semibold tracking-tight">
          Freshness
        </h2>
        <p>
          The roster, 2026 candidate filings and roll calls follow their
          source-specific ingestion schedules. The{" "}
          <Link href="/health" className="underline hover:text-neutral-900">
            /health page
          </Link>{" "}
          shows the live state of every ingest pipeline.
        </p>
      </section>

      <section className="mb-10 space-y-3 text-sm leading-relaxed text-neutral-800">
        <h2 className="font-serif text-xl font-semibold tracking-tight">
          Where AI touched the data
        </h2>
        <p>
          The roster, votes, bills, sponsorships, campaign finance, committees
          and Senate disclosure rows come straight from official records with
          no model in the loop, and so do the member, candidate, finance, race
          and vote exports. In the preview trade and filing exports, House rows
          were read from
          PDF scans by a vision model; each row carries a{" "}
          <code className="font-mono text-xs">confidence</code> score and a{" "}
          <code className="font-mono text-xs">needs_review</code> flag, and
          rows below 80% confidence are published with the flag rather than
          hidden. Biography and campaign quotes on member and race pages are
          verbatim passages a model selected and code confirmed were present
          in a captured copy of the source page; they are the office&apos;s own
          words, not independent findings. The{" "}
          <Link href="/about#ai-transparency" className="underline hover:text-neutral-900">
            AI transparency section
          </Link>{" "}
          on the About page names every model call.
        </p>
      </section>

      <section className="mb-10 space-y-3 text-sm leading-relaxed text-neutral-800">
        <h2 className="font-serif text-xl font-semibold tracking-tight">
          What to cite
        </h2>
        <p>
          Cite the original source — Congress.gov, House or Senate roll-call
          records, or the FEC — and link to this site as the aggregation source when useful.
        </p>
        <p>
          If you find a discrepancy, open an issue with the record identifier
          or send it directly so the source and ingest can be checked.
        </p>
      </section>

      <section className="mb-10 space-y-3 text-sm leading-relaxed text-neutral-800">
        <h2 className="font-serif text-xl font-semibold tracking-tight">
          Reporting tips
        </h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            FEC candidate records show people who filed federal paperwork, not
            the final ballot. State deadlines and primaries can narrow the field.
          </li>
          <li>
            Campaign totals follow FEC filing schedules and must be reported
            with their election cycle and filing date.
          </li>
          <li>
            Roll-call coverage is limited to records ingested for the current Congress.
            Confirm a consequential vote against the linked official roll call.
          </li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed text-neutral-800">
        <h2 className="font-serif text-xl font-semibold tracking-tight">
          Contact
        </h2>
        <p>
          Trevor Brown —{" "}
          <a
            href="mailto:trevorbrown.web@gmail.com"
            className="underline hover:text-neutral-900"
          >
            trevorbrown.web@gmail.com
          </a>
          . Happy to walk through the data on a call, run custom queries for one-off stories, or open up the source on{" "}
          <a
            href="https://github.com/tbrown034/delegation-decoded"
            className="underline hover:text-neutral-900"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          .
        </p>
      </section>
    </article>
  );
}

function DownloadRow({
  href,
  title,
  count,
  label,
  description,
}: {
  href: string;
  title: string;
  count: number;
  label: string;
  description: string;
}) {
  return (
    <a
      href={href}
      className="block rounded border border-neutral-200 p-4 no-underline transition-colors hover:border-neutral-400 hover:bg-stone-50"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-base font-semibold text-neutral-900">
          {title}
        </h3>
        <span className="font-mono text-[11px] uppercase tracking-wide text-neutral-500">
          {count.toLocaleString()} {label} · CSV
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-neutral-600">
        {description}
      </p>
    </a>
  );
}
