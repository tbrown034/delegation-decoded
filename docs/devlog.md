# Development Log

A chronological record of development sessions and significant changes.

---

## 2026-04-25 — Bulletproof STOCK Act trades feature

**Session summary:**
Closed the gap on the trades pipeline end-to-end. Started the day with 157 filings / 889 tx / 65 members and 12 PDFs that wouldn't parse. Ended with 169 filings / 4,100 tx / 69 members and 99.95% of rows at ≥80% parse confidence. Shipped commit `244e93c` to `main`.

**What changed:**

- **Page-split PTR parser** — full-document PDF calls were timing out with `APIConnectionError: SocketError: other side closed` on PDFs over ~30 pages. Wrote `scripts/lib/parse-ptr-paged.ts` that uses `pdfseparate` to break a PDF into single-page PDFs and parses them in a 4-worker pool. Single-page payloads sail through the API. Ran `retry-stuck-paged.ts` to ingest the 12 stuck PDFs (Khanna's three filings, McCaul's three, plus six others).
- **Repair the 3 filings whose tx insert raced** — `retry-stuck-paged.ts` left three filings with a `disclosure_filings` row but no `stock_transactions` (the bulk insert lost a race). `repair-3-filings.ts` re-parses each filing serially, inserts in chunks of 100 with a row-by-row fallback so one bad row can't poison the chunk. Two rows lost on page-boundary fragments where `amountRange` came back null — both filings flagged `review` for human follow-up, which is what that status is for.
- **Ticker enrichment** — vision parser leaves `ticker` null when the source PDF lists tickers in a column rather than parenthetically. Wrote `enrich-tickers.ts` to send unique null-ticker descriptions to Sonnet in batches of 50 with a strict resolver prompt. Resolved 816 of 1,250 unique descriptions, updated 2,079 rows. Pass 2 (`enrich-tickers-2.ts`) handled the long tail (MMC, MODG, AXAHY, CGEMY, AME, SBGSF) and bumped confidence on tickerless-by-design rows (bonds, structured products, hybrids) where every other field validated.
- **Parser bug: bogus parenthetical tickers** — found that `WALT DISNEY COMPANY (THE) CMN` was being parsed with ticker `THE`, `TJX COMPANIES INC (NEW) CMN` with `NEW`, `SCHNEIDER ELECTRIC … (FRANCE)` with `FRANCE`, etc. `fix-bogus-tickers.ts` cleared 47 bogus tickers and re-resolved them (DIS, KO, TJX, STT, AME, TTD, CLX, …). Patched `scripts/lib/parse-ptr.ts` with a `BOGUS_TICKERS` blacklist so future ingests can't reintroduce the bug.

**Final confidence numbers:**

| Metric | Start | End |
|---|---|---|
| Avg tx confidence | 85.0% | 88.8% |
| Rows ≥80% confidence | 68.1% | **99.95%** |
| Rows below 80% (flagged) | 1,309 | 2 |
| Rows with ticker | 35.9% | 87.6% |
| Avg filing confidence | 94.3% | 94.6% |

The two remaining low-confidence rows are both `BLACKROCK FUNDING, INC. CMN` — that's a debt-issuance subsidiary distinct from BlackRock Inc (BLK), so leaving them flagged is honest.

