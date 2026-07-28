import type { Metadata } from "next";
import Link from "next/link";
import AskClient from "@/components/ask-client";

export const metadata: Metadata = {
  // The root layout appends " | Delegation Decoded" via its title template, so
  // naming the site here too renders it twice in the tab and in search results.
  title: "Ask about your delegation",
  description:
    "Ask plain-language questions about any member of Congress, or set your state or address to focus on your delegation: votes, bills, committees, and campaign money, answered only from official records.",
};

export default function AskPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          Ask about your delegation
        </h1>
        <p className="mt-2 max-w-xl text-sm text-neutral-500">
          Ask in plain language about any member of Congress, or set your state
          or address to focus on your delegation. Answers come only from official
          records already in this site&apos;s database: Congress.gov, House and
          Senate roll calls, and FEC filings. If the records can&apos;t answer,
          it says so.
        </p>
      </div>

      <AskClient />

      <p className="mt-10 text-xs text-neutral-400">
        The assistant cannot browse the web or answer from general knowledge.
        Every answer lists the record categories checked and links named members
        and bills to pages you can verify. Read
        more about our sources on the{" "}
        <Link href="/about" className="underline hover:text-neutral-600">
          methodology page
        </Link>
        .
      </p>
    </div>
  );
}
