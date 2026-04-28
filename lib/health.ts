// Unified health-check report. Used by both `scripts/health-check.ts`
// (CLI gate for GitHub Actions) and the public /health route.
//
// One source of truth for "is the data pipeline healthy right now?"

import { db } from "./db";
import { sql } from "drizzle-orm";

export type HealthLevel = "ok" | "warn" | "crit";

export type SourceCoverage = {
  source: string;
  table: string;
  house: number;
  senate: number;
  totalRows: number;
};

export type SyncRun = {
  source: string;
  entityType: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  recordsCount: number | null;
  errorMessage: string | null;
  ageHours: number;
};

export type HealthCheck = {
  id: string;
  level: HealthLevel;
  title: string;
  detail: string;
};

export type HealthReport = {
  generatedAt: Date;
  level: HealthLevel;
  members: { house: number; senate: number };
  coverage: SourceCoverage[];
  latestRuns: SyncRun[];
  recentFailures: SyncRun[];
  stuckRuns: SyncRun[];
  ptrFilings: { parsed: number; review: number; failed: number; pending: number };
  lowConfidenceTrades: number;
  checks: HealthCheck[];
};

// Per-source thresholds for staleness (in hours).
// Beyond `warn`, the source is yellow. Beyond `crit`, red.
const STALENESS: Record<string, { warn: number; crit: number }> = {
  bills: { warn: 36, crit: 72 },
  votes: { warn: 36, crit: 72 },
  members: { warn: 24 * 9, crit: 24 * 14 },
  committees: { warn: 24 * 9, crit: 24 * 14 },
  campaign_finance: { warn: 24 * 9, crit: 24 * 14 },
  press_releases: { warn: 24 * 9, crit: 24 * 14 },
  disclosures: { warn: 24 * 9, crit: 24 * 21 },
};

const SOURCE_TABLES: { source: string; table: string }[] = [
  { source: "bills", table: "bill_sponsorships" },
  { source: "votes", table: "vote_positions" },
  { source: "campaign_finance", table: "campaign_finance" },
  { source: "press_releases", table: "press_releases" },
  { source: "disclosures", table: "disclosure_filings" },
  { source: "trades", table: "stock_transactions" },
  { source: "committees", table: "committee_assignments" },
];

