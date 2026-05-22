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

  // CapitolTrades divergence — last run of the audit script.
  // The script logs a bioguide-id-keyed summary into error_message; resolve
  // those IDs to member names so the public detail reads as journalism, not
  // as a debug dump.
  const divResult = await db.execute(sql`
    SELECT status, error_message, started_at
    FROM sync_log
    WHERE source = 'capitoltrades_divergence'
    ORDER BY id DESC
    LIMIT 1
  `);
  const divRow = divResult.rows[0] as
    | { status: string; error_message: string | null; started_at: string }
    | undefined;
  if (divRow && divRow.status === "failed") {
    checks.push({
      id: "divergence-capitoltrades",
      level: "warn",
      title: "Trade ingest is behind CapitolTrades",
      detail: await renderDivergenceDetail(divRow.error_message),
    });
  }

  // Recent failures.
  if (recentFailures.length > 0) {
    checks.push({
      id: "recent-failures",
      level: recentFailures.length >= 3 ? "crit" : "warn",
      title: `${recentFailures.length} failed sync run${recentFailures.length === 1 ? "" : "s"} in the last 14 days`,
      detail: await renderRecentFailuresDetail(recentFailures.slice(0, 3)),
    });
  }

  // PTR filings flagged for review.
  if (ptrFilings.review > 0) {
    checks.push({
      id: "ptr-review",
      level: "warn",
      title: `${ptrFilings.review} PTR filing${ptrFilings.review === 1 ? "" : "s"} flagged for review`,
      detail: "The vision parser couldn't confidently extract these. Underlying transactions are still loaded but should be hand-checked before citing.",
    });
  }

  if (ptrFilings.failed > 0) {
    checks.push({
      id: "ptr-failed",
      level: "crit",
      title: `${ptrFilings.failed} PTR filing${ptrFilings.failed === 1 ? "" : "s"} failed to parse`,
      detail: "These filings could not be parsed by the vision pipeline and will be retried on the next daily run.",
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

// ─── Detail renderers ────────────────────────────────────────────────────────
// The divergence audit and disclosures-house ingest log bioguide-keyed
// strings into sync_log.error_message. Those are fine for ops but read as
// gibberish to a journalist. These helpers resolve IDs to names and rewrite
// the detail in editorial voice.

async function lookupMemberNames(
  bioguideIds: string[]
): Promise<Record<string, string>> {
  if (bioguideIds.length === 0) return {};
  // Drizzle's tagged-template serializes an array into a comma-separated
  // parameter tuple, not a Postgres array literal, so ANY($1) breaks. Build
  // the IN-list as a sql.join of individually-bound values instead.
  const params = sql.join(bioguideIds.map((id) => sql`${id}`), sql`, `);
  const rows = await db.execute(sql`
    SELECT bioguide_id, last_name, first_name
    FROM members
    WHERE bioguide_id IN (${params})
  `);
  const out: Record<string, string> = {};
  for (const r of rows.rows as { bioguide_id: string; last_name: string; first_name: string }[]) {
    out[r.bioguide_id] = `${r.first_name} ${r.last_name}`;
  }
  return out;
}

async function renderDivergenceDetail(raw: string | null): Promise<string> {
  if (!raw) {
    return "One or more curated traders show newer activity on capitoltrades.com than in our database.";
  }
  // raw shape: "K000389: ours=2026-03-30 theirs=2026-04-29 drift=30 | M001157: ..."
  const entries = raw.split("|").map((s) => s.trim());
  const parsed = entries
    .map((e) => {
      const m = e.match(/^([A-Z]\d{6}):\s*ours=(\S+)\s+theirs=(\S+)\s+drift=(-?\d+)/);
      return m
        ? { bioguideId: m[1], ours: m[2], theirs: m[3], drift: Number(m[4]) }
        : null;
    })
    .filter((x): x is { bioguideId: string; ours: string; theirs: string; drift: number } => !!x)
    .filter((x) => x.drift > 0);
  if (parsed.length === 0) {
    return "One or more curated traders show newer activity on capitoltrades.com than in our database.";
  }
  const names = await lookupMemberNames(parsed.map((p) => p.bioguideId));
  parsed.sort((a, b) => b.drift - a.drift);
  const top = parsed.slice(0, 3).map((p) => {
    const name = names[p.bioguideId] ?? p.bioguideId;
    return `${name} (${p.drift}d behind, latest ${p.ours})`;
  });
  const tail =
    parsed.length > 3 ? ` and ${parsed.length - 3} other${parsed.length - 3 === 1 ? "" : "s"}` : "";
  return `${top.join(", ")}${tail}.`;
}

async function renderRecentFailuresDetail(runs: SyncRun[]): Promise<string> {
  // Surface the source/entity and the first short reason line, scrubbed of
  // file paths and env-variable names. Bioguide IDs in the message are
  // resolved to member names where possible.
  const ids = new Set<string>();
  for (const r of runs) {
    if (!r.errorMessage) continue;
    for (const m of r.errorMessage.matchAll(/\b([A-Z]\d{6})\b/g)) ids.add(m[1]);
  }
  const names = await lookupMemberNames([...ids]);
  return runs
    .map((r) => {
      const sourceLabel = SOURCE_LABELS[r.source] ?? r.source;
      const entity = ENTITY_LABELS[r.entityType] ?? r.entityType;
      const reason = scrubErrorMessage(r.errorMessage, names);
      return `${sourceLabel} (${entity}): ${reason}`;
    })
    .join(" · ");
}

const SOURCE_LABELS: Record<string, string> = {
  congress_gov: "Congress.gov",
  fec: "FEC",
  house_senate_xml: "House/Senate XML",
  rss: "RSS feeds",
  senate_efd: "Senate eFD",
  "disclosures-clerk.house.gov": "House Clerk",
  unitedstates: "@unitedstates",
  capitoltrades_divergence: "Drift audit",
};

const ENTITY_LABELS: Record<string, string> = {
  members: "members",
  committees: "committees",
  bills: "bills",
  campaign_finance: "finance",
  votes: "votes",
  press_releases: "press releases",
  disclosures: "Senate PTRs",
  ptr: "House PTRs",
  audit: "drift check",
};

function scrubErrorMessage(
  msg: string | null,
  names: Record<string, string>
): string {
  if (!msg) return "no message";
  let s = msg.split("\n")[0];
  // Resolve bioguide IDs.
  s = s.replace(/\b([A-Z]\d{6})\b/g, (m) => names[m] ?? m);
  // Drop dev syntax.
  s = s.replace(/\bours=\S+\s+theirs=\S+\s+drift=(-?\d+)/g, "$1 days behind CapitolTrades");
  // Strip file path references and env-var names.
  s = s.replace(/\.env(\.[a-z]+)?/g, "the environment");
  s = s.replace(/scripts\/\S+\.ts/g, "the ingest job");
  // Truncate to a sensible length, breaking on a word boundary.
  if (s.length > 200) {
    const cut = s.lastIndexOf(" ", 200);
    s = s.slice(0, cut > 100 ? cut : 200).trim() + "…";
  }
  return s;
}
