export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { buildHealthReport, type HealthLevel } from "@/lib/health";

export const metadata: Metadata = {
  title: "Pipeline Health",
  description:
    "Live status of the Delegation Decoded data pipeline — coverage by source, recent run history, and any active issues.",
};

const LEVEL_COPY: Record<HealthLevel, { label: string; tone: string; bar: string }> = {
  ok: { label: "All systems normal", tone: "text-emerald-700", bar: "bg-emerald-500" },
  warn: { label: "Minor issues", tone: "text-amber-700", bar: "bg-amber-500" },
  crit: { label: "Critical issues", tone: "text-red-700", bar: "bg-red-500" },
};

function pct(num: number, den: number) {
  if (!den) return "0%";
  return `${Math.round((num / den) * 100)}%`;
}

function ageString(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(0)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export default async function HealthPage() {
  const report = await buildHealthReport();
  const tone = LEVEL_COPY[report.level];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-baseline gap-3">
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          Pipeline Health
        </h1>
        <span className={`text-sm ${tone.tone}`}>· {tone.label}</span>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-neutral-600">
        Live snapshot of every data source. Generated{" "}
        <time dateTime={report.generatedAt.toISOString()}>
          {report.generatedAt.toLocaleString("en-US", {
            timeZone: "America/New_York",
            dateStyle: "medium",
            timeStyle: "short",
          })}{" "}
          ET
        </time>
        . Re-runs on every page load.
      </p>

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          Coverage
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          {report.members.house} House and {report.members.senate} Senate members in office. Each row counts how many of those are represented in the named table.
        </p>

        <div className="mt-4 overflow-hidden rounded border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">House</th>
                <th className="px-3 py-2 text-right">Senate</th>
                <th className="px-3 py-2 text-right">Total rows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {report.coverage.map((c) => (
                <tr key={c.source}>
                  <td className="px-3 py-2 font-mono text-[12px]">{c.source}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.house}/{report.members.house}{" "}
                    <span className="text-neutral-400">({pct(c.house, report.members.house)})</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.senate}/{report.members.senate}{" "}
                    <span className="text-neutral-400">({pct(c.senate, report.members.senate)})</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                    {c.totalRows.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          Latest run per source
        </h2>
        <div className="mt-4 overflow-hidden rounded border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Records</th>
                <th className="px-3 py-2 text-right">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {report.latestRuns.map((r) => {
                const isFail = r.status === "failed";
                const isRunning = r.status === "running";
                return (
                  <tr key={`${r.source}-${r.entityType}`}>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.source}</td>
                    <td className="px-3 py-2 font-mono text-[12px] text-neutral-600">
                      {r.entityType}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
                          isFail
                            ? "bg-red-100 text-red-700"
                            : isRunning
                              ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                      {r.recordsCount?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                      {ageString(r.ageHours)} ago
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          Trade pipeline
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Parsed" value={report.ptrFilings.parsed} />
          <Stat label="Review" value={report.ptrFilings.review} tone={report.ptrFilings.review > 0 ? "warn" : "ok"} />
          <Stat label="Failed" value={report.ptrFilings.failed} tone={report.ptrFilings.failed > 0 ? "crit" : "ok"} />
          <Stat label="Pending" value={report.ptrFilings.pending} />
          <Stat label="Low-conf trades" value={report.lowConfidenceTrades} tone={report.lowConfidenceTrades > 0 ? "warn" : "ok"} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          Active issues
        </h2>
        {report.checks.length === 0 ? (
          <p className="mt-3 text-sm text-emerald-700">No issues detected.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {report.checks.map((c) => (
              <li
                key={c.id}
                className={`rounded border-l-2 bg-neutral-50 px-3 py-2 ${
                  c.level === "crit"
                    ? "border-red-500"
                    : c.level === "warn"
                      ? "border-amber-500"
                      : "border-emerald-500"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-neutral-900">{c.title}</p>
                  <span
                    className={`text-[10px] font-medium uppercase tracking-wider ${
                      c.level === "crit"
                        ? "text-red-700"
                        : c.level === "warn"
                          ? "text-amber-700"
                          : "text-emerald-700"
                    }`}
                  >
                    {c.level}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] text-neutral-600">
                  {c.detail}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-12 text-[12px] text-neutral-500">
        See{" "}
        <Link href="/about" className="underline hover:text-neutral-900">
          About & Methodology
        </Link>{" "}
        for what each source represents.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: number;
  tone?: HealthLevel;
}) {
  const t =
    tone === "crit"
      ? "text-red-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-neutral-900";
  return (
    <div className="rounded border border-neutral-200 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className={`mt-1 font-serif text-2xl font-semibold tabular-nums ${t}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
