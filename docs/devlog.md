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
