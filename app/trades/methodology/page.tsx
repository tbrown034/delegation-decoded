import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Methodology — Trades",
  description:
    "How Delegation Decoded collects and parses congressional financial disclosures.",
};

export default function TradesMethodologyPage() {
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
        <p className="mt-3 text-base text-neutral-700 dark:text-neutral-300">
          From government PDFs to a structured record of who traded what, when.
        </p>
      </header>

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
          Marks: triangles point up for purchases, down for sales. Mark size
          maps to amount range on a log scale because filing values span four
          orders of magnitude. Late-filed trades carry an amber dot.
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
            <span className="font-medium">Senate filings are partial.</span>{" "}
            The Senate eFD portal requires a terms-of-use cookie and produces
            scanned-image PDFs. House PTRs are the primary coverage today;
            Senate is in progress.
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

      <p className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-500 dark:border-neutral-800">
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
    <section className="mb-10 space-y-3 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
      <h2 className="font-serif text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </h2>
      {children}
    </section>
  );
}
