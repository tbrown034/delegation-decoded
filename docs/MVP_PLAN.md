# Delegation Decoded — MVP Plan

## What "Done" Looks Like

A working state delegation dashboard for all 50 states, backed by real data from 3 official sources, with member profiles, legislative activity, committee coverage, and campaign finance summaries.

### In scope for v1

- Homepage with all 50 states as entry points
- `/state/[code]` — full delegation dashboard: senators + representatives, summary cards, recent legislative activity, committee assignments, party composition, campaign finance overview
- `/member/[id]` — individual member page: bio, committees, sponsored bills, top donors, activity timeline
- Real data from Congress.gov API, FEC API, and @unitedstates reference dataset
- Data freshness indicators
- Clean, professional UI — newsroom-grade, not startup splash
- Deployed on Vercel with Neon Postgres

### Explicitly NOT in v1

- AI analysis (requires data volume first)
- Press release ingestion (requires RSS scraping infra)
- Financial disclosures (PDFs, poor structure)
- Voting record visualization (add after core is solid)
- User accounts, saved states, alerts

---

## Data Sources

### Tier 1: MVP Sources

| Source | Data | Auth | Notes |
|--------|------|------|-------|
| @unitedstates/congress-legislators (GitHub) | Canonical member list, terms, committees, social, contact | None (YAML/JSON) | Gold standard reference data |
| Congress.gov API (api.congress.gov) | Bills, sponsorships, cosponsorships, committee assignments, actions | Free API key | ~5000 req/hr rate limit |
| FEC API (api.open.fec.gov) | Campaign finance: filings, totals, contributors, disbursements | Free API key | Generous limits |

### Tier 2: Post-MVP

| Source | Data | Notes |
|--------|------|-------|
| GovInfo API (api.govinfo.gov) | Bill full text, Congressional Record | For AI text analysis |
| Member office RSS feeds | Press releases, statements | Per-member scraping required |
| Senate/House financial disclosures | Stock trades, assets | PDF-heavy, fragile |
| VoteView (voteview.com) | Ideology scores, roll call votes | Good for viz |

---

## Database Schema

See `/scripts/schema.sql` for the full schema.

Core tables:
- `states` — 50 states reference
- `members` — bioguide_id as primary key, linked to state
- `terms` — service history per member
- `committees` — committee reference data
- `committee_assignments` — member-committee join
- `bills` — legislation tracked by congress
- `bill_sponsorships` — sponsor/cosponsor relationship
- `campaign_finance` — per-cycle finance summaries
- `top_contributors` — aggregated contributor data
- `sync_log` — data freshness tracking

---

## Ingestion Pipeline

```
/scripts/
  /ingest/
    members.ts          — @unitedstates → members + terms
    committees.ts       — @unitedstates → committees + assignments
    bills.ts            — Congress.gov API → bills + sponsorships
    finance.ts          — FEC API → campaign_finance + top_contributors
    runner.ts           — Orchestrator, logs to sync_log
  /lib/
    db.ts               — Neon Postgres client
    congress-api.ts     — Congress.gov API client with rate limiting
    fec-api.ts          — FEC API client with pagination
    unitedstates.ts     — GitHub YAML fetcher/parser
```

Principles:
- Idempotent upserts (ON CONFLICT DO UPDATE)
- Rate-limit aware with exponential backoff
- Incremental fetches using sync_log timestamps
- All scripts runnable locally: `npx tsx scripts/ingest/members.ts`
- Vercel Cron wraps the same logic for production

Cadence:
- Members + committees: weekly
- Bills + sponsorships: daily
- Campaign finance: weekly

---

## Route Structure

```
/                       → 50-state grid, pick your delegation
/state/[code]           → State delegation dashboard
/member/[bioguideId]    → Member detail page
/about                  → Sources, methodology, data freshness
```

---

## Pages

### Homepage (/)
- 50-state grid with delegation size and party split per card
- Quick stats header: total members tracked, last sync time
- No marketing copy — the product IS the homepage

### State Dashboard (/state/[code])
- Header: state name, delegation count, party composition bar
- Delegation roster: member cards with photo, party, key stat
- Committee coverage panel: which committees the state covers
- Recent legislative activity feed
- Campaign finance overview: horizontal bar chart by member

### Member Detail (/member/[bioguideId])
- Header: photo, name, party, state, chamber, district
- Sections: overview, legislation, committees, campaign finance, timeline

### About (/about)
- Data sources with links
- Update schedule and methodology
- Open source attribution

---

## First Visualizations

1. **Party composition bar** — stacked horizontal bar on state pages and homepage cards
2. **Campaign finance bar chart** — members ranked by total raised, color by party
3. **Committee coverage grid** — matrix of committees vs members
4. **Funding source breakdown** — small donor / large individual / PAC / party per member
5. **Legislative activity sparklines** — bills per month on member cards
6. **Delegation timeline** — chronological feed of actions across all members

Tech: Recharts for v1, D3 for custom viz later.

---

## Phased Build Order

### Phase 1: Foundation (1-2 weeks)
- Neon Postgres schema setup
- Member + committee ingestion from @unitedstates
- Seed all 50 states
- Homepage with state grid
- State delegation dashboard with roster
- Member detail page with bio + committees
- Deploy to Vercel

### Phase 2: Legislative Activity (1-2 weeks)
- Congress.gov API bills ingestion
- Bill lists on member pages
- Legislative activity feed on state pages
- Activity sparklines on member cards

### Phase 3: Campaign Finance (1-2 weeks)
- FEC API ingestion
- Finance bar chart on state pages
- Funding breakdown + top contributors on member pages
- Finance stats on member cards

### Phase 4: Polish and Infra (1 week)
- Data freshness indicators
- Vercel Cron automated sync
- Sync monitoring
- Responsive design pass
- SEO and OG images
- Performance optimization

### Phase 5: AI Layer (future)
- Weekly delegation change summaries
- Contradiction flags (rhetoric vs votes)
- Entity linking across bills, donors, committees
- Reporter-facing alerts

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | Neon Postgres (serverless) | Free tier, Vercel-native |
| DB access | @neondatabase/serverless or Drizzle | Schema is simple, avoid ORM weight |
| Ingestion | TypeScript scripts in /scripts/ | Same language as app |
| Charts | Recharts → D3 later | Quick start, upgrade path |
| Styling | Tailwind CSS 4 | Already configured |
| Data fetching | Server components | Read-heavy app, right default |
| Member photos | @unitedstates/images (GitHub) | Canonical headshots |