**UI verification:**
All routes verified via Chrome — `/`, `/trades` (header reads `69 members · 4,100 trades · 169 filings`), `/trades/[bioguideId]` (Khanna's page renders 2,157 rows with 502 unique ticker links and zero bogus tickers), `/trades/companies/DIS` (4 members, 16 trades, 9P/7S after the bogus-ticker fix attributed those trades correctly), `/trades/methodology`, `/compare`, `/state/CA`. `next build` passes.

**Files added:**
- `app/trades/{,[bioguideId]/,companies/[ticker]/,methodology/}page.tsx`
- `components/trade-{sparkline,timeline}.tsx`
- `lib/disclosure-queries.ts`
- `scripts/lib/parse-ptr.ts`, `scripts/lib/parse-ptr-paged.ts`
- `scripts/ingest/disclosures-house.ts`
- `scripts/{enrich-tickers,enrich-tickers-2,fix-bogus-tickers,repair-3-filings,retry-stuck-paged,audit-data,oddities-check,state-check,...}.ts`
- `lib/schema.ts` extended with `disclosureFilings` + `stockTransactions`

**.gitignore:** added `/data/` (16 MB of cached PDFs, regenerable from House Clerk) and `.claude/` (local agent state).

---

## 2026-04-25 — Senate eFD ingest (chamber 2 of 2)

**Session summary:**
Added the Senate side of the STOCK Act pipeline. Ingest now covers both chambers: 215 filings / 4,350 transactions / 88 members, up from House-only 169 / 4,100 / 69. Senate adds 46 PTRs and 250 transactions, all at ≥80% confidence, parsed in 35.7 seconds (no LLM).

**Approach:**
Senate eFD's web-form PTRs come back as structured HTML tables — every row has a discrete ticker, owner code, asset type, transaction type, and amount band. That meant a cookie-jar + regex parser instead of the vision pipeline used for House paper PDFs. Faster, free, deterministic, and 92.1% avg confidence baseline.

**What changed:**

- **Recon scripts** — `recon-senate-efd.ts` walked the TOS gate (GET /search/home/, POST `csrfmiddlewaretoken` + `prohibition_agreement=1`), then hit `/search/report/data/` with `report_types=[11]` (PTR), `filer_types=[1]` (Senator). Confirmed JSON shape and got 55 PTRs for 2026. `recon-senate-detail.ts` confirmed the detail pages serve `<table class="table table-striped">` with columns `# / Tx Date / Owner / Ticker / Asset Name / Asset Type / Type / Amount / Comment` — no PDF fallback for any of the 2026 sample.
- **`scripts/ingest/disclosures-senate.ts`** — full ingester. `acceptTos()` returns `{jar, csrf}`; `listPtrs()` paginates with `length: 100`; `parseSenateHtml()` walks `<tbody>` rows via regex, normalizes via `mapOwner` / `mapTxType` / `mapAssetType` / `bucketAmount`. Confidence is 95 when ticker is present, 85 otherwise (HTML-structured baseline is high). Inserts to `disclosure_filings` with `chamber: 'senate'`, `pdfUrl: detailUrl`, `pdfHash: sha256(html)`, and logs to `sync_log` with `source: 'senate_efd'`.
- **`stripSuffix()` for senator name resolver** — first ingest run failed to resolve 11 senators because eFD concatenates suffixes into `lastName` (`King, Jr.`, `Hagerty, IV`). Added `/,\s*(jr|sr|i{1,3}|iv|v)\.?$/i` strip + first-name initial fallback (`fold(firstName).split(/\s+/)[0].slice(0, 3)`) to handle `Angus S` vs `Angus`. Recovered 6 more on retry. Five remaining failures are all Markwayne Mullin (R-OK) — genuinely missing from the `members` table; tracked separately as a member-sync bug.
- **Source label** — added `chamber` to `MemberTransaction` and `lib/disclosure-queries.ts` so the per-member trade table can show "HTML" for Senate sources and "PDF" for House. The link still points to the canonical detail page either way.

**Final data shape:**

| Chamber | Filings | Tx | Avg confidence | <80 |
|---|---|---|---|---|
| House  | 169 | 4,100 | 88.8% | 2 |
| Senate | 46  | 250   | 92.1% | 0 |
| **Total** | **215** | **4,350** | — | 2 |

**UI verification (Chrome, http://localhost:3001):**
`/trades` header now reads `87 Members trading · 4,350 Disclosed trades · 215 PTR filings`. Senate rows are interleaved correctly — Boozman (AR-S, 81), McCormick (PA-S, 55), Britt (AL-S, 23), Capito (WV-S, 17), Fetterman (PA-S, 13), King Jr (ME-S, 12), McConnell (KY-S, 2), Hagerty (TN-S, 2). `/trades/B001236` (Boozman) renders all 81 trades with HTML source labels. `/trades/companies/MSFT` shows 16 holders mixing House + Senate (Boozman, Fetterman, Britt, Capito, King). `next build` clean.

**Known follow-ups:**
- Mullin (R-OK) needs to be added to `members` (5 PTRs deferred).
- The 51-member Senate listing has 51 PTRs; we ingested 46 — the 5 unaccounted are all Mullin.

---

## 2026-04-26 — Bulletproof for job application

**Session summary:**
Site review and cleanup pass to ship the project as a portfolio piece. Pruned throwaway scripts, rewrote the methodology page, and reconciled the homepage with what the pipeline actually produces.

**Code cleanup:**
- Deleted 13 one-off fix/repair/recon scripts whose work is baked into `scripts/lib/parse-ptr.ts` (BOGUS_TICKERS blacklist) and the production ingest path: `check-failed-3`, `enrich-tickers`, `enrich-tickers-2`, `fix-asset-tickers`, `fix-bogus-tickers`, `fix-data`, `recon-senate-detail`, `recon-senate-efd`, `repair-3-filings`, `restore-boeing`, `retry-stuck`, `retry-stuck-paged`, `test-one-pdf`. Also removed `scripts/lib/parse-ptr-paged.ts` since nothing in the production path used it.
- Deleted `scripts/audit-data.ts` (hardcoded row IDs from a one-off run) and `scripts/cost-check.ts` (hardcoded UPDATE statement). Kept the generic audit tools: `low-confidence`, `missing-pdfs`, `oddities-check`, `random-sample`, `state-check`, plus `apply-schema.ts`.
- Removed `recharts` from package.json — confirmed no source file imports it.
- Deleted `docs/MVP_PLAN.md`. The plan is no longer accurate (says trades/votes/press releases out of scope, references a non-existent `runner.ts`, names tools we don't use). `AGENTS.md` is now the architecture reference.

**Docs:**
- Rewrote `AGENTS.md` to actually describe the project: stack, routes, data pipeline, audit scripts, conventions, ship checklist.
- Rewrote `app/about/page.tsx` data sources section. Was 3 sources (`@unitedstates`, Congress.gov, FEC); now 6, adding House/Senate roll-call XML, House Clerk PTRs, Senate eFD, and member office RSS feeds. Each block has a current record count pulled live from the DB. Updated the collection process to include votes / disclosures / press releases. Stripped the false "not yet tracked" entries from Known Limitations (votes, press releases, financial disclosures all are tracked) and added real ones (45-day PTR filing window, 80% confidence threshold, RSS-feed dependency). AI Transparency now describes the Sonnet 4.6 vision pipeline honestly.
- Footer: added House Clerk and Senate eFD links to data attribution.

**Homepage:**
- "3 data sources" was hardcoded; now reads `new Set(syncSummary.map(s => s.source)).size` — currently renders "6 data sources".
- `sourceLabels` and `entityLabels` extended to map `senate_efd`, `disclosures-clerk.house.gov`, and the `ptr` entityType so the data-freshness panel labels them correctly.
- Trades chart's tx_date filter rewritten to anchor on month boundaries: `>= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '13 months')` and `< DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'`. Future-dated trades (filer-error rows in source data) no longer pollute the chart. Bars now span 14 complete calendar months.

**Verification:**
- `next build` clean (8/8 static, all dynamic routes compile).
- `/about` renders all 9 data-at-a-glance tiles: 538 / 4,159 / 63,929 / 861 / 230 / 3,891 / 2,810 / 215 / 4,350 / 2,859.
- Homepage trade chart peaks at 1,406 in Jan '26, range Mar '25–Apr '26.

---

## 2026-04-28 — Portfolio shipping pass: observability, journalist-facing exports, search, OG, SEO, transparency

**Session summary:**
A long single-session sprint to take the project from "feature-complete" to "presentable to a hiring manager." Built a unified pipeline-health system with a public /health page, gave the site a documentation surface for journalists with bulk CSV downloads, made every page generate a branded OG card, added Cmd-K global search, audited every route for mobile correctness, added a daily divergence audit against CapitolTrades, promoted bills and committees to first-class routes, stripped leftover dark-mode classes after the branding-parity pass, and reframed the homepage trades chart to be honest about what we actually cover.

**Health pipeline (`lib/health.ts`, `scripts/health-check.ts`, `app/health/page.tsx`):**
- One source of truth for pipeline status: per-source coverage matrix, sync-log freshness with per-source staleness thresholds, stuck-run detection, PTR parse counts, low-confidence trade count, rolled up to ok/warn/crit.
- Same `buildHealthReport()` powers the CLI gate (used as the final step in both daily and weekly GitHub Actions, exits 1 on crit) and the public /health route.
- Both workflows now have failure-alert steps that open or comment on a single rolling `ingest-failure` issue rather than spamming new ones.
- `scripts/cleanup-stuck-runs.ts` flips sync_log rows stuck >6h in `running` to `failed`. Read-only by default; `--apply` writes. Cleaned 4 historical zombies on first run.

**Branding shell (rhyme with capitol-releases & open-cabinet):**
- DM Sans + DM Mono + Source Serif 4 via next/font, 3-px neutral-800 accent bar at the top of every page, mobile hamburger nav with active-state highlighting, stone-50 footer with attribution + GitHub source/issues/contact links. Auto dark mode dropped for parity. Found and fixed a globals.css regression where the CSS variables were overriding next/font's font definitions.
- Footer Health link gained a 6 px live status dot (green/amber/red) backed by `unstable_cache(60s)`, gracefully degrading to neutral grey if the DB query throws.

**Trades transparency:**
- /trades hero gained a "Coverage panel" explaining what window is in scope, how many of 538 active members reported activity, and why the rest didn't (blind trusts / index funds / no PTR filed).
- /trades/methodology got a Coverage Window section computed live from the DB (1st–99th percentile of tx_date to clip outliers) and a "How this compares to other trackers" section calling out CapitolTrades and Quiver. Updated outdated language about Senate parsing being "in progress."
- Spot-checked Khanna/McCaul/Cisneros against CapitolTrades; verified dates align within a single PTR.

**Audit / observability:**
- `scripts/coverage-audit.ts` — chamber × source matrix.
- `scripts/compare-trades.ts` — top traders for the active window.
- `scripts/audit/divergence.ts` — fetches public CapitolTrades politician pages for a curated set of high-volume traders, parses the max non-future date, compares to ours. Drift >4d warns; >10d fails. Logs to sync_log under `source='capitoltrades_divergence'` and surfaces in /health. First run flagged 5/5 curated members 10–31 days behind — root cause was a stalled PTR ingest from an Anthropic credit-balance issue, not a bug. Wired into the daily workflow as `continue-on-error: true` so it observes without blocking.

**Journalist-facing exports:**
- `/for-journalists` landing page with row counts, freshness window, citation guidance, statutory amount-range explainer, contact.
- `/api/data/trades.csv`, `/api/data/filings.csv`, `/api/data/finance.csv` — streaming CSVs with `Content-Disposition: attachment`. Trades CSV joins members + filings + parsed line items and includes a back-link to the source PDF for every row. `lib/csv.ts` centralises RFC 4180-ish quoting.
- Verified row counts: 4,354 trade rows, 216 filings, 2,811 finance rows.

**OG / social cards:**
- 1200×630 PNGs via `next/og` for /, /state/[code], /member/[bioguideId], /trades/companies/[ticker]. State cards show senate/house/trades counts plus a party-split dot row; member cards use the party color for the accent bar; ticker cards set the symbol in display type with buy/sell breakdown.
- Hit and worked around Satori's strictness: every div with multiple children needs explicit `display: flex` + `flexDirection`, and JSX text nodes mixing literals with interpolations must be collapsed to a single template-literal child or wrapped in a flex div. `flexDirection: "row"` everywhere.
- Set `metadataBase` on the root layout so OG/Twitter URLs resolve to the live host instead of localhost.

**Cmd-K global search (`lib/search.ts`, `app/api/search`, `components/search.tsx`):**
- Cross-entity search across members, tickers, states, bills, committees. Plain ILIKE + a CASE-based ranking (exact > prefix > substring) — skipped pg_trgm so this ships without a schema migration.
- Client combobox lives in nav, opens on Cmd/Ctrl-K or click, debounces at 120 ms, supports Up/Down/Enter, closes on Escape or backdrop click.

**First-class bill + committee pages:**
- `/bill/[billId]` shows title, sponsor, cosponsors with party split, latest action.
- `/committee/[committeeId]` shows roster sorted by role (chair → ranking member → vice chair → member alphabetical), parent + subcommittee links, official-site link.
- Both wired into search.

**SEO infra:**
- `app/sitemap.ts` generates entries for every state, every active member, every distinct ticker.
- `app/robots.ts` allows everything except /api/, points to sitemap.
- `app/feed.xml/route.ts` — RSS of the 50 most recent disclosed trades with names, action verb, ticker, amount range, and a back-link to the source PDF in the `<source>` element.

**Per-member coverage card (`components/member-coverage-card.tsx`):**
- Bottom of every /member/[bioguideId] page lists every data source with one of three states (tracked, not applicable, investigating). The "not applicable" copy explains *why* a zero is the expected pattern (no RSS feed, no PTR filed, etc.) so a casual visitor reads it as transparency instead of as "the site is broken."

**Mobile responsive sweep:**
- Audited every route at 606 px viewport. Caught one real bug on /state/[code]: the `grid gap-10 lg:grid-cols-3` layout fell back to an implicit grid where `min-width: auto` on grid items let long member names and bill titles push the column to 1,139 px (vs viewport 606). Fixed with explicit `grid-cols-1` at default + `min-w-0` on the col-span-2 child. Truncate utility on bill titles now takes effect.

**Dark-mode cleanup:**
- 252 leftover `dark:` Tailwind classes across 27 files removed via a perl pass that matches dark: classes only inside Tailwind class-string contexts. Symmetric diff: 252 deletions, 252 insertions of the same line minus the variant. (First pass was over-aggressive and ate adjacent quoted whitespace; reverted and redid with safer regex.)

**Honest trades chart (final pass):**
- Original chart was a 14-month rolling window of tx_date. First fix anchored to the earliest PTR `filed_date` (Jan 2025), but feedback called this out as still misleading: 5 PTRs scattered across 2025 are late-filed amendments, not continuous coverage. 210 PTRs filed Jan–Apr 2026 is the real active window.
- Final fix: anchor to first month with ≥5 PTRs filed, with a one-month lookback so December 2025 trades disclosed in January 2026 PTRs remain visible. Lead-in copy now reads "Active collection began Jan 2026 (5 earlier PTRs from late-filed amendments not shown)."
- Bars converted to a Client Component with a hover tooltip showing month + per-party counts + total. Non-zero months get a 3-unit minimum bar height so sparse data reads as "data exists" instead of empty space. Non-hovered bars dim to 40% so the active selection stands out.

**Verification across the day:**
- `pnpm tsc --noEmit` clean.
- `next build` passes; route table shows /bill/[billId], /committee/[committeeId], /for-journalists, /health, /api/data/*.csv, /feed.xml, /sitemap.xml, /robots.txt, plus four opengraph-image variants.
- All routes scrollWidth ≤ viewport at 606 px.
- 13 commits pushed. Vercel auto-deploy in flight.

**Files added (selection):**
- `lib/health.ts`, `lib/search.ts`, `lib/csv.ts`
- `app/health/page.tsx`, `app/for-journalists/page.tsx`, `app/bill/[billId]/page.tsx`, `app/committee/[committeeId]/page.tsx`
- `app/sitemap.ts`, `app/robots.ts`, `app/feed.xml/route.ts`
- `app/api/search/route.ts`, `app/api/data/{trades,filings,finance}.csv/route.ts`
- `app/opengraph-image.tsx` + per-route variants
- `components/search.tsx`, `components/member-coverage-card.tsx`, `components/health-dot.tsx`
- `scripts/health-check.ts`, `scripts/cleanup-stuck-runs.ts`, `scripts/coverage-audit.ts`, `scripts/compare-trades.ts`, `scripts/audit/divergence.ts`
- `docs/ship-plan.md` (today's planning doc)

**Real findings worth keeping:**
- Anthropic credit balance hit zero mid-PTR-ingest April 25–26, leaving a batch of April PTR PDFs unprocessed. Surfaced via the new health gate and the divergence audit before being noticed manually.
- House Clerk 2026 manifest currently has no Khanna PTR newer than April 7. CapitolTrades shows him trading on April 9 — meaning either CapitolTrades reads from a more aggressive feed than the public ZIP, or the next manifest update will land in the next 24–48h. Logged but not fixable on our side.
- The 2 review-status filings are McCaul (TX-10, doc 8221326) and Cisneros (CA-31, doc 20033762) — vision parser flagged them for human review; surfaced with a warning badge in the UI.

---

## 2026-05-31 — Review verification, ingest recovery, and honesty pass

**Session summary:**
Picked up a timed-out external agent's react-doctor refactor pass, verified it, ran a full code + UI/UX review, then traced and recovered a 5-week ingest outage and made the trades surface honest about its state. Nothing merged to main — all on branch `fix/review-findings`, pushed for review.

**Verified the inherited refactor pass:**
- `pnpm lint` clean, `next build` clean, and every refactored route returns 200 via a server-side curl sweep with zero dev-log errors. The refactors are server components, so render-or-500 was the real risk and it's clear.
- The agent reported "react-doctor 100/100"; that was the `--verbose --diff` metric, not the absolute score. Absolute project score is ~98 (was ~85 before edits) — the giant member page, em-dashes in JSX, and label-association warnings persist. No regression from this session.

**Code review — found and fixed:**
- `scripts/lib/congress-api.ts` — retry recursion bug: the recursive `attempt()` calls and the terminal "give up" `throw` both sat inside the same `try`, so a deep throw was re-caught by the parent's network-error `catch` and retried. A persistent 5xx/429 fired ~15 requests (2^retries−1) instead of 4. Fixed by wrapping only `fetch()` in the try; proven 4-not-15 with a counter harness. (`fec-api.ts` was fine — no try/catch.)
- `components/search.tsx` — the useReducer refactor dropped the combobox a11y: restored `role=listbox/option` + `aria-selected`, added `role=combobox`/`aria-expanded`/`aria-controls`/`aria-activedescendant`, an `aria-live` results region, and `overscroll-contain`.
- `components/compare-picker.tsx` — em-dash→comma refactor dropped a `{" "}`, rendering "(D),Sen."; restored the space.
- `components/data-coverage.tsx` — per-source status was color-only (`statusLabel.text` computed but never rendered); added an sr-only status word and `aria-hidden` on the dot.
- `app/find/page.tsx` — added `autoComplete="street-address"`, `spellCheck={false}`, `type=search`, and `role="alert"` on the error.
- `lib/press-analytics.ts` — reverted an unnecessary precompiled-regex phrase match back to `.includes()` (the patterns are plain substrings).

**UI/UX review (Web Interface Guidelines) — logged, not all fixed:** `/trades` renders every trading member unvirtualized after loading all transactions into memory (top perf risk); raw ISO dates render in several feeds/tables instead of `Intl.DateTimeFormat`, inconsistent with the same files' own formatted dates; charts (`trade-timeline`, `trades-monthly-bars`) are mouse-only; numeric columns lack `tabular-nums`.

**Ingest outage — root cause and recovery (the big one):**
- Daily + weekly workflows had been red for 5 weeks. Root cause: the `ANTHROPIC_API_KEY` **GitHub Actions secret** (used by the House PTR vision parse) returns 401 `authentication_error`. It is separate from `.env.local` and Vercel env — updating those does not fix CI. The `health-check.ts` gate (auth-failure CRIT + ≥3-failures-in-14-days CRIT) reds the whole pipeline off that one source.
- Found the real data gap: the local manifest cache `data/house-ptrs/2026FD.zip` was frozen at **April 25** — the exact credit-balance outage logged in the prior entry. Every "catch-up" since read that stale list and skipped everything. The live manifest has **223 PTRs vs the cached 164**.
- Moved the stale zip aside and re-ran with the user's new working key: **50 filings recovered**. House latest filing **April 24 → May 28**; House filing count **169 → 224**.
- **4 filings still failing on `Connection error`** — the heaviest traders (Khanna 9115822, McCaul 9115820, Cisneros 20034500, Moskowitz 20034274). Their PTRs are enormous (Khanna 2,100+ trades) and the vision request drops. These are the residual CapitolTrades drift; retrying best-effort.

**Honesty pass (portfolio safety):**
- `/for-journalists` claimed "refreshed nightly/daily" while House data was 5 weeks stale — softened to honest, key-agnostic wording pointing to `/health`.
- Added a `TradesWipNotice` component (amber "Work in progress" note) to all three trades pages (`/trades`, `/trades/[bioguideId]`, `/trades/companies/[ticker]`).

**Still open / handed back to the user:**
- Rotate the `ANTHROPIC_API_KEY` **GitHub Actions** secret (still dated May 22) — `gh secret set ANTHROPIC_API_KEY` — so nightly runs stay green and future new PTRs parse. Without it the recurring failure returns on the next new filing.
- `/health` will self-clear to green over ~14 days as the historical failures age out of the window.
- Stray untracked `pnpm-workspace.yaml` (pnpm supply-chain settings) — origin unknown, left out of the commit.

---
