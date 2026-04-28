// Run with: npx tsx scripts/health-check.ts
//
// CLI wrapper around buildHealthReport. Exits 1 if the overall level is 'crit'
// so it can be used as a final-step gate in GitHub Actions.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { buildHealthReport, type HealthLevel } from "../lib/health";

const COLORS: Record<HealthLevel, string> = {
  ok: "\x1b[32m",
  warn: "\x1b[33m",
  crit: "\x1b[31m",
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function paint(level: HealthLevel, label: string) {
  return `${COLORS[level]}${BOLD}${label.toUpperCase()}${RESET}`;
}

async function main() {
  const report = await buildHealthReport();

  console.log(`\n${paint(report.level, report.level)} — generated ${report.generatedAt.toISOString()}\n`);

  console.log("=== Members ===");
  console.log(`  House:  ${report.members.house}`);
  console.log(`  Senate: ${report.members.senate}\n`);

  console.log("=== Coverage (members covered / chamber total) ===");
  for (const c of report.coverage) {
    const hPct = report.members.house ? ((c.house / report.members.house) * 100).toFixed(0) : "0";
    const sPct = report.members.senate ? ((c.senate / report.members.senate) * 100).toFixed(0) : "0";
    console.log(
      `  ${c.source.padEnd(18)} House ${String(c.house).padStart(3)}/${report.members.house} (${hPct}%)  ` +
        `Senate ${String(c.senate).padStart(3)}/${report.members.senate} (${sPct}%)  · ${c.totalRows.toLocaleString()} rows`
    );
  }

  console.log("\n=== Latest sync_log per (source, entity_type) ===");
  for (const r of report.latestRuns) {
    const ageDays = (r.ageHours / 24).toFixed(1);
    console.log(
      `  ${r.source.padEnd(28)} ${r.entityType.padEnd(18)} ${r.status.padEnd(10)} ` +
        `${ageDays}d ago  ${r.recordsCount ?? "—"} records`
    );
  }

  console.log("\n=== PTR filings ===");
  console.log(`  parsed:  ${report.ptrFilings.parsed}`);
  console.log(`  review:  ${report.ptrFilings.review}`);
  console.log(`  failed:  ${report.ptrFilings.failed}`);
  console.log(`  pending: ${report.ptrFilings.pending}`);
  console.log(`  low-confidence trades: ${report.lowConfidenceTrades}`);

  if (report.checks.length === 0) {
    console.log(`\n${paint("ok", "no issues")}`);
  } else {
    console.log("\n=== Issues ===");
    for (const c of report.checks) {
      console.log(`  ${paint(c.level, c.level.padEnd(4))} ${c.title}`);
      console.log(`         ${c.detail}`);
    }
  }

  console.log();

  // Critical → exit 1 so CI fails loudly. Warnings are visible but non-blocking.
  if (report.level === "crit") {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n\x1b[31m\x1b[1mhealth-check crashed\x1b[0m");
  console.error(err);
  process.exit(2);
});
