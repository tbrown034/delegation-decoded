export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  members,
  stockTransactions,
  disclosureFilings,
  campaignFinance,
} from "@/lib/schema";
import { count, eq, sql } from "drizzle-orm";

export const metadata: Metadata = {
  title: "For Journalists",
  description:
    "Bulk CSV downloads, methodology, contact, and reporting tips for journalists using Delegation Decoded data.",
};

async function getCounts() {
  const [tradeRow] = await db
    .select({ n: count() })
    .from(stockTransactions);
  const [filingRow] = await db.select({ n: count() }).from(disclosureFilings);
  const [financeRow] = await db.select({ n: count() }).from(campaignFinance);
  const [memberRow] = await db
    .select({ n: count() })
    .from(members)
    .where(eq(members.inOffice, true));
  const [latestFiling] = await db
    .select({
      d: sql<string | null>`MAX(${disclosureFilings.filedDate})::text`,
    })
    .from(disclosureFilings);
  return {
    trades: tradeRow?.n ?? 0,
    filings: filingRow?.n ?? 0,
    finance: financeRow?.n ?? 0,
    members: memberRow?.n ?? 0,
    latestFiling: latestFiling?.d ?? null,
  };
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function ForJournalistsPage() {
  const c = await getCounts();

  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">
          For journalists
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold tracking-tight">
          Use this data in your reporting.
        </h1>
        <p className="mt-3 text-base text-neutral-700">
          Bulk CSV downloads of every figure on this site, refreshed nightly. No registration, no rate limit, no terms of use beyond the underlying federal disclosures (which carry no copyright under 17 U.S.C. §105).
        </p>
      </header>

      <section className="mb-10">
        <h2 className="mb-4 font-serif text-xl font-semibold tracking-tight">
          Downloads
        </h2>
        <div className="space-y-3">
          <DownloadRow
            href="/api/data/trades.csv"
            title="STOCK Act trades"
            count={c.trades}
            label="rows"
            description="One row per disclosed transaction. Joins members, filings, and parsed PTR line items. Includes amount range, late-filing flag, parser confidence, and a link back to the source PDF."
          />
          <DownloadRow
            href="/api/data/filings.csv"
            title="PTR filings"
            count={c.filings}
            label="filings"
            description="One row per Periodic Transaction Report. Includes parse status, page count, transaction count, and the source PDF URL on the House Clerk or Senate eFD portal."
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

      <section className="mb-10 space-y-3 text-sm leading-relaxed text-neutral-800">
        <h2 className="font-serif text-xl font-semibold tracking-tight">
          Freshness
        </h2>
        <p>
          Trades and filings are refreshed daily; campaign finance and committee assignments weekly. The most recent PTR ingested was filed{" "}
          <span className="font-medium text-neutral-900">
            {fmtDate(c.latestFiling)}
          </span>
          . The{" "}
          <Link href="/health" className="underline hover:text-neutral-900">
            /health page
          </Link>{" "}
          shows the live state of every ingest pipeline.
        </p>
      </section>

      <section className="mb-10 space-y-3 text-sm leading-relaxed text-neutral-800">
        <h2 className="font-serif text-xl font-semibold tracking-tight">
          What to cite
        </h2>
        <p>
          Cite the original source — the House Clerk financial disclosure portal, the Senate Office of Public Records eFD, the FEC, or Congress.gov — and link to this site as your aggregation source if you want.
        </p>
        <p>
          If you find a discrepancy between this site and a primary source, it is a bug. Open an issue with the document ID or send it to me directly and I will fix it within a day.
        </p>
      </section>

      <section className="mb-10 space-y-3 text-sm leading-relaxed text-neutral-800">
        <h2 className="font-serif text-xl font-semibold tracking-tight">
          Reporting tips
        </h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Amount values are statutory ranges, not exact dollar amounts. The 5 U.S.C. §13104 ranges are $1,001–$15,000, $15,001–$50,000, $50,001–$100,000, and so on.
          </li>
          <li>
            A trade is marked late if it was filed more than 45 days after the transaction date — the hard statutory deadline. The penalty is a $200 fee that is routinely waived.
          </li>
          <li>
            Every transaction links to its source PDF. Don&rsquo;t publish anything that doesn&rsquo;t survive a click-through to the original.
          </li>
          <li>
            See{" "}
            <Link
              href="/trades/methodology"
              className="underline hover:text-neutral-900"
            >
              the trades methodology page
            </Link>{" "}
            for the full pipeline, known limitations, and how this compares to other trackers.
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
