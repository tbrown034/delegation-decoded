# Delegation Decoded

Congressional accountability tracking, organized by state delegation.

Delegation Decoded turns public congressional records into state-level dashboards for reporters, researchers, and civic-minded voters. It tracks members of Congress, committee assignments, legislation, campaign finance, roll-call votes, and side-by-side comparisons using official and public-interest data sources.

## Why This Exists

Most congressional tools are organized around individual politicians, committees, or bills. Real-world accountability is often local: what is my state delegation doing, who represents it on key committees, how are they voting, and where is campaign money coming from?

This project treats each state delegation as the primary unit of analysis.

## Current Features

- 50-state dashboard with delegation size, party composition, data freshness, and recent activity.
- State pages with senators, representatives, recent legislation, committee coverage, and fundraising rankings.
- Member profiles with biography, sponsored legislation, vote summaries, committee seats, campaign finance, and top contributors.
- Comparison tools for member-vs-member, state-vs-state, and within-delegation views.
- Methodology page with live data counts, source explanations, sync history, limitations, and AI transparency.
- TypeScript ingestion scripts for members, committees, bills, votes, campaign finance, generated events, and delegation briefs.

## Data Sources

| Source | Used For |
| --- | --- |
| `@unitedstates/congress-legislators` | Current members, terms, committees, social links, cross-reference IDs |
| Congress.gov API | Bills, sponsorships, cosponsorships, legislative metadata |
| FEC API | Candidate financial totals, receipts, disbursements, contribution breakdowns |
| House and Senate vote feeds | Roll-call vote records and member positions |
| `@unitedstates/images` | Congressional headshots |

The app is intentionally transparent about limitations. FEC data can lag filings, historical bill coverage is not fully backfilled, and some member finance records depend on the quality of external candidate ID mappings.

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Neon Postgres
- Drizzle ORM
- Recharts
- `tsx` ingestion scripts

## Architecture

```text
app/                  Next.js routes and API handlers
components/           UI components and comparison views
lib/                  Database client, schema, query helpers, formatting
scripts/ingest/       Data ingestion and derived-data generation jobs
scripts/lib/          API clients and source-specific helpers
docs/                 Product plan and design system notes
```

The production app is read-heavy. Pages fetch through server components, Drizzle queries centralize database access, and ingestion scripts upsert source records into Postgres so jobs can be rerun safely.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Required environment variables:

```bash
DATABASE_URL=
CONGRESS_API_KEY=
FEC_API_KEY=
```

`DATABASE_URL` is required for pages that query live data. API keys are required only for ingestion jobs that call Congress.gov or FEC.

## Common Commands

```bash
npm run dev      # start local Next.js dev server
npm run lint     # run ESLint
npm run build    # production build
```

Example ingestion commands:

```bash
npx tsx scripts/ingest/seed-states.ts
npx tsx scripts/ingest/members.ts
npx tsx scripts/ingest/committees.ts
npx tsx scripts/ingest/bills.ts
npx tsx scripts/ingest/finance.ts
npx tsx scripts/ingest/votes.ts
npx tsx scripts/ingest/generate-events.ts
npx tsx scripts/ingest/generate-briefs.ts
```

## Portfolio Notes

This project is designed to show production-oriented engineering, not just UI work:

- Data modeling with a normalized Postgres schema.
- Idempotent ingestion from multiple public APIs.
- Source attribution and methodology documentation.
- Server-rendered data product pages.
- Practical handling of incomplete public records.
- Shareable comparison views backed by query-string state.

## Roadmap

- Add demo seed data so reviewers can run the app without API keys.
- Add CI for lint, typecheck, and production build.
- Add search across members, bills, committees, and states.
- Add source-linked weekly delegation summaries.
- Add sync monitoring and per-source freshness alerts.
- Add screenshots and an architecture diagram to this README.
