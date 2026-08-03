// Unified health-check report. Used by both `scripts/health-check.ts`
// (CLI gate for GitHub Actions) and the public /health route.
//
// One source of truth for "is the data pipeline healthy right now?"

import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  getCandidateResearchHealth,
  getElectionCoverageMatrix,
  getOverdueElectionCertifications,
} from "./elections/queries";
import type { StateRaceCoverage } from "./elections/types";
import { getMemberBiographyHealth } from "./biography-queries";
import { GLOBAL_DAILY_PROVIDER_ATTEMPT_LIMIT } from "./ask-limits";

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
  electionCoverage: StateRaceCoverage[];
  candidateResearch: {
    verifiedSites: number;
    blockedSites: number;
    crawlErrors: number;
    pendingClaims: number;
    verifiedClaims: number;
    pendingService: number;
    verifiedService: number;
  };
  memberBiographies: {
    verifiedSites: number;
    crawlErrors: number;
    membersWithVerifiedFacts: number;
    pendingFacts: number;
    verifiedFacts: number;
  };
  // The FEC finance-committee crawl cannot cover the roster in one run, so
  // "did the run succeed" says nothing about coverage. Track the backlog.
  financeStaleness: {
    totalMembers: number;
    staleMembers: number;
    neverAttempted: number;
    errorMembers: number;
  };
  ask: AskHealth;
  checks: HealthCheck[];
};

export type AskWindowStats = {
  total: number;
  answered: number;
  notFound: number;
  outOfScope: number;
  declined: number;
  errors: number;
  cacheHits: number;
  fallbacks: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  avgCitationCoverage: number | null;
  zeroCitationAnswered: number;
};

export type AskHealth = {
  window24h: AskWindowStats;
  window7d: AskWindowStats;
  providerAttemptsToday: number;
  providerAttemptLimit: number;
};

