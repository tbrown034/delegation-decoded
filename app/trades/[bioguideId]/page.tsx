import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getMemberByBioguideId } from "@/lib/queries";
import {
  getMemberTransactions,
  getMemberDisclosureSummary,
} from "@/lib/disclosure-queries";
import { STATE_BY_CODE } from "@/lib/states";
import { TradeTimeline } from "@/components/trade-timeline";

type Props = { params: Promise<{ bioguideId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { bioguideId } = await params;
  const member = await getMemberByBioguideId(bioguideId);
  if (!member) return { title: "Member Not Found" };
  return {
    title: `${member.fullName} — Disclosed trades`,
    description: `Stock trades disclosed by ${member.fullName} under the STOCK Act.`,
  };
}

const TX_LABEL: Record<string, string> = {
  P: "Purchase",
  S: "Sale",
  "S (partial)": "Partial sale",
  E: "Exchange",
};

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export default async function MemberTradesPage({ params }: Props) {
  const { bioguideId } = await params;
  const member = await getMemberByBioguideId(bioguideId);
  if (!member) notFound();

  const [transactions, summary] = await Promise.all([
    getMemberTransactions(bioguideId),
    getMemberDisclosureSummary(bioguideId),
  ]);

  const stateName = STATE_BY_CODE[member.stateCode]?.name || member.stateCode;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <nav className="mb-8 font-mono text-xs text-neutral-400">
        <Link href="/" className="no-underline hover:text-neutral-700">
          States
        </Link>
        <span className="mx-1.5">/</span>
        <Link
          href={`/state/${member.stateCode}`}
          className="no-underline hover:text-neutral-700"
        >
          {stateName}
        </Link>
        <span className="mx-1.5">/</span>
        <Link
          href={`/member/${bioguideId}`}
          className="no-underline hover:text-neutral-700"
        >
          {member.fullName}
        </Link>
        <span className="mx-1.5">/</span>
        <span>Trades</span>
      </nav>

      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          {member.fullName}
        </h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {member.party}{" "}
          {member.chamber === "senate" ? "Senator" : "Representative"} from{" "}
          {stateName} · STOCK Act Periodic Transaction Reports
        </p>
      </header>

      {summary.totalTransactions === 0 ? (
        <div className="rounded border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700">
          No PTR transactions on file for this member yet.
        </div>
      ) : (
        <>
          <section className="mb-6">
            <h2 className="sr-only">Trade timeline</h2>
            <TradeTimeline trades={transactions} />
          </section>

          <section className="mb-8 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <Stat label="Trades" value={summary.totalTransactions} />
            <Stat label="Filings" value={summary.totalFilings} />
            <Stat
              label="Buy / Sell"
              value={`${summary.buyCount} / ${summary.sellCount}`}
            />
            <Stat
              label="Late filings"
              value={summary.lateCount}
              accent={summary.lateCount > 0 ? "warn" : undefined}
            />
            <Stat label="Estimated low" value={fmtUsd(summary.estimatedMin)} />
            <Stat label="Estimated high" value={fmtUsd(summary.estimatedMax)} />
            <Stat
              label="Window"
              value={
                summary.earliestTrade && summary.latestTrade
                  ? `${summary.earliestTrade.slice(0, 4)}–${summary.latestTrade.slice(0, 4)}`
                  : "—"
              }
            />
          </section>

          <section>
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-neutral-500">
              All transactions
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
                  <tr>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Asset</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-neutral-100 dark:border-neutral-900"
                    >
                      <td className="py-2 pr-3 align-top font-mono text-xs">
                        {tx.txDate || "—"}
                        {tx.filedLate && (
                          <span className="ml-1 inline-block rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-900">
                            late
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        {TX_LABEL[tx.txType] || tx.txType}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        {tx.ticker && (
                          <Link
                            href={`/trades/companies/${tx.ticker}`}
                            className="font-mono font-semibold"
                          >
                            {tx.ticker}
                          </Link>
                        )}
                        {tx.ticker && <span className="text-neutral-400"> · </span>}
                        <span>{tx.assetDescription}</span>
                      </td>
                      <td className="py-2 pr-3 align-top font-mono text-xs">
                        {tx.amountRange}
                      </td>
                      <td className="py-2 align-top">
                        <a
                          href={tx.pdfUrl}
                          className="text-xs text-neutral-500 underline hover:text-neutral-800"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          PDF
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: "warn";
}) {
  const accentClass =
    accent === "warn" ? "text-amber-700 dark:text-amber-300" : "";
  return (
    <div className="rounded border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-base ${accentClass}`}>{value}</div>
    </div>
  );
}