export async function buildHealthReport(): Promise<HealthReport> {
  const generatedAt = new Date();

  const memberRows = await db.execute(sql`
    SELECT chamber, COUNT(*)::int AS n
    FROM members
    WHERE in_office = true
    GROUP BY chamber
  `);
  const members = { house: 0, senate: 0 };
  for (const r of memberRows.rows as { chamber: string; n: number }[]) {
    if (r.chamber === "house") members.house = r.n;
    if (r.chamber === "senate") members.senate = r.n;
  }

  const coverage: SourceCoverage[] = [];
  for (const { source, table } of SOURCE_TABLES) {
    const rows = await db.execute(sql`
      SELECT m.chamber, COUNT(DISTINCT t.bioguide_id)::int AS n,
             (SELECT COUNT(*)::int FROM ${sql.raw(table)}) AS total
      FROM members m
      JOIN ${sql.raw(table)} t ON t.bioguide_id = m.bioguide_id
      WHERE m.in_office = true
      GROUP BY m.chamber
    `);
    const r = rows.rows as { chamber: string; n: number; total: number }[];
    const house = r.find((x) => x.chamber === "house")?.n ?? 0;
    const senate = r.find((x) => x.chamber === "senate")?.n ?? 0;
    const totalRows = r[0]?.total ?? 0;
    coverage.push({ source, table, house, senate, totalRows });
  }

  const latestRowsResult = await db.execute(sql`
    SELECT
      source, entity_type, status, started_at, completed_at,
      records_count, error_message,
      EXTRACT(EPOCH FROM (now() - started_at)) / 3600.0 AS age_hours
    FROM sync_log
    WHERE id IN (SELECT MAX(id) FROM sync_log GROUP BY source, entity_type)
    ORDER BY started_at DESC
  `);
  const latestRuns: SyncRun[] = (latestRowsResult.rows as Array<Record<string, unknown>>).map(
    (r) => ({
      source: r.source as string,
      entityType: r.entity_type as string,
      status: r.status as string,
      startedAt: new Date(r.started_at as string),
      completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
      recordsCount: r.records_count as number | null,
      errorMessage: r.error_message as string | null,
      ageHours: Number(r.age_hours),
    })
  );

  const failuresResult = await db.execute(sql`
    SELECT
      source, entity_type, status, started_at, completed_at,
      records_count, error_message,
      EXTRACT(EPOCH FROM (now() - started_at)) / 3600.0 AS age_hours
    FROM sync_log
    WHERE status = 'failed' AND started_at > now() - interval '14 days'
    ORDER BY started_at DESC
    LIMIT 25
  `);
  const recentFailures: SyncRun[] = (failuresResult.rows as Array<Record<string, unknown>>).map(
    (r) => ({
      source: r.source as string,
      entityType: r.entity_type as string,
      status: r.status as string,
      startedAt: new Date(r.started_at as string),
      completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
      recordsCount: r.records_count as number | null,
      errorMessage: r.error_message as string | null,
      ageHours: Number(r.age_hours),
    })
  );

  const stuckResult = await db.execute(sql`
    SELECT
      source, entity_type, status, started_at, completed_at,
      records_count, error_message,
      EXTRACT(EPOCH FROM (now() - started_at)) / 3600.0 AS age_hours
    FROM sync_log
    WHERE status = 'running' AND started_at < now() - interval '6 hours'
    ORDER BY started_at DESC
  `);
  const stuckRuns: SyncRun[] = (stuckResult.rows as Array<Record<string, unknown>>).map(
    (r) => ({
      source: r.source as string,
      entityType: r.entity_type as string,
      status: r.status as string,
      startedAt: new Date(r.started_at as string),
      completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
      recordsCount: r.records_count as number | null,
      errorMessage: r.error_message as string | null,
      ageHours: Number(r.age_hours),
    })
  );

  const ptrRows = await db.execute(sql`
    SELECT parse_status, COUNT(*)::int AS n
    FROM disclosure_filings
    GROUP BY parse_status
  `);
  const ptrFilings = { parsed: 0, review: 0, failed: 0, pending: 0 };
  for (const r of ptrRows.rows as { parse_status: keyof typeof ptrFilings; n: number }[]) {
    ptrFilings[r.parse_status] = r.n;
  }

  const lowConf = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM stock_transactions
    WHERE confidence IS NOT NULL AND confidence < 80
  `);
  const lowConfidenceTrades = (lowConf.rows[0] as { n: number })?.n ?? 0;

  const checks: HealthCheck[] = [];

  // Coverage checks: a source covering < 60% of its expected chamber is a concern.
  // Some sources legitimately have partial coverage (PTRs are filed only when triggered;
  // press releases require a working RSS feed). Those get a softer threshold.
  const expectedFullCoverage = new Set([
    "bills",
    "votes",
    "campaign_finance",
    "committees",
  ]);
  for (const c of coverage) {
    const houseCov = members.house ? c.house / members.house : 0;
    const senateCov = members.senate ? c.senate / members.senate : 0;
    if (expectedFullCoverage.has(c.source)) {
      if (houseCov < 0.95 || senateCov < 0.95) {
        checks.push({
          id: `coverage-${c.source}`,
          level: houseCov < 0.85 || senateCov < 0.85 ? "crit" : "warn",
          title: `${c.source} coverage below threshold`,
          detail: `House ${(houseCov * 100).toFixed(0)}% · Senate ${(senateCov * 100).toFixed(0)}%`,
        });
      }
    }
  }

  // Staleness checks against the latest sync_log row per source.
  for (const r of latestRuns) {
    const t = STALENESS[r.source];
    if (!t) continue;
    if (r.ageHours > t.crit) {
      checks.push({
        id: `stale-${r.source}-${r.entityType}`,
        level: "crit",
        title: `${r.source}/${r.entityType} hasn't run in ${r.ageHours.toFixed(0)}h`,
        detail: `Threshold ${t.crit}h. Last status: ${r.status}.`,
      });
    } else if (r.ageHours > t.warn) {
      checks.push({
        id: `stale-${r.source}-${r.entityType}`,
        level: "warn",
        title: `${r.source}/${r.entityType} stale`,
        detail: `Last run ${r.ageHours.toFixed(0)}h ago (warn at ${t.warn}h).`,
      });
    }
  }

  // Stuck-run checks.
  for (const r of stuckRuns) {
    checks.push({
      id: `stuck-${r.source}-${r.entityType}-${r.startedAt.getTime()}`,
      level: "crit",
      title: `${r.source}/${r.entityType} stuck in 'running' for ${r.ageHours.toFixed(0)}h`,
      detail: `Started ${r.startedAt.toISOString()}. Likely a crashed run that needs cleanup.`,
    });
  }

  // Recent failures.
  if (recentFailures.length > 0) {
    checks.push({
      id: "recent-failures",
      level: recentFailures.length >= 3 ? "crit" : "warn",
      title: `${recentFailures.length} failed sync run${recentFailures.length === 1 ? "" : "s"} in the last 14 days`,
      detail: recentFailures
        .slice(0, 3)
        .map((r) => `${r.source}/${r.entityType}: ${r.errorMessage ?? "no message"}`)
        .join(" · "),
    });
  }

  // PTR filings flagged for review.
  if (ptrFilings.review > 0) {
    checks.push({
      id: "ptr-review",
      level: "warn",
      title: `${ptrFilings.review} PTR filing${ptrFilings.review === 1 ? "" : "s"} flagged for review`,
      detail: "Vision parser couldn't confidently extract these — surfaced with a warning badge in the UI.",
    });
  }

  if (ptrFilings.failed > 0) {
    checks.push({
      id: "ptr-failed",
      level: "crit",
      title: `${ptrFilings.failed} PTR filing${ptrFilings.failed === 1 ? "" : "s"} failed to parse`,
      detail: "Re-run scripts/ingest/disclosures-house.ts or escalate.",
    });
  }

  // Roll up to overall level: crit > warn > ok.
  let level: HealthLevel = "ok";
  for (const c of checks) {
    if (c.level === "crit") level = "crit";
    else if (c.level === "warn" && level !== "crit") level = "warn";
  }

  return {
    generatedAt,
    level,
    members,
    coverage,
    latestRuns,
    recentFailures,
    stuckRuns,
    ptrFilings,
    lowConfidenceTrades,
    checks,
  };
}
