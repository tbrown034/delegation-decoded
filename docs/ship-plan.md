# Ship plan — April 28, 2026

Goal: harden the site enough that a hiring manager browsing it cold sees a polished, journalist-ready product with rigor under the hood.

Each task: build → verify in browser (or via CLI for non-UI work) → commit. No batched commits.

---

## 1. Journalist-facing data exports

**Why**: Reporters expect CSV downloads from any data project. CapitolTrades and OpenSecrets both have them. Not having them is a tell that the project is a demo, not a tool.

**Scope**:
- `/for-journalists` page: methodology summary, link to all downloads, FAQ on data freshness, contact.
- `/api/data/trades.csv` — every parsed transaction with bioguide, names, ticker, type, date, amount range, filing URL.
- `/api/data/filings.csv` — every PTR with bioguide, doc_id, filed_date, parse_status, confidence.
- `/api/data/finance.csv` — campaign finance summary per member per cycle.
- Streaming (no in-memory accumulation) since trades is ~4k rows but will grow.

**Done when**: each endpoint returns a well-formed CSV with `Content-Disposition: attachment` and the journalists page links to all three.

---

## 2. OG / social cards

**Why**: Every shared link should look like a publication, not a default Vercel thumbnail. Critical for the portfolio "look how this presents in the wild" test.

**Scope**:
- Root `app/opengraph-image.tsx` — branded card with tagline + key stats.
- `app/state/[code]/opengraph-image.tsx` — state name, delegation breakdown, party split.
- `app/member/[bioguideId]/opengraph-image.tsx` — member name, state-district, party, key stat.
- `app/trades/companies/[ticker]/opengraph-image.tsx` — ticker, holder count, total trades.
- Use `next/og` ImageResponse; pull from existing query helpers.

**Done when**: cards render at 1200x630, are visible in `view-source` of the relevant page, and look like a product not a placeholder.

---

## 3. Global search

**Why**: There's currently no way to jump to a specific member, ticker, or bill without navigating through a state. For a data product this is a baseline expectation.

**Scope**:
- Add `pg_trgm` extension via the schema file (idempotent).
- `lib/search.ts` — single `search(q)` returning ranked hits across members, tickers, bill titles, committees.
- Client-side combobox in the nav (or `/search` route) that calls a server action.
- Keyboard shortcut (`Cmd-K`) to open.

**Done when**: typing "khanna" jumps to the member; "NVDA" jumps to the ticker; "infrastructure" surfaces matching bills.

---

## 4. Mobile responsive sweep

**Why**: The nav is mobile-aware but I haven't audited the data tables, chart panels, hero stat rows, or compare grid at 375px.

**Scope**:
- Walk every route at 375px in Chrome DevTools.
- Fix horizontal scroll overflow, illegible chart labels, broken stat layouts.
- Reasonable target: looks intentional, not broken, on iPhone 14 width.

**Done when**: every route in the AGENTS.md route list passes a 375px walkthrough.

---

## 5. Auto-divergence script

**Why**: Today's spot-checks against CapitolTrades caught a real lag (Khanna April 9 trade we don't have). A daily script that automates this turns one manual audit into ongoing observability.

**Scope**:
- `scripts/audit/divergence.ts` — fetches public CapitolTrades politician pages for a curated set of high-volume traders (Khanna, McCaul, Cisneros, Boozman, McCormick).
- Compares the most-recent trade date on their page vs ours, plus filing count.
- Logs to `sync_log` and emits a row in the health report's `checks[]` if drift > 7 days.
- Runs in the daily GH Action.

**Done when**: the script runs locally without scraping more than it needs, surfaces drift cleanly, and is wired into the workflow.

---

## 6. Per-member coverage card

**Why**: When a member shows zero press releases or no PTRs, a casual visitor reads it as "the site is broken." A coverage card on the member page makes the gap intentional and explained.

**Scope**:
- New component on `/member/[bioguideId]`: a small grid showing each data source with status (present + count, intentionally absent + reason, missing + needs investigation).
- Reasons drawn from heuristics: no RSS feed registered → "office does not publish an RSS feed yet"; no PTR → "has not filed a PTR in the coverage window"; no fec_candidate_id → "campaign finance not yet linked".

**Done when**: every member page has the card and the language reads as transparent, not defensive.

---

## 7. SEO infra

**Why**: Sitemap + robots + RSS make the project look complete, are easy wins, and support the job-application use case where a recruiter might google the site name.

**Scope**:
- `app/sitemap.ts` — root, state pages, member pages, ticker pages.
- `app/robots.ts` — allow all, point to sitemap.
- `app/feed.xml/route.ts` — RSS of recent trades for the press.

**Done when**: each is reachable, validates against the W3C feed validator, and the sitemap covers every dynamic route.

---

## 8. Footer status dot + global health link

**Why**: A small persistent status dot in the footer (turns amber/red on issues) signals "this team monitors their stuff" without dedicating screen real estate.

**Scope**:
- Server-side fetch of `/health` summary in the footer (cached for 5min).
- A 6px dot, with the level color, linking to `/health`.

**Done when**: the dot renders on every page, reflects the live state, and degrades gracefully if the health query fails.

---

## Order of execution

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

Stop after each, verify in browser if applicable, commit, move on. Each commit gets a short, descriptive subject line — no AI co-author tag.
