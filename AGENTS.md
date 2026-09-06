<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Delegation Decoded

Congressional accountability tracking organized by state delegation. 538 members, 50 delegations, 7 official data sources.

Purpose and scope are canon in `GOALS.md` — read it before feature decisions. Short version: portfolio proof first (ingestion, pipelines, display, grounded AI), users second; trades are quiet-tier, statements live at Capitol Releases.

## Stack

- Next.js 16 (App Router only, Server Components by default), React 19, TypeScript
- Tailwind CSS 4
- Neon serverless Postgres + Drizzle ORM
- /ask is dual-provider: OpenAI gpt-5.6-terra primary (Responses API), Anthropic claude-sonnet-5 fallback. Overrides: ASK_OPENAI_MODEL, ASK_ANTHROPIC_MODEL, ASK_PRIMARY_PROVIDER. Eval via scripts/eval-ask.ts. Anthropic Sonnet 4.6 for House PTR vision parsing
- Deployed on Vercel
- pnpm preferred

## Routes

```
/                            home: AI ask bars (location + question), 50-state grid, activity feed, data freshness
/about                       methodology, sources, limitations, AI transparency
/ask                         location-first dual-provider tool-calling lookup over scoped records
/api/ask                     grounded tool-loop endpoint (POST: question + stateCode)
/api/ask/locate              state name/code or address → delegation resolution
/find                        Census-Geocoder address-to-delegation lookup
/compare                     side-by-side state delegation comparison
/state/[code]                full delegation dashboard
/member/[bioguideId]         member profile (with per-member coverage card)
/bill/[billId]               bill detail with sponsor + cosponsors
/committee/[committeeId]     committee detail with member roster
/trades                      cross-member STOCK Act index
/trades/[bioguideId]         per-member trade list
/trades/companies/[ticker]   per-ticker holders
/trades/methodology          how the trade pipeline works + comparison vs CapitolTrades
/for-journalists             bulk CSV downloads + freshness + reporting tips
/health                      live pipeline status (coverage, sync_log, active issues)
/races                       national 2026 race index with state-verification labels
/race/[contestId]            current candidate field, primary history, and source provenance
/api/data/trades.csv         streaming CSV of every parsed transaction (all CSV routes share lib/csv.ts keysetCsvStream: one batch per pull, cancel-aware)
/api/data/filings.csv        streaming CSV of every PTR filing
/api/data/finance.csv        streaming CSV of campaign finance summaries
/api/photo/[bioguideId]      headshot proxy
/api/search                  JSON search across members, tickers, states
/feed.xml                    RSS of the 50 most recent disclosed trades
/sitemap.xml                 generated sitemap (every state, member, ticker)
/robots.txt                  allow all + sitemap pointer
```

Each of /, /state/[code], /member/[bioguideId], /trades/companies/[ticker] also generates a 1200x630 OG card via `opengraph-image.tsx`.

## Data pipeline

