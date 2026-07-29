export const dynamic = "force-dynamic";

import { createHash, timingSafeEqual } from "crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { recentAskLog } from "@/lib/ask-log";

export const metadata: Metadata = {
  title: "Ask audit log",
  robots: { index: false, follow: false },
};

// Private browse feed over ask_log. Not a full auth system: access requires
// ?key=<ASK_ADMIN_KEY>, compared in constant time. With the env var unset the
// page is a 404 for everyone — locked is the default, not open. The key
// travels in the URL, so treat it like a shared bookmark secret and rotate it
// if it leaks; anything more sensitive than reading questions back deserves
// real auth first.
function authorized(key: string | undefined): boolean {
  const expected = process.env.ASK_ADMIN_KEY;
  if (!expected || !key) return false;
  const a = createHash("sha256").update(key).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const OUTCOME_TONE: Record<string, string> = {
  answered: "bg-emerald-50 text-emerald-700",
  not_found: "bg-amber-50 text-amber-700",
  out_of_scope: "bg-amber-50 text-amber-700",
  declined: "bg-amber-50 text-amber-700",
  error: "bg-red-100 text-red-700",
};

export default async function AskLogAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  if (!authorized(key)) notFound();

  const rows = await recentAskLog(100);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-serif text-3xl font-semibold tracking-tight">
        Ask audit log
      </h1>
      <p className="mt-2 text-sm text-neutral-600">
        Last {rows.length} requests, newest first, straight from{" "}
        <code className="font-mono text-[12px]">ask_log</code>. Full questions
        and answers are visible here and nowhere else public. Rows expire after
        90 days.
      </p>

      <ol className="mt-6 space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${OUTCOME_TONE[row.outcome] ?? "bg-neutral-100 text-neutral-600"}`}
              >
                {row.outcome}
                {row.errorClass ? ` · ${row.errorClass}` : ""}
              </span>
              <span className="font-mono text-[11px] text-neutral-400">
                #{row.id}
              </span>
              <time
                className="text-[11px] text-neutral-500"
                dateTime={row.createdAt.toISOString()}
              >
                {row.createdAt.toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                ET
              </time>
              <span className="text-[11px] text-neutral-500">
                {row.scopeType}
                {row.stateCode ? `:${row.stateCode}` : ""}
                {row.cacheHit ? " · cache" : row.provider ? ` · ${row.provider}` : ""}
                {row.latencyMs != null ? ` · ${(row.latencyMs / 1000).toFixed(1)}s` : ""}
                {row.citationCount != null ? ` · ${row.citationCount} cites` : ""}
                {row.citationCoverage != null
                  ? ` (${Math.round(row.citationCoverage * 100)}%)`
                  : ""}
              </span>
            </div>
            <p className="mt-2 text-sm font-medium text-neutral-900">
              {row.question}
            </p>
            {row.answer && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-700">
                  Answer
                </summary>
                <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">
                  {row.answer}
                </p>
              </details>
            )}
            {row.toolNames.length > 0 && (
              <p className="mt-2 text-[11px] text-neutral-400">
                Checked: {row.toolNames.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ol>
      {rows.length === 0 && (
        <p className="mt-6 text-sm text-neutral-500">No logged requests yet.</p>
      )}
    </div>
  );
}
