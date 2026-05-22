export const dynamic = "force-dynamic";

import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { members, stockTransactions, disclosureFilings } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

export const metadata: Metadata = {
  title: "Methodology — Trades",
  description:
    "How Delegation Decoded collects and parses congressional financial disclosures.",
};

async function getCoverage() {
  const [tx] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      traders: sql<number>`COUNT(DISTINCT ${stockTransactions.bioguideId})::int`,
    })
    .from(stockTransactions);

  // Use the 1st–99th percentile of tx_date as the "active" window so a single
  // late-filed amendment from 2023 or a future-dated filer typo doesn't widen
  // the displayed range to multiple years.
  const [txWindow] = await db.execute<{
    p1: string | null;
    p99: string | null;
  }>(sql`
    SELECT
      to_char(percentile_disc(0.01) WITHIN GROUP (ORDER BY tx_date), 'YYYY-MM-DD') AS p1,
      to_char(percentile_disc(0.99) WITHIN GROUP (ORDER BY tx_date), 'YYYY-MM-DD') AS p99
    FROM stock_transactions
    WHERE tx_date IS NOT NULL
  `).then((r) => r.rows as { p1: string | null; p99: string | null }[]);

  const [filings] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      latest: sql<string | null>`MAX(${disclosureFilings.filedDate})::text`,
      earliest: sql<string | null>`MIN(${disclosureFilings.filedDate})::text`,
    })
    .from(disclosureFilings);

  const [active] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(members)
    .where(eq(members.inOffice, true));

  return {
    firstTx: txWindow?.p1 ?? null,
    lastTx: txWindow?.p99 ?? null,
    txCount: tx?.total ?? 0,
    traders: tx?.traders ?? 0,
    filings: filings?.total ?? 0,
    earliestFiling: filings?.earliest ?? null,
    latestFiling: filings?.latest ?? null,
    activeMembers: active?.n ?? 0,
  };
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function TradesMethodologyPage() {
  const coverage = await getCoverage();
  const traderPct = coverage.activeMembers
    ? Math.round((coverage.traders / coverage.activeMembers) * 100)
    : 0;
  return (
    <article className="mx-auto max-w-2xl px-4 py-10">
      <nav className="mb-8 font-mono text-xs text-neutral-400">
        <Link href="/trades" className="hover:text-neutral-700">
          Trades
        </Link>
        <span className="mx-1.5">/</span>
        <span>Methodology</span>
      </nav>

      <header className="mb-10">
        <p className="font-mono text-xs uppercase tracking-wide text-neutral-500">
          Methodology
        </p>
        <h1 className="mt-1 font-serif text-4xl font-semibold tracking-tight">
          How this is built.
        </h1>
        <p className="mt-3 text-base text-neutral-700">
          From government PDFs to a structured record of who traded what, when.
        </p>
      </header>

      <Section title="Coverage window">
        <p>
          Periodic transaction reports were filed{" "}
          <span className="font-medium text-neutral-900">
            {fmtDate(coverage.earliestFiling)} – {fmtDate(coverage.latestFiling)}
          </span>
          , with the bulk of transactions falling between{" "}
          <span className="font-medium text-neutral-900">
            {fmtDate(coverage.firstTx)} – {fmtDate(coverage.lastTx)}
          </span>{" "}
          (1st–99th percentile of transaction dates). A handful of older trades exist when a member files a late or amended PTR covering historical activity, and source data occasionally contains future-dated filer typos.
        </p>
        <p>
          Across {coverage.activeMembers} active members of Congress,{" "}
          <span className="font-medium text-neutral-900">
            {coverage.traders} ({traderPct}%)
          </span>{" "}
          have reported individual transactions in this window. The remaining{" "}
          {coverage.activeMembers - coverage.traders} have not. That is the expected pattern — most members do not actively trade individual securities. Common reasons:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>They hold positions through blind trusts, index funds, or mutual funds — none of which trigger STOCK Act reporting.</li>
          <li>They simply did not buy or sell anything over $1,000 in the period.</li>
          <li>They filed an annual report instead of a PTR (annual reports cover positions, not transactions, and are not parsed here).</li>
        </ul>
        <p>
          The latest PTR ingested was filed{" "}
          <span className="font-medium text-neutral-900">
            {fmtDate(coverage.latestFiling)}
          </span>
          . New filings are ingested within ~24 hours of appearing in the House Clerk and Senate eFD portals.
        </p>
      </Section>

      <Section title="How this compares to other trackers">
        <p>
          The closest reference points are CapitolTrades and Quiver Quantitative. Both go back roughly three years; this site is currently focused on the active filing window.
        </p>
        <p>
          For overlap members, the totals line up:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Members with high filing frequency (Khanna, McCaul, Cisneros) match within a single PTR. When CapitolTrades shows newer trades than this site, the cause is a PTR posted within the last 24–48 hours that has not yet been ingested.
          </li>
          <li>
            For Senate members, the eFD portal serves trades as HTML tables, which we parse deterministically — no AI vision step. CapitolTrades publishes the same data with similar lag.
          </li>
          <li>
            Lifetime totals on third-party sites are larger because they cover three years; the per-month rate of trades and members is comparable.
          </li>
        </ul>
        <p>
          If a trade is missing from this site that you can find on a primary source (House Clerk or Senate eFD), it is a bug. Open an issue with the document ID and I will fix it.
        </p>
      </Section>

      <Section title="The law">
        <p>
          The STOCK Act of 2012 (Pub. L. 112-105) requires members of Congress
          to disclose individual securities transactions over $1,000 within 30
          days of being notified or 45 days of the trade — whichever is
          earlier (5 U.S.C. §13104). Filings go to the House Clerk or Senate
          Office of Public Records. The penalty for late filing is a $200 fee
          (5 U.S.C. §13106), routinely waived.
        </p>
      </Section>

      <Section title="The pipeline">
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <span className="font-medium">Manifest fetch.</span> The annual
            financial-disclosure ZIP at{" "}
            <code className="font-mono text-xs">
              disclosures-clerk.house.gov/public_disc/financial-pdfs/{"{year}"}FD.zip
            </code>{" "}
            contains an XML index of every filing. We diff against existing{" "}
            <code className="font-mono text-xs">disclosure_filings.doc_id</code>{" "}
            to find new ones.
          </li>
          <li>
            <span className="font-medium">Bioguide resolution.</span> Filers
            are listed by name and state-district, not bioguide ID. We resolve
            them against our members table by state + last name, falling back
            to district match for ambiguous cases.
          </li>
          <li>
            <span className="font-medium">PDF parse.</span> Each PTR PDF is
            base64-encoded and sent to Claude Sonnet via the Anthropic API as
            a document block. Claude returns one JSON row per transaction:
            owner, asset, ticker, type, date, amount range, capital-gains
            flag, plus a confidence score. Cost is roughly $0.10–$0.20 per
            filing — PDFs render to image tokens and most run several pages.
          </li>
          <li>
            <span className="font-medium">Validation.</span> Each row is
            checked against the canonical list of STOCK Act amount ranges and
            transaction types. Rows that fail validation or score below 0.8
            confidence are held for human review and not surfaced until
            cleared.
          </li>
          <li>
            <span className="font-medium">Late-filing math.</span> A
            transaction is marked late if{" "}
            <code className="font-mono text-xs">
              tx_date + 45 days &lt; filed_date
            </code>
            . The 45-day mark is the hard statutory backstop.
          </li>
        </ol>
      </Section>

      <Section title="What this is — and is not">
        <p>
          This is a record of disclosed trades, not a judgment about them.
          Members of Congress legally trade individual stocks while serving.
          Every transaction on this site links to its source PDF. Nothing here
          stands without that link.
        </p>
      </Section>

      <Section title="Visual choices">
        <p>
          The site is organized around timelines because disclosure data is
          fundamentally temporal — when a trade happened, how often, in what
          clusters. Tables hide that structure. Time axes reveal it.
        </p>
        <p>
          Marks: green for purchases, red for sales. The per-ticker pages
          use up/down triangles instead, since the contrast carries more
          weight when every row is one company. Mark size maps to amount
          range on a log scale because filing values span four orders of
          magnitude. Late-filed trades carry an amber dot.
        </p>
      </Section>

      <Section title="Known limitations">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-medium">Ranges, not exact amounts.</span>{" "}
            All dollar values are statutory ranges. A row marked
            $1,001–$15,000 could be either end of that band.
          </li>
          <li>
            <span className="font-medium">Senate uses a different parser.</span>{" "}
            The Senate eFD portal serves trades as HTML tables, parsed deterministically. House PTRs are PDFs parsed with a vision model. Both feed the same downstream tables; no field is chamber-specific.
          </li>
          <li>
            <span className="font-medium">PDF parsing is automated.</span>{" "}
            Confidence below 0.8 holds a row in a review queue. A regression
            test set of hand-verified filings catches drift.
          </li>
          <li>
            <span className="font-medium">No options, no derivatives.</span>{" "}
            Reports include them but parsing currently focuses on common
            stock and ETFs.
          </li>
        </ul>
      </Section>

      <Section title="AI transparency">
        <p>
          The PDF-to-structured-row step uses Claude Sonnet via the Anthropic
          API. AI does not invent transactions or write editorial judgments.
          Every row links back to a government-filed PDF a human can open and
          verify.
        </p>
      </Section>

      <p className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-500">
        Federal government documents carry no copyright (17 U.S.C. §105). For
        informational and journalism purposes only. Not investment advice.
      </p>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10 space-y-3 text-sm leading-relaxed text-neutral-800">
      <h2 className="font-serif text-xl font-semibold text-neutral-900">
        {title}
      </h2>
      {children}
    </section>
  );
}