async function askWindowStats(interval: string): Promise<AskWindowStats> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE outcome = 'answered')::int AS answered,
      COUNT(*) FILTER (WHERE outcome = 'not_found')::int AS not_found,
      COUNT(*) FILTER (WHERE outcome = 'out_of_scope')::int AS out_of_scope,
      COUNT(*) FILTER (WHERE outcome = 'declined')::int AS declined,
      COUNT(*) FILTER (WHERE outcome = 'error')::int AS errors,
      COUNT(*) FILTER (WHERE cache_hit)::int AS cache_hits,
      COUNT(*) FILTER (WHERE fallback_used)::int AS fallbacks,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE latency_ms IS NOT NULL AND cache_hit = false AND outcome <> 'error'))::int AS p50_ms,
      (percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE latency_ms IS NOT NULL AND cache_hit = false AND outcome <> 'error'))::int AS p95_ms,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens,
      AVG(citation_coverage) FILTER (WHERE outcome = 'answered') AS avg_coverage,
      COUNT(*) FILTER (WHERE outcome = 'answered' AND citation_count = 0)::int AS zero_citation_answered
    FROM ask_log
    WHERE created_at > now() - ${interval}::interval
  `);
  const r = result.rows[0] as Record<string, unknown>;
  return {
    total: Number(r.total ?? 0),
    answered: Number(r.answered ?? 0),
    notFound: Number(r.not_found ?? 0),
    outOfScope: Number(r.out_of_scope ?? 0),
    declined: Number(r.declined ?? 0),
    errors: Number(r.errors ?? 0),
    cacheHits: Number(r.cache_hits ?? 0),
    fallbacks: Number(r.fallbacks ?? 0),
    p50LatencyMs: r.p50_ms == null ? null : Number(r.p50_ms),
    p95LatencyMs: r.p95_ms == null ? null : Number(r.p95_ms),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    avgCitationCoverage: r.avg_coverage == null ? null : Number(r.avg_coverage),
    zeroCitationAnswered: Number(r.zero_citation_answered ?? 0),
  };
}

// Sources deliberately paused. Their historical failures stop tripping the
// crit alarms, but the pause itself renders as a visible warn so it is never
// silent. Remove the entry to resume normal alerting.
const PAUSED_SOURCES: Record<string, string> = {
  "disclosures-clerk.house.gov":
    "House PTR ingest paused July 20, 2026: the upstream API key is rejected and the scheduled job is disabled pending key rotation. Already-ingested trades remain published; Senate PTR ingest is unaffected.",
};

// Per-entity thresholds for staleness (in hours), keyed by sync_log
// entity_type. Beyond `warn`, the source is yellow. Beyond `crit`, red.
// One-shot backfill entities (votes_backfill_118 etc.) deliberately have no
// entry — a backfill that ran once is not stale.
const STALENESS: Record<string, { warn: number; crit: number }> = {
  bills: { warn: 36, crit: 72 },
  votes: { warn: 36, crit: 72 },
  members: { warn: 24 * 9, crit: 24 * 14 },
  committees: { warn: 24 * 9, crit: 24 * 14 },
  campaign_finance: { warn: 24 * 9, crit: 24 * 14 },
  finance_committees: { warn: 24 * 9, crit: 24 * 14 },
  press_releases: { warn: 24 * 9, crit: 24 * 14 },
  disclosures: { warn: 24 * 9, crit: 24 * 21 },
  elections: { warn: 36, crit: 72 },
  candidate_research: { warn: 24 * 9, crit: 24 * 14 },
  member_biography: { warn: 24 * 9, crit: 24 * 14 },
};

const SOURCE_TABLES: { source: string; table: string }[] = [
  { source: "bills", table: "bill_sponsorships" },
  { source: "votes", table: "vote_positions" },
  { source: "campaign_finance", table: "campaign_finance" },
  { source: "finance_committees", table: "finance_committees" },
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
    const chamberCounts = new Map(r.map((x) => [x.chamber, x.n]));
    const house = chamberCounts.get("house") ?? 0;
    const senate = chamberCounts.get("senate") ?? 0;
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
      failed.source, failed.entity_type, failed.status, failed.started_at,
      failed.completed_at, failed.records_count, failed.error_message,
      EXTRACT(EPOCH FROM (now() - failed.started_at)) / 3600.0 AS age_hours
    FROM sync_log failed
    WHERE failed.status = 'failed'
      AND failed.started_at > now() - interval '14 days'
      AND failed.id IN (
        SELECT MAX(latest.id)
        FROM sync_log latest
        GROUP BY latest.source, latest.entity_type
      )
    ORDER BY failed.started_at DESC
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

  const [electionCoverage, overdueCertifications, candidateResearch, memberBiographies] = await Promise.all([
    getElectionCoverageMatrix(),
    getOverdueElectionCertifications(),
    getCandidateResearchHealth(),
    getMemberBiographyHealth(),
  ]);

  const financeStalenessRows = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_members,
      COUNT(*) FILTER (
        WHERE s.last_attempt_at IS NULL
           OR s.last_attempt_at < now() - interval '14 days'
      )::int AS stale_members,
      COUNT(*) FILTER (WHERE s.last_attempt_at IS NULL)::int AS never_attempted,
      COUNT(*) FILTER (WHERE s.last_status = 'error')::int AS error_members
    FROM members m
    LEFT JOIN finance_sync_state s ON s.bioguide_id = m.bioguide_id
    WHERE m.in_office = true AND m.fec_candidate_id IS NOT NULL
  `);
  const financeStalenessRow = financeStalenessRows.rows[0] as
    | {
        total_members: number;
        stale_members: number;
        never_attempted: number;
        error_members: number;
      }
    | undefined;
  const financeStaleness = {
    totalMembers: financeStalenessRow?.total_members ?? 0,
    staleMembers: financeStalenessRow?.stale_members ?? 0,
    neverAttempted: financeStalenessRow?.never_attempted ?? 0,
    errorMembers: financeStalenessRow?.error_members ?? 0,
  };

  const [ask24h, ask7d, attemptsResult] = await Promise.all([
    askWindowStats("24 hours"),
    askWindowStats("7 days"),
    db.execute(sql`
      SELECT COALESCE(SUM(count), 0)::int AS n
      FROM ask_rate_limits
      WHERE bucket = 'global-provider-attempts'
        AND window_start = date_trunc('day', now())
    `),
  ]);
  const ask: AskHealth = {
    window24h: ask24h,
    window7d: ask7d,
    providerAttemptsToday: Number((attemptsResult.rows[0] as { n: number })?.n ?? 0),
    providerAttemptLimit: GLOBAL_DAILY_PROVIDER_ATTEMPT_LIMIT,
  };

  const checks: HealthCheck[] = [];

  // Ask assistant alarms. Small samples stay quiet: an error rate over a
  // handful of questions says nothing.
  if (ask24h.total >= 10) {
    const errorRate = ask24h.errors / ask24h.total;
    if (errorRate > 0.3) {
      checks.push({
        id: "ask-error-rate",
        level: errorRate > 0.5 ? "crit" : "warn",
        title: `Ask error rate at ${(errorRate * 100).toFixed(0)}% over the last 24h`,
        detail: `${ask24h.errors} of ${ask24h.total} questions failed. Check provider status and the ask_log error_class mix.`,
      });
    }
  }
  if (
    ask24h.answered >= 10 &&
    ask24h.avgCitationCoverage != null &&
    ask24h.avgCitationCoverage < 0.5
  ) {
    checks.push({
      id: "ask-citation-coverage",
      level: "warn",
      title: `Ask citation coverage fell to ${(ask24h.avgCitationCoverage * 100).toFixed(0)}%`,
      detail:
        "Answered responses are citing records for fewer of their sentences than usual. Review recent ask_log rows before trusting new answers.",
    });
  }
  if (ask.providerAttemptsToday >= ask.providerAttemptLimit * 0.8) {
    checks.push({
      id: "ask-provider-budget",
      level: ask.providerAttemptsToday >= ask.providerAttemptLimit ? "crit" : "warn",
      title: `Ask provider budget at ${ask.providerAttemptsToday}/${ask.providerAttemptLimit} today`,
      detail:
        "At the cap, the assistant declines new questions until midnight UTC. Records pages stay up regardless.",
    });
  }

  if (candidateResearch.crawlErrors > 0) {
    checks.push({
      id: "candidate-crawl-errors",
      level: "warn",
      title: `${candidateResearch.crawlErrors} verified campaign site${candidateResearch.crawlErrors === 1 ? " has" : "s have"} crawl errors`,
      detail: "The site link remains visible, but no extracted claim is published unless its evidence passes human review.",
    });
  }

  if (candidateResearch.blockedSites > 0) {
    checks.push({
      id: "candidate-site-discovery-blocked",
      level: "warn",
      title: `${candidateResearch.blockedSites} candidate${candidateResearch.blockedSites === 1 ? " has" : "s have"} no current FEC campaign website`,
      detail: "These verified candidacies remain visible, but campaign-site claims stay unavailable unless a current principal or authorized committee reports a website.",
    });
  }

  // The finance-committee crawl is budget-limited and resumes across runs, so
  // a single run finishing is not evidence the roster is covered. Without this
  // check the tail it never reached stays invisible: the run reports success,
  // and the missing members simply have no contributor rows.
  if (financeStaleness.staleMembers > 0) {
    const share =
      financeStaleness.staleMembers / Math.max(financeStaleness.totalMembers, 1);
    // "Falling behind" only means something once the crawl has actually run.
    // Before the first pass every member is legitimately unattempted, and a
    // crit there would fail the workflow for a backlog the crawl has not had
    // a chance to work yet.
    const started = financeStaleness.neverAttempted < financeStaleness.totalMembers;
    checks.push({
      id: "finance-committee-staleness",
      level: started && share > 0.5 ? "crit" : "warn",
      title: started
        ? `${financeStaleness.staleMembers} of ${financeStaleness.totalMembers} members have finance data older than 14 days`
        : `Finance-committee crawl has not completed a first pass (${financeStaleness.totalMembers} members queued)`,
      detail:
        "The FEC crawl processes members stalest-first within a per-run budget, so one run is not expected to cover the roster. A backlog that stops shrinking means runs are not keeping pace — check the run's budget-limited stop line and the FEC rate-limit cooldowns.",
    });
  }

  if (memberBiographies.crawlErrors > 0) {
    checks.push({
      id: "member-biography-crawl-errors",
      level: "warn",
      title: `${memberBiographies.crawlErrors} official member site${memberBiographies.crawlErrors === 1 ? " has" : "s have"} biography crawl errors`,
      detail: "No biography fact is published or supplied to Ask unless its official-site quote passes human review.",
    });
  }

  for (const overdue of overdueCertifications) {
    checks.push({
      id: `election-certification-${overdue.stateCode}-${overdue.title}`,
      level: "warn",
      title: `${overdue.stateCode} certification has exceeded its expectation window`,
      detail: `${overdue.title}: ${overdue.electionDate} remains unofficial after the source's ${overdue.expectationDays}-day default window. This is an alert, not a claim that a statutory deadline was missed.`,
    });
  }

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

  // Staleness checks against the latest sync_log row per entity. (Keyed by
  // entity_type: sync_log.source holds the upstream name like congress_gov,
  // and indexing the thresholds by it left every staleness check dead.)
  for (const r of latestRuns) {
    const t = STALENESS[r.entityType];
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

  // Paused sources: surface the pause itself, and keep their old failures
  // out of the alarms below — a deliberate pause is not an incident.
  const activeFailures = recentFailures.filter(
    (r) => !(r.source in PAUSED_SOURCES)
  );
  for (const [src, note] of Object.entries(PAUSED_SOURCES)) {
    checks.push({
      id: `paused-${src}`,
      level: "warn",
      title: `${SOURCE_LABELS[src] ?? src} ingest paused`,
      detail: note,
    });
  }

  // Dedicated alert for upstream-API auth failures so they don't get buried
  // in the generic failure detail. Only an unrecovered latest failure counts;
  // a later successful run resolves the incident immediately.
  const authFailures = activeFailures.filter((r) =>
    /\b(?:401|403)\b.*(?:authentication_error|invalid[_ -]?(?:x-)?api[_ -]?key|invalid[_ -]?token|API_KEY_INVALID)/i.test(
      r.errorMessage ?? ""
    )
  );
  if (authFailures.length > 0) {
    const sources = Array.from(
      new Set(authFailures.map((r) => SOURCE_LABELS[r.source] ?? r.source))
    );
    checks.push({
      id: "auth-failure",
      level: "crit",
      title: `Upstream API key rejected (${sources.join(", ")})`,
      detail:
        "The configured key is being returned as invalid by the upstream service. Until the secret is rotated, this source can't ingest new data.",
    });
  }

  // Unrecovered recent failures. Historical failures remain in sync_log for
  // auditability but a later success must restore current health.
  if (activeFailures.length > 0) {
    checks.push({
      id: "recent-failures",
      level: activeFailures.length >= 3 ? "crit" : "warn",
      title: `${activeFailures.length} unrecovered sync failure${activeFailures.length === 1 ? "" : "s"} in the last 14 days`,
      detail: await renderRecentFailuresDetail(activeFailures.slice(0, 3)),
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

  // Finance-committee layer: populated by the weekly finance-committees
  // ingest. Empty tables are a visible warn, not silence, so the gap between
  // shipping the feature and its first ingest run is never invisible.
  const fincomResult = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM finance_committees) AS committees,
      (SELECT COUNT(*)::int FROM top_contributors) AS contributors
  `);
  const fincom = fincomResult.rows[0] as { committees: number; contributors: number };
  if ((fincom?.committees ?? 0) === 0 || (fincom?.contributors ?? 0) === 0) {
    checks.push({
      id: "finance-committees-empty",
      level: "warn",
      title:
        (fincom?.committees ?? 0) === 0
          ? "Finance committees not yet ingested"
          : "Top contributors not yet ingested",
      detail:
        "The weekly finance-committee ingest has not completed a run. Until it does, leadership-PAC and top-contributor detail is missing from member finance answers.",
    });
  }

  // Backfill integrity: a successful historical votes backfill whose rows
  // later disappear means data loss, not staleness.
  const backfillResult = await db.execute(sql`
    SELECT DISTINCT entity_type
    FROM sync_log
    WHERE status = 'success' AND entity_type LIKE 'votes_backfill_%'
  `);
  for (const r of backfillResult.rows as { entity_type: string }[]) {
    const congress = parseInt(r.entity_type.replace("votes_backfill_", ""), 10);
    if (!Number.isInteger(congress)) continue;
    const countResult = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM votes WHERE congress = ${congress}`
    );
    const n = (countResult.rows[0] as { n: number })?.n ?? 0;
    if (n === 0) {
      checks.push({
        id: `backfill-votes-${congress}`,
        level: "crit",
        title: `Backfilled ${congress}th-Congress votes are missing`,
        detail: `A successful ${congress}th-Congress backfill is on record but the votes table has no rows for that congress.`,
      });
    }
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
    electionCoverage,
    candidateResearch,
    memberBiographies,
    financeStaleness,
    ask,
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
  const parsed = entries.reduce<
    { bioguideId: string; ours: string; theirs: string; drift: number }[]
  >((acc, e) => {
    const m = e.match(/^([A-Z]\d{6}):\s*ours=(\S+)\s+theirs=(\S+)\s+drift=(-?\d+)/);
    if (m) {
      const item = { bioguideId: m[1], ours: m[2], theirs: m[3], drift: Number(m[4]) };
      if (item.drift > 0) acc.push(item);
    }
    return acc;
  }, []);
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
  // Roll the last few failed runs into one line: the source/entity and a
  // short, scrubbed reason. Bioguide IDs are resolved to names; raw
  // env-variable names and ours=/theirs= debug syntax are filtered.
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

// Env-variable names that should never appear in journalist-facing copy.
// Match a token that looks like a Postgres/Anthropic/etc. secret name.
const SECRET_NAME = /\b[A-Z][A-Z0-9_]{6,}(?:_KEY|_URL|_TOKEN|_SECRET|_PASSWORD)\b/g;

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
  finance_committees: "finance committees",
  votes: "votes",
  votes_backfill_118: "118th-Congress votes backfill",
  bills_backfill_118: "118th-Congress bills backfill",
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
  // Authentication errors from upstream APIs come back as opaque JSON.
  // Recognize the common shapes and rewrite the whole error envelope —
  // from the HTTP status code through the trailing }} of the response body
  // — to journalist-readable copy. Without consuming the JSON envelope,
  // the closing braces would be left orphaned in the output.
  // Match the whole HTTP-status + JSON envelope greedily (up to the next
  // sync_log separator) so the closing braces and request_id don't bleed
  // out into the rendered detail.
  const AUTH_SHAPE =
    /\b(?:401|403)\b\s*\{[^·|]*?(?:authentication_error|invalid[_ -]?(?:x-)?api[_ -]?key|invalid[_ -]?token|API_KEY_INVALID)[^·|]*\}/gi;
  s = s.replace(
    AUTH_SHAPE,
    "the configured API key was rejected by the upstream service"
  );
  // Drop dev syntax.
  s = s.replace(/\bours=\S+\s+theirs=\S+\s+drift=(-?\d+)/g, "$1 days behind CapitolTrades");
  // Filter drift=0 noise — the audit summary lists every sampled member,
  // including those that are caught up; readers only care about real drift.
  s = s.replace(/\b[A-Za-z][A-Za-z .'-]+: 0 days behind CapitolTrades\s*(\||$)/g, "");
  s = s.replace(/\s*\|\s*$/g, "");
  // Replace file-path references and any UPPER_SNAKE secret name with
  // generic language so journalist-facing copy never names internal config.
  s = s.replace(/\.env(\.[a-z]+)?/g, "the environment");
  s = s.replace(/scripts\/\S+\.ts/g, "the ingest job");
  s = s.replace(SECRET_NAME, "an API key");
  // Strip leftover JSON fragments from API error bodies once the meaningful
  // pieces have been rewritten above.
  s = s.replace(/\{[^{}]*"request_id"[^{}]*\}/g, "");
  s = s.replace(/\{[^{}]*"type"\s*:\s*"error"[^{}]*\}/g, "");
  // "terminated" from undici is opaque; soften it.
  s = s.replace(/\bTypeError:\s*terminated\b/g, "upstream connection dropped");
  s = s.replace(/^terminated$/g, "upstream connection dropped");
  // Collapse runs of whitespace introduced by deletions above.
  s = s.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",");
  // Truncate to a sensible length, breaking on a word boundary.
  if (s.length > 200) {
    const cut = s.lastIndexOf(" ", 200);
    s = s.slice(0, cut > 100 ? cut : 200).trim() + "…";
  }
  return s.trim();
}
