# Goals — Delegation Decoded

Canonical purpose and scope. When a feature decision conflicts with this file, this file wins. Last updated: August 31, 2026.

## Primary purpose: portfolio proof, not product

This is first and foremost a job-search artifact. It exists to show a hiring manager, in one working site, that Trevor can:

- **Ingest messy public data** — seven official sources (Congress.gov, House and Senate roll-call XML, FEC, @unitedstates, Senate eFD, state election authorities), each with its own format and failure modes.
- **Build durable pipelines** — idempotent daily/weekly ingests, sync logging, self-auditing health gates, rate-limit-aware API clients, and a /health page rendered from the same checks that gate CI.
- **Display data with editorial judgment** — state-delegation dashboards, member profiles, race pages, and journalist CSV exports, designed like a newsroom tool rather than a database dump.
- **Use AI on top of real data, responsibly** — /ask answers only from this site's database, cites every claim, refuses when the records can't answer, and is hardened against prompt injection with a logged audit trail.

Every feature decision should sharpen one of those four proofs. Polish on less beats ambition half-built.

## Secondary purpose: useful to real people

Traffic, journalist adoption, or citations by AI assistants are side benefits, welcome but never load-bearing. If a feature helps real users AND sharpens a proof point, great. If it only chases users, it waits.

## Feature tiers

**Core (maintained, visible, indexed):** state dashboards, member profiles, votes, legislation, committees, campaign finance, 2026 race pages, /ask, /for-journalists exports, /health.

**Quiet (live but unlinked and noindexed):** STOCK Act trades. Senate ingest runs daily; House PDF parsing is paused (Aug 31, 2026) until it can be rebuilt properly with filing chunking. Promote to core only with a full implementation plan — it is a heavy, correctness-critical feature.

**Retired (data kept, collection stopped):** press releases. Statements coverage belongs to Capitol Releases, the companion project; this site links there instead of duplicating a shallow version.

## Relationship to Capitol Releases

Capitol Releases is the flagship: an archival-grade statements corpus for all 100 senators. Delegation Decoded is the breadth piece: every chamber, every state, many sources, plus the AI layer. They cross-link and do not duplicate each other. Statements live there; votes, money, races, and /ask live here.

## Non-goals

- Not a startup, not monetized, not a growth project.
- Not a CapitolTrades competitor.
- Not a news publisher — the site displays records and verbatim quotes, never paraphrase presented as fact.

## Standing decision rules

1. Portfolio quality wins ties. A hiring manager browsing cold should find nothing broken, stale, or half-explained.
2. No feature ships without its pipeline being idempotent, logged to sync_log, and covered by the health gate.
3. Every visible number must trace to an official record. When data can't answer, the site says so.
4. Operating cost stays small (target: a few dollars a month across Vercel, Neon, and model APIs). Features that can't hold that line get redesigned or wait.
5. Retire loudly, not silently: paused or retired sources carry visible notes in /health and dated comments in the workflows.