```
scripts/ingest/
  seed-states.ts          50 states + DC + 5 territories (FIPS codes)
  members.ts              @unitedstates → members + terms + photos (daily; retires members missing from the current file — deaths/resignations). `id.fec` is ordered oldest-first, so the stored FEC ID is the newest one whose office letter matches the member's current chamber — taking `[0]` hands chamber-switchers a campaign that stopped filing years ago.
  committees.ts           @unitedstates → committees + assignments
  bills.ts                Congress.gov API → bills + sponsorships
  votes.ts                Clerk House XML + Senate XML → roll calls + positions
  finance.ts              FEC API → campaign_finance (candidate totals per cycle). Field names in FECCandidateFinance must match /candidate/{id}/totals verbatim; a `total_` prefix that the endpoint does not use reads as undefined and the `|| 0` writes a silent zero.
  finance-committees.ts   FEC API → finance_committees + committee_finance + top_contributors. Contributors are individual donations aggregated by reported employer for the principal committee only, with FEC reporting categories (RETIRED, HOMEMAKER, SELF-EMPLOYED) filtered out. The heaviest FEC consumer and not expected to cover the roster in one run. Members are processed stalest-first by `finance_sync_state.last_attempt_at`, so an interrupted pass resumes instead of restarting and stranding the same tail; the run stops on its own at `FINANCE_RUN_BUDGET_MS` (45m in CI). It records the attempt rather than the write, so a member whose FEC lookup returns no committees cannot starve the queue. Pacing is not set here — `scripts/lib/fec-api.ts` throttles every FEC call from the gateway's own `x-ratelimit` headers (limit 60, refills over minutes); the old per-script 600ms constant was derived from a guess at the quota and drove the 2026-08-02 timeout. `/health` tracks the backlog, since a successful run no longer implies full coverage.
  candidates.ts           FEC Form 2 filings → election_candidates (2026 races, statutory candidates only; daily). Names come from `scripts/lib/fec-names.ts`, which flips "SURNAME, GIVEN JR." into "Given Surname Jr." and drops titles a filer typed into their own name. /ask's get_race_candidates cross-checks FEC "incumbent" filers against sitting members so a departed filer is never presented as the officeholder, and an FEC-only race page adds the sitting member as a labeled reference row when they have not filed.
  elections.ts            State-authority race adapter runner. Indiana backfills a completed primary; Delaware, Florida, Rhode Island, Michigan and Washington track current qualifying status, including inactive history. Nebraska reconciles its current federal list against certified primary results; petition candidates are admitted only when the Secretary of State's certification page is listed in `NEBRASKA_2026_PETITION_CERTIFICATIONS` (Osborn, Cohen), and a party with no primary results at all (the convention-nominating parties that joined the list Sep 6) is admitted on the state list as `state_general_list`, not as a certified nominee. Michigan reads the state's own report label: the November list was provisional filing evidence while the state called it "Unofficial", and became a verified general ballot when the state republished it as "Official" after the Aug 4 primary (the parser refuses a page carrying both labels or neither). Washington records its official top-two primary ballot and keeps party values labeled as candidate preferences. Rhode Island, Nebraska, Michigan and Washington reach verified-ballot coverage. Private Blob snapshots precede append-only status/result writes. FEC remains the labeled fallback where no adapter is covered.
  candidate-sites.ts      Bounded crawler for FEC committee-reported campaign sites. Supports exact-candidacy (--candidate=), two-letter state (--state=) and --force re-extraction. Private page snapshots precede strict OpenAI extraction with Anthropic fallback; input, output, call and run-token limits are separately bounded. A run skips a site only when its content hash is unchanged AND research already exists, so a failed extraction is retried rather than starved. Pages publish the verbatim source quote with its link; the model's paraphrase is never displayed. /ask reads the same quotes.
  member-biographies.ts   Bounded crawler for roster-verified house.gov/senate.gov sites. CMS recon + private snapshots precede evidence-linked extraction. Flags: --member=, --retry-errors, --missing-facts, --force. Skips a member only when the content hash is unchanged AND facts already exist. Facts publish to member pages as verbatim quotes grouped by fact_type, each linked to its source. /ask reads the same quotes with their fact_type.
  disclosures-house.ts    House Clerk PTR PDFs → Sonnet vision parse. PAUSED Aug 31 2026 (workflow step commented out in ingest-daily.yml): oversized filings abort the queue; rebuild with chunking before resuming. Senate ingest continues.
  disclosures-senate.ts   Senate eFD HTML tables → deterministic parse
  generate-events.ts      Synthesizes a unified activity feed across entities
  generate-briefs.ts      Composes per-state delegation briefs

scripts/lib/
  congress-api.ts         Congress.gov client w/ rate limiting
  fec-api.ts              FEC client w/ pagination
  unitedstates.ts         @unitedstates YAML/JSON fetcher
  parse-ptr.ts            Vision PTR parser (Sonnet 4.6) + BOGUS_TICKERS blacklist
```

All ingestion is idempotent (upserts via ON CONFLICT). Every run logs to `sync_log` with start/end/records/status. The homepage data-freshness panel reads directly from that log.

## Audit / QA scripts

