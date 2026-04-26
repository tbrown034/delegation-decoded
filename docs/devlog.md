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
