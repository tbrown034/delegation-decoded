<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Delegation Decoded

Congressional accountability tracking organized by state delegation. 538 members, 50 delegations, 7 official data sources.

## Stack

- Next.js 16 (App Router only, Server Components by default), React 19, TypeScript
- Tailwind CSS 4
- Neon serverless Postgres + Drizzle ORM
- Anthropic Sonnet 4.6 for House PTR vision parsing only
- Deployed on Vercel
- pnpm preferred

## Routes

```
/                            home: 50-state grid, trades summary, activity feed, data freshness
/about                       methodology, sources, limitations, AI transparency
/find                        Census-Geocoder address-to-delegation lookup
/compare                     side-by-side state delegation comparison
/state/[code]                full delegation dashboard
/member/[bioguideId]         member profile
/trades                      cross-member STOCK Act index
/trades/[bioguideId]         per-member trade list
/trades/companies/[ticker]   per-ticker holders
/trades/methodology          how the trade pipeline works
/api/photo/[bioguideId]      headshot proxy
```

## Data pipeline

```
scripts/ingest/
  seed-states.ts          50 states + DC + 5 territories (FIPS codes)
  members.ts              @unitedstates → members + terms + photos
  committees.ts           @unitedstates → committees + assignments
  bills.ts                Congress.gov API → bills + sponsorships
  votes.ts                Clerk House XML + Senate XML → roll calls + positions
  finance.ts              FEC API → campaign_finance + top_contributors
  disclosures-house.ts    House Clerk PTR PDFs → Sonnet vision parse
  disclosures-senate.ts   Senate eFD HTML tables → deterministic parse
  press-releases.ts       Member office RSS feeds → press_releases
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
  state-check.ts          Filing parse_status counts, stuck filings
  oddities-check.ts       Truncated descriptions, future dates, confidence buckets
  low-confidence.ts       Rows below 80% confidence
  missing-pdfs.ts         PDFs on disk vs DB
  random-sample.ts        Random 20-row spot check
```

Run locally with `npx tsx scripts/<name>.ts`.

## Conventions

- Server Components by default. Client Components only when interactivity demands it.
- Read queries live in `lib/queries.ts` and `lib/disclosure-queries.ts`. Avoid inline DB calls in pages.
- Schema is the source of truth in `scripts/schema.sql`; `lib/schema.ts` mirrors it for Drizzle. Apply changes via `apply-schema.ts`, not migrations.
- `parse_status` of `'review'` means a row was inserted but the parser flagged it for human follow-up — surfaced in the UI with a warning badge.
- House PTR confidence < 80 → flagged. Don't filter these out; show them with a badge.
- Future-dated trades exist in source data (filer error or unfiled forward-dated transactions). The homepage chart clamps to the current month boundary.

## Production safety

This project is a job-application portfolio piece. Before shipping:
- `next build` must pass clean
- `/about` numbers must reconcile with what the homepage shows
- Methodology page must accurately describe what the pipeline actually does
- No throwaway scripts in `scripts/` — only ongoing ingest, audit, or schema tools
