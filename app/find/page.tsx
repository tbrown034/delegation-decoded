import type { Metadata } from "next";
import AskClient from "@/components/ask-client";

export const metadata: Metadata = {
  title: "Find your delegation",
  description:
    "Use a state or street address to find your two senators and House representative.",
};

export default function FindPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-widest text-neutral-400">
          Start with your address
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          Find your congressional delegation
        </h1>
        <p className="mt-2 max-w-xl text-sm text-neutral-500">
          Enter a state or US street address. A full address resolves the House
          district as well as both senators, then focuses the same records
          assistant used across the site on your delegation.
        </p>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-stone-50 p-5 sm:p-6">
        <AskClient />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-neutral-400">
        Address lookups are sent by POST to the public US Census Geocoder. The
        address is not placed in the page URL, answer cache or rate-limit table.
      </p>
    </div>
  );
}
