# Delegation Decoded

Congressional accountability tracking, organized by state delegation.

Live at [delegationdecoded.org](https://delegationdecoded.org).

Delegation Decoded turns official congressional records into state-level dashboards for reporters, researchers, and civic-minded voters. It tracks members, votes, legislation, committees, campaign finance, stock trades, and 2026 races, and answers plain-language questions about all of it with an assistant that cites the records it read.

## Why This Exists

Most congressional tools are organized around individual politicians, committees, or bills. Real-world accountability is often local: what is my state delegation doing, who represents it on key committees, how are they voting, and where is the campaign money coming from?

This project treats each state delegation as the primary unit of analysis.

## What It Does

- **Ask**, a grounded question-answering tool on the homepage, `/ask`, and every state, member, and race page. It runs a tool-calling loop over this site's own database — never the open web — and factual answers require a citation to a retrieved record. Citation checks establish a source connection, not the accuracy of every interpretation.
- State dashboards for all 50 states, DC, and the territories, with party composition, recent activity, and data freshness.
- Member profiles with votes, sponsored legislation, committee seats, campaign finance, top contributors by donor employer, and verbatim quotes from official biographies.
- STOCK Act trade tracking: a cross-member index at `/trades`, per-member and per-ticker views, and a methodology page comparing the pipeline against CapitolTrades.
- 2026 race pages at `/races`, with candidate fields cross-checked against state election authorities where adapters exist and labeled FEC-only elsewhere.
- `/for-journalists`: bulk CSV downloads (members, votes, trades, filings, finance, candidates, races), freshness notes, and reporting tips.
- `/health`: a live pipeline status page showing per-source coverage, sync history, and every open data issue, rendered from the same checks that gate CI.
- Comparison views, address-to-delegation lookup via the Census geocoder, search across members and tickers, an RSS feed of recent trades, and OG cards for shareable pages.

## How Ask Stays Honest

The assistant is dual-provider (OpenAI primary, Anthropic fallback) behind one engine. It can only answer from tool results scoped to the page it lives on, citations are validated server-side against the records actually retrieved that run, and answers disclose their AI authorship. Questions pass a moderation screen before any paid call. Per-IP and global daily budgets cap spend, and every request writes to a 90-day audit log with the IP HMAC-hashed. `docs/ask-security-review.md` records the external security review and what changed because of it.

## Data Sources

| Source | Used For |
| --- | --- |
| `@unitedstates/congress-legislators` and `images` | Members, terms, committees, cross-reference IDs, headshots |
| Congress.gov API | Bills, sponsorships, legislative metadata |
| FEC API | Campaign finance totals, committees, top contributors, 2026 candidate filings |
| House Clerk and Senate roll-call XML | Vote records and member positions |
| House Clerk PTR PDFs and Senate eFD | Stock trade disclosures |
| State election authorities | Verified 2026 ballot and primary records, where adapters exist |
| Member office sites | Press release RSS and official biography quotes |

House PTR PDFs are parsed with a vision model; rows below 80 percent confidence are published with a warning badge, not hidden. The site is deliberately transparent about limitations: `/about` documents methodology, and `/health` shows exactly what is stale or failing at any moment.

## Tech Stack

- Next.js 16 App Router, React 19 Server Components, TypeScript
- Tailwind CSS 4, hand-rolled SVG charts
- Neon serverless Postgres, Drizzle ORM
- OpenAI and Anthropic APIs for Ask, extraction, and PTR vision parsing
- Vercel hosting, Vercel Blob for source-page snapshots
- `tsx` ingestion scripts on GitHub Actions schedules

## Architecture

```text
app/                  Next.js routes and API handlers
components/           UI components
lib/                  Database client, schema mirror, queries, the Ask engine
scripts/ingest/       Ingestion and derived-data generation jobs
scripts/lib/          API clients and source-specific parsers
scripts/              Audit, QA, and schema tools
tests/                node:test suite
docs/                 Devlog, security review, design notes
```

Pages fetch through Server Components and centralized query helpers. Every ingestion job is idempotent — upserts on natural keys — and logs to `sync_log`, which feeds both the homepage freshness panel and `/health`. Ingestion runs on two schedules: daily (members, bills, votes, candidates, disclosures) and weekly (finance, committees, biographies, campaign sites), each ending with a health gate that fails the workflow on critical issues. Crawls that call paid models carry per-run page, call, and token budgets set in the workflow files.

## Local Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

`.env.example` documents every variable. The site renders with just `DATABASE_URL`; the rest split by concern:

- Ingestion: `CONGRESS_API_KEY`, `FEC_API_KEY`, `BLOB_READ_WRITE_TOKEN`
- Ask and extraction: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, plus optional model and provider overrides
- Limits and access: `ASK_RATE_LIMIT_SECRET` and the per-crawl budget caps

## Commands

```bash
pnpm dev            # local dev server
pnpm test           # node:test suite
pnpm run lint       # ESLint
pnpm run typecheck  # tsc --noEmit
pnpm run build      # production build
pnpm run eval:ask   # graded eval of the Ask loop (calls paid APIs)
```

CI runs the test suite, lint, and typecheck on every push and pull request. Ingestion scripts run with `npx tsx scripts/<name>.ts`; the full catalog, including audit and QA tools, is documented in `AGENTS.md`.

## Portfolio Notes

This project is designed to show production-oriented engineering, not just UI work:

- A grounded LLM feature with citations validated against retrieved records, spend budgets, moderation, and an audit log.
- Idempotent multi-source ingestion with per-run logging and a live health page wired into CI.
- Evidence-first crawling: source pages are snapshotted to private storage before extraction, and only verbatim quotes are published.
- Data modeling in a normalized Postgres schema with natural-key upserts.
- Honest handling of incomplete public records, surfaced rather than hidden.

## Roadmap

- Demo seed data so reviewers can run the app without API keys.
- Chunked parsing for the handful of oversized House PTR filings that exceed the vision parser's output budget.
- Server-side aggregation for the `/trades` index, which currently loads all transactions per request.
- Screenshots and an architecture diagram in this README.