```
scripts/
  apply-schema.ts         Apply scripts/schema.sql (idempotent)
  health-check.ts         Unified gate: coverage matrix + sync freshness + stuck-run detection. Exits 1 on crit; the daily and weekly workflows run it as the final step.
  cleanup-stuck-runs.ts   Mark sync_log rows stuck >6h in 'running' as failed. Read-only by default; pass --apply to write.
  coverage-audit.ts       Per-source / per-chamber coverage matrix and sync_log latest snapshot.
  compare-trades.ts       Per-member top-trader stats for the Dec 2025+ active window.
  state-check.ts          Filing parse_status counts, stuck filings.
  oddities-check.ts       Truncated descriptions, future dates, confidence buckets.
  low-confidence.ts       Rows below 80% confidence.
  missing-pdfs.ts         PDFs on disk vs DB.
  random-sample.ts        Random 20-row spot check.
  classify-biography-facts.ts   Assigns fact_type (education, military, public_service, career, family, origin, community, honors) to stored biography facts using deterministic rules over text already in the database. No crawling, no model calls, safe to re-run. Read-only by default; --apply writes, --reclassify re-evaluates rows that already have a type.
  review-candidate-research.ts  Read-only review queue by default; explicit --apply verifies or rejects campaign claims and prior-service records. Review is a spot-check and rejection path, not a publication gate: every non-rejected verbatim quote publishes automatically once the code finds it in the captured page.
  review-member-biographies.ts  Read-only official-biography queue; an applied decision requires --reviewer and stores review attribution. Same publication model as above.
  eval-candidate-extraction.ts  Paid synthetic smoke test for both campaign extraction providers; no database, crawler or Blob writes.
  eval-ask-sweep.ts       Paid breadth sweep for /ask: one national-scope roster question per delegation (56), generated and graded from the members table. Scope with SWEEP_LIMIT / SWEEP_STATES. Complements eval-ask.ts (depth) — sweeps find data-corner bugs (territories, at-large, DC), not capability regressions.

scripts/audit/
  divergence.ts           Compares our latest tx_date for curated high-volume traders against capitoltrades.com public profiles. Logs to sync_log under source='capitoltrades_divergence'; surfaces in /health when drift exceeds 4 days.
```

Run locally with `npx tsx scripts/<name>.ts`. Health is also exposed live at `/health` (server-side render, no caching).

## Conventions

- Server Components by default. Client Components only when interactivity demands it.
- Read queries live in `lib/queries.ts` and `lib/disclosure-queries.ts`. Avoid inline DB calls in pages.
- Schema is the source of truth in `scripts/schema.sql`; `lib/schema.ts` mirrors it for Drizzle. Apply changes via `apply-schema.ts`, not migrations.
- Every ingested table needs a unique key on its natural identity, not just a SERIAL id. `terms` shipped without one and silently accumulated a full duplicate set on all 26 runs before anyone noticed. Where a key column is nullable (`terms.district` is null for senators), the index needs `NULLS NOT DISTINCT` or the ON CONFLICT never matches.
- No dark mode. The shell rhymes with capitol-releases and open-cabinet (DM Sans + Source Serif + DM Mono via next/font, 3px neutral-800 accent bar, max-w-5xl shell, stone-50 footer with attribution block).
- `parse_status` of `'review'` means a row was inserted but the parser flagged it for human follow-up — surfaced in the UI with a warning badge.
- House PTR confidence < 80 → flagged. Don't filter these out; show them with a badge.
- Future-dated trades exist in source data (filer error or unfiled forward-dated transactions). The homepage chart clamps to the current month boundary.
- CSS Grid items containing long text content need `min-w-0` to allow `truncate` to take effect. The default `min-width: auto` on grid children otherwise expands the column to the widest content, breaking mobile layout.

## Production safety

This project is a job-application portfolio piece. Before shipping:
- `next build` must pass clean
- `/about` numbers must reconcile with what the homepage shows
- Methodology page must accurately describe what the pipeline actually does
- No throwaway scripts in `scripts/` — only ongoing ingest, audit, or schema tools
