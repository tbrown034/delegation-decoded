# Development Log

A chronological record of development sessions and significant changes.

---

## 2026-07-22/23 — Washington verified ballot, campaign evidence, and scoped Ask QA

**Session summary:**
- Added Washington as the seventh state election adapter. The deterministic VoteWA parser validates the page identity, 14-column schema, all 10 congressional districts, known status pairs, filing dates, ballot order, and current party-preference vocabulary. It rejects unknown source shapes or values instead of partially ingesting them.
- Activated 10 House contests and 71 candidacies from the official 2026 primary list: 69 active `state_primary_ballot` records and two withdrawn records. The state source produced 20 stages, 69 ballot lines, 71 append-only status events, two private source snapshots, and no duplicate person/contest groups.
- Massachusetts was investigated but not activated. Its official candidate pages return an Imperva self-redirect to unattended requests, so no parser was shipped without a durable, independently fetchable source.

**Campaign-site evidence:**
- Ran five state-scoped campaign-research batches from commit `8b19d8d`: [29972486947](https://github.com/tbrown034/delegation-decoded/actions/runs/29972486947), [29972572748](https://github.com/tbrown034/delegation-decoded/actions/runs/29972572748), [29972659508](https://github.com/tbrown034/delegation-decoded/actions/runs/29972659508), [29972728175](https://github.com/tbrown034/delegation-decoded/actions/runs/29972728175), and [29972831336](https://github.com/tbrown034/delegation-decoded/actions/runs/29972831336). All passed their health gates.
- Of 69 active candidates, 33 have a conservative FEC link and were attempted. Thirty committee-reported sites verified. The pipeline currently has 89 private page snapshots, 167 campaign claims, and 14 prior-service records. Every extracted record remains `needs_review`; zero are published or supplied to Ask.
- Thirty-six active candidates without a conservative FEC match were deliberately not guessed. Current campaign-site failures fell from seven to six after the targeted John Braun retry. Three have no committee-reported website; the other failures are an HTTP 403, a cross-domain redirect the allowlist correctly blocks, and an unverifiable robots policy.
- The initial Kyle Usrey diagnosis was corrected after direct header inspection: `usrey-for-us.org` redirects to the different registrable domain `usreyforus.com`, not a bare/`www` alias. The host boundary remains fail-closed.

**Structured extraction and measured cost:**
- Commit `c368283` raised the bounded structured-output ceilings to 4,000 tokens for campaign extraction and 3,000 for member biographies, applied the same limit to both providers, and now reports OpenAI `incomplete_details` instead of a generic failure. Existing input, call-count, and run-token budgets remain enforced.
- Targeted retry [29973085285](https://github.com/tbrown034/delegation-decoded/actions/runs/29973085285) completed John Braun through `openai/gpt-5.6-terra`: three pages, one provider call, 2,810 input tokens and 1,137 output tokens. It found zero quote-backed review records and cleared the crawl error without publishing filler.
- Across the six Washington runs, logged extraction use was 28 OpenAI calls, 88,676 input tokens (88,595 cache-write and 81 fresh), and 26,934 output tokens. One Anthropic fallback attempt logged zero usage. At the standard rates recorded for this run, measured campaign extraction cost was about **$0.68**. This excludes the separate Ask QA calls.

**Ask and UI correctness:**
- State and member Ask both retrieve the exact Washington seat field with nine citations. The member-scoped test initially shortened preferences to party affiliations; commits `7391a10` and `a5edd5e` changed the retrieval payload to `party_preference`, added top-two interpretation metadata and grounding, and bumped the prompt/cache namespace so stale wording cannot survive.
- The rebuilt member test now says “Democratic preference,” “Republican preference,” and so on, explains that these are not party nominations or verified affiliations, stays locked to WA-03, uses `gpt-5.6-terra`, and reports `fallbackUsed: false`.
- `/race/2026-WA-H3` now carries the same top-two qualification beside the field and appends “preference” to each Washington label. `/state/WA`, `/race/2026-WA-H3`, `/races?state=WA`, `/member/G000600`, `/health`, and `/api/data/races.csv` all returned 200 from the production server. The CSV contains all 71 Washington records and nine WA-03 rows.
- The in-app browser was unavailable, so this session does not claim visual browser QA. Verification used production builds, rendered HTTP assertions, visible-text extraction, endpoint payloads, and response headers.

**Security and operations:**
- Verified the public shell sends an enforced nonce CSP with `strict-dynamic`, `frame-ancestors 'none'`, and `object-src 'none'`, plus `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies, and no-store on rendered data pages. Ask validates and bounds runtime input, rejects cross-site/non-JSON requests, hashes IPs, enforces per-IP and provider budgets, and keeps member/state scope server-side.
- The deployment audit found that Vercel had both provider keys but no dedicated `ASK_RATE_LIMIT_SECRET`, so HMAC identifiers were falling back to a provider key. Added one generated 256-bit secret to Development, Preview and Production configuration for key separation and stable rotation; no production code deployment was made.
- Campaign crawling remains HTTPS-only, host-allowlisted, redirect-limited, robots-aware, DNS-checked against private/link-local/metadata ranges, content-type constrained, byte-capped, and timeout-bounded. No raw HTML, dynamic-code, broad CORS, Web Storage token, or `postMessage` sink was found in the targeted security scan.
- Updated all four ingestion workflows to official `actions/checkout@v6`, `actions/setup-node@v6`, and Node 24 after the prior retry exposed Node 20 action-runtime deprecation. Documented both new output-token settings in `.env.example`.

**Release gates:**
- `pnpm test`: 49/49.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm lint`: clean.
- `pnpm build`: clean on Next.js 16.2.11 and Node 24.
- `pnpm audit --prod`: no known vulnerabilities. `npm audit --omit=dev`: zero vulnerabilities.
- `scripts/health-check.ts`: warning-only, no critical failures. Existing warnings remain visible for six Washington campaign sites, broader campaign/member biography gaps, Indiana certification expectation windows, the paused House PTR key, and two historical unrecovered sync failures.

---

## 2026-07-22 — Michigan primary ballot and challenger evidence

**Session Summary:**
- Added Michigan as the sixth state-authority adapter. The Bureau of Elections' August report is explicitly an `Official Candidate Listing`; the November report is explicitly `Unofficial`, so it is retained as provisional filing evidence without creating general-election ballot lines.
- Activated 14 federal contests with 91 candidacies: 54 active primary-ballot candidates, 27 active provisional general filers, nine disqualifications and one withdrawal. Two consecutive loads left 91 events, 54 primary ballot lines, 42 stages and two private source snapshots unchanged, with zero duplicate person/contest groups and zero general ballot lines from the unofficial report.
- Conservatively linked 40 active candidacies to FEC records and attempted campaign-site research for all 40. The other 41 active candidates remain unlinked rather than being matched by guesswork.

**Notable Changes:**
- Added exact report-identity, federal-office, party, status, filing-date and filing-method validation over the state HTML. The parser requires all 14 primary contests, fails closed on new federal values and keeps no address or contact fields.
- The evidence pass verified 35 committee-reported sites, recorded five no-site blocks and crawled 24 successfully. Sixteen candidates retain bounded discovery or crawl errors. It stored 75 private page snapshots and queued 61 claims plus 13 prior-service records; all 74 remain `needs_review` and none are published or supplied to Ask.
- GitHub Actions runs `29971600697`, `29971674359`, `29971763112`, `29971850832` and `29971908662` made 24 successful GPT-5.6 Terra calls. Usage was 81,646 input tokens, including 80,744 cache-write tokens, plus 22,782 output tokens. At the July 22 standard rates, the measured model cost was about $0.60.
- Scoped Ask QA exposed and fixed a mixed-verification wording bug. The tool payload now states that `state_primary_ballot` records are verified for the primary while `state_general_filing_unofficial` records are provisional only; it also supplies ballot lines. State-scoped Senate and Debbie Dingell member-scoped tests then returned the correct candidates, verification split and race citations through Terra without fallback.
- Live health remains `WARN` with no critical findings. Verification: two live backfills, 46/46 tests, TypeScript, ESLint, `git diff --check`, workflow YAML, the Next.js 16.2.11 production build and both production dependency audits pass.

---

## 2026-07-22 — Nebraska certified primary adapter

**Session Summary:**
- Added Nebraska as the fifth state-authority adapter after New Hampshire's official site rejected unattended requests from the ingest environment. The New Hampshire source remains unimplemented rather than relying on a brittle or unofficial copy.
- Activated four Nebraska contests with 27 distinct candidacies: 12 current and 15 historical. The certified-primary backfill contains 26 result rows and 12 party nominees; the live load also stored 38 ballot lines and 38 append-only status events.
- The adapter retains primary losers as inactive history. A certified Senate primary winner who is absent from the current state list is also inactive with an explicit `certified_primary_winner_not_on_current_list` status; the pipeline does not infer why the state removed the person from its current list.
- Linked nine current candidacies to FEC records and left three unmatched rather than guessing. The first campaign-evidence pass attempted all nine linked candidates, verified seven committee-reported sites, crawled six and recorded two no-site blocks plus one robots-policy failure.

**Notable Changes:**
- Reconciles every current partisan candidate against the top vote-getter in the state result pages, then uses the June 8 Board of State Canvassers record and official canvass PDF to set certified result status. Dan Osborn is admitted separately only because the state published a July 16 certification that his petition qualified him for the general ballot.
- Added exact-header workbook parsing and bounded official-result HTML parsing. Structured records exclude the workbook's city, mailing address, phone and email fields. Seven source responses are retained as private hash-addressed snapshots before database writes.
- The result site still renders the words “Unofficial Results.” The adapter preserves that value-source snapshot in event details but does not treat the page label as certification; the separate state canvass record controls certification status.
- Two live backfill loads left all structured counts stable. Nine unique private source snapshots remain because two mutable official HTML responses changed bytes between runs; hash-addressed storage retained both versions rather than overwriting evidence.
- GitHub Actions runs `29970851178` and `29970937486` made six successful GPT-5.6 Terra calls with 10,950 input tokens, including 9,962 cache-write tokens, and 5,561 output tokens. At the July 22 standard rates, the measured model cost was about $0.12.
- The evidence pass stored 15 private campaign-page snapshots and queued 30 claims plus seven prior-service records. All 37 records remain `needs_review`; none are published or available to Ask.
- Local production-route checks returned 200 for Nebraska's state, all four race, race-index, health and race-CSV routes. State-scoped Ask correctly returned the current Senate field and certified primary totals; Pete Ricketts' member-scoped Ask returned only his two current general-election challengers. Both calls used Terra without fallback.
- Health remains `WARN` with no critical findings. The warning set consists of disclosed source, crawl, review and historical sync conditions, including nine Indiana certification expectations that are overdue under the current registry defaults.
- Verification: two live backfills, 42/42 tests, TypeScript, ESLint, `git diff --check`, workflow YAML, the Next.js 16.2.11 production build and both production dependency audits pass.

---

## 2026-07-22 — Rhode Island verified ballots and evidence-cost control

**Session Summary:**
- Added Rhode Island as the fourth state-authority adapter. The official Department of State workbook supplies explicit qualified-for-ballot-placement, primary-ballot and general-ballot fields for all three federal contests.
- Activated 12 candidacies: 11 active ballot-qualified candidates and one candidate who did not qualify. The live load stored one private workbook snapshot, 12 append-only status events and 11 ballot lines; a second load left every count unchanged.
- Completed the first campaign-evidence pass for all nine active candidacies with conservative FEC links. Two additional active candidates remain unlinked rather than being matched by guesswork.

**Notable Changes:**
- Built an exact-header, fail-closed workbook parser. Structured records retain only candidate name, party, office, district, qualification and ballot/result flags; they exclude the source voter ID, address, phone and email fields. Inflated OOXML is capped separately at 10 MB so a legitimate 487 KB workbook can be parsed without weakening zip-bomb protection.
- The three contests are labeled `verified_ballot`, current stage `primary`, with September 9 as the next expected event. The adapter already understands later primary-winner, primary-loss, general-winner and general-loss flags without treating them as certified vote totals.
- FEC linkage found nine of the 11 active candidacies. The evidence pass verified seven committee-reported sites, crawled six, blocked two with no current principal or authorized committee site and rejected one cross-host redirect. It stored 15 private page snapshots and queued 29 claims plus five prior-service records. All 34 records remain `needs_review`; none are published or available to Ask.
- GitHub Actions runs `29969934091` and `29970014668` made nine successful Terra calls with 14,110 input tokens, 11,193 cache-write tokens and 5,216 output tokens. At the July 22 standard GPT-5.6 Terra rates, the measured model cost was about $0.12.
- Fixed repeat-spend churn in both candidate and member biography pipelines. Change detection now hashes normalized evidence text plus canonical page URL instead of raw CMS HTML, so template, script and navigation changes no longer create new snapshots or model calls when the evidence visible to extraction is unchanged.
- Verification: 39/39 tests, TypeScript, ESLint, `git diff --check`, workflow YAML, the Next.js 16.2.11 production build, both production dependency audits and a live source dry-run pass. The adapter was pushed as `62c9103` before activation.

---

## 2026-07-22 — Florida election authority and challenger evidence

**Session Summary:**
- Added Florida as the third state-authority adapter. It ingests the Division of Elections' official 2026 federal candidate export, covers all 28 U.S. House districts plus the Class 3 U.S. Senate special election and retains the source file as a private content-addressed snapshot.
- Activated 283 candidacies across 29 contests: 196 active and 87 inactive. The live load stored 283 append-only status events, 283 state candidate identifiers and 187 ballot lines; a second load confirmed that every count remained idempotent.
- Completed a state-scoped first campaign-evidence pass for every active Florida candidacy with an FEC link. The 19 sequential GitHub Actions batches attempted all 146 candidates without overlapping work.

**Notable Changes:**
- Built a fail-closed, exact-header TSV parser for the Candidate Tracking System. Structured records keep only the public candidate account ID, name, party, office, district and status; they exclude voter ID, address, phone, email, treasurer and contact fields. The complete source export remains private for auditability.
- Mapped qualified major-party candidates to the August 18 primary, minor-party and no-party candidates to the November 3 general, unopposed candidates to the general, and write-ins to active candidacies without printed ballot lines. Withdrawn and did-not-qualify records remain visible as inactive history.
- Modeled the statewide race as `2026-FL-S3-special`, with Florida Statute 100.161 as the official special-election authority. Coverage remains `verification_pending` because the state describes its Candidate Tracking System as an unofficial reference.
- Added allowlisted URL-encoded POST support to the bounded source fetcher. Redirects are rejected on POST so request bodies cannot be replayed to another origin; the existing HTTPS, DNS, type, size and timeout controls remain in force.
- Added `--state` / `CANDIDATE_EXTRACT_STATE` and a manual workflow state input so large-state research batches cannot be displaced by retries from another state.
- The research pass verified 109 FEC committee-reported sites and crawled 79 successfully. It stored 234 private page snapshots and queued 438 campaign claims plus 36 prior-service records through OpenAI GPT-5.6 Terra. All 474 records remain `needs_review`; none are published or available to Ask.
- Thirty-seven candidates had no current principal or authorized committee site. Current site failures total 67: those 37 no-site blocks, 12 robots exclusions, 3 redirect/host allowlist rejections, one HTTP 403 and 14 other bounded crawl errors. Another 50 active Florida candidates have no conservative FEC staging link and were not site-resolved by guesswork.
- The 19 runs made 84 provider calls and recorded 295,209 combined input/output tokens. Future campaign runs now report calls, input, cached input, cache-write and output usage separately for each provider so official prices can be applied exactly instead of estimating from a combined total.
- Verification before the evidence batches: 36/36 tests, TypeScript, ESLint, `git diff --check`, the Next.js 16.2.11 production build and both production dependency audits pass. The adapter and state-scoping commits are pushed as `f4f9619` and `cc58b82`.

---

## 2026-07-22 — Delaware election adapter and challenger evidence

**Session Summary:**
- Added Delaware as the second state-authority adapter. It ingests the Department of Elections' official 2026 primary and general candidate workbooks, seeds the two federal contests at their current primary stage and keeps coverage `verification_pending` until a ballot or certified-result source is available.
- Activated 11 state-authority candidacies: 10 active candidates and one withdrawal across U.S. House At-Large and U.S. Senate Class 2. The live load stored 2 private source snapshots, 10 qualified ballot lines and 11 append-only status events.
- Ran FEC-linked campaign research for Delaware in GitHub Actions. Four current committee-reported sites were verified, one candidate had no current principal or authorized committee website, and five active candidates remained unlinked because no matching FEC staging record exists.

**Notable Changes:**
- Extracted shared and inline OOXML parsing into a reusable bounded utility. The Delaware parser reads only office, ballot name, party, filing/withdrawal dates and public status; it never retains the source workbooks' address, email, phone or website columns and fails closed on unknown federal statuses.
- Added daily due checks plus manual `DE` and `all` workflow dispatches. Two live ingests proved idempotent: source snapshots, candidacies, ballot lines and events did not duplicate.
- Expanded conservative common-first-name matching to link Chris Coons to the unique Christopher A. Coons FEC record. Five of Delaware's 10 active candidates now have an exact or unique conservative FEC link; unsupported matches remain empty.
- GitHub Actions run `29966891499` crawled 13 campaign pages and queued 30 claims plus 4 prior-service records through OpenAI GPT-5.6 Terra. All 34 records remain `needs_review`; no model-extracted claim was published or supplied to Ask.
- Corrected race-page history copy so a withdrawn general-election record is not mislabeled as an earlier primary candidate.
- Patched Next.js and `eslint-config-next` from 16.2.10 to 16.2.11 after the final audit found newly published high-severity advisories. Both npm and pnpm production audits now report zero known vulnerabilities.
- Verification: 34/34 tests, TypeScript, ESLint, `git diff --check`, the Next.js 16.2.11 production build and the live health gate pass. Local production responses returned 200 for Delaware state, House race, Senate race, race index, health and race CSV routes. Health remains `WARN` for disclosed source/review conditions. The in-app browser had no available target, so visual and click QA remain unverified.

---

## 2026-07-22 — Election and biography activation

**Session Summary:**
- Applied the idempotent election and biography schema to the connected Neon database; the final precision and discovery updates bring it to 98 statements. Created a private Vercel Blob evidence store linked to development, preview and production environments.
- Loaded Indiana's mid-cycle election backfill from state sources: 9 contests, 61 candidacies, 53 primary-result rows and 3 immutable source snapshots. All 9 contests remain `verification_pending` because the primary feed labels its results unofficial and the general workbook is incomplete.
- Attempted every active member with a roster-provided official site. The final pass crawled 510 of 536 sites, queued 3,908 exact-quote biography facts for 460 members and left every fact in `needs_review` pending a named human decision.
- Attempted all 17 FEC-linked active Indiana candidacies. Fifteen committee-reported campaign sites were verified, 9 crawled successfully, 2 no-site outcomes were recorded as blocked and 70 exact-quote records were queued: 61 campaign claims plus 9 prior-service records. The other 9 active candidacies remain unlinked rather than guessed.

**Notable Changes:**
- Fixed Neon HTTP incompatibility in election and campaign-site ingestion by replacing interactive transactions with stable, idempotent upserts.
- Added conservative FEC identity matching for ballot names with middle names, initials and common first-name variants. Indiana's active candidacy linkage improved from 11 of 26 to 17 of 26; ambiguous or unsupported matches remain empty.
- Added bounded failed-site retries, raised the official-page byte cap to 2 MB and preserved valid root/about evidence when an optional secondary page fails. The retry recovered 20 of 46 failed official sites; 24 of the 26 remaining failures are unverifiable robots policies and stay fail-closed.
- Moved weekly candidate and member evidence collection ahead of both FEC finance ingests and isolated the steps from unrelated failures, giving challenger discovery the first small share of the weekly API quota. The guards use `!cancelled()` so a deliberate workflow cancellation still stops downstream spend.
- Added manual `research`, `candidates` and `members` workflow modes for evidence-only recovery. They avoid replaying unrelated roster and finance pipelines, and candidate-specific retries no longer spend a member-biography batch.
- Preserved year-only prior-service dates as source-precision text instead of inventing January 1. Added targeted forced re-extraction, recovered Erin Houchin's 2014–2022 state Senate record and stopped failed or no-site discoveries from starving untouched candidates.
- Corrected health recovery semantics: only the latest unrecovered failure per pipeline affects current status, while resolved failures remain in the append-only log. Candidate health now separates 6 verified-site crawl failures from 2 blocked no-FEC-site discoveries; the connected database health gate returns `WARN` instead of a stale `CRIT`.
- Created a private Blob store after confirming the uploader correctly rejected a mistakenly created public store; the empty public store was deleted. A live candidate run caught a dotenv banner accidentally piped into the first GitHub Blob secret; Blob, OpenAI and Anthropic were then refreshed with silent parsing and no value output.
- Pushed the activation series to `ask-portfolio-polish`, from `203ee5f` through `26cb679`. Vercel previews built successfully; production was not changed.
- Final validation: TypeScript, ESLint, 31/31 tests, `pnpm audit --prod`, `git diff --check` and the Next.js production build pass.
- Operational warning: relinking Vercel environment variables replaced `.env.local`; its local-only FEC and Congress keys are no longer present. The GitHub Actions secrets remain available, so key-dependent ingests continue there until the local values are restored.

---

## 2026-07-22 — Verified biographies and exact member-profile Ask

**Session Summary:**
- Added a verification-first biography layer for lawmakers and challengers. Lawmaker sources must be official House or Senate domains discovered from the congressional roster; challenger sites must come from a current FEC principal or authorized committee record tied to a state-authority candidacy.
- Member-page Ask scope now follows the member's exact physical seat. House members see only their district; senators see only their seat class and any known special election for that class. The browser never supplies this scope.
- Published biography facts now appear on member and race pages and are available through strict Ask tools. Model-extracted records remain hidden until a named human reviewer verifies the source and quote.

**Notable Changes:**
- Built Capitol Releases-style recon with CMS classification, robots handling and bounded same-domain crawling. Source fetches are HTTPS-only, DNS-checked against private, loopback, link-local and metadata addresses, redirect-revalidated, content-type checked and capped by time and bytes.
- Private Vercel Blob snapshots are content-addressed and linked to every extracted claim. Scripts and forms are removed before model input; scraped text is explicitly treated as hostile. Validators discard any claim whose exact quote does not occur in the captured page.
- GPT-5.6 Terra remains the Ask and extraction primary; Claude Sonnet 5 is the independent fallback. Ask uses the Responses API, strict direct tools and exact SQL instead of embedding structured records. Biography and challenger claims receive claim-level citations, and unissued citation markers are stripped.
- Added per-IP and global/provider Ask budgets, same-origin and body guards, HMAC identifiers, hard request/tool/token limits, zero SDK retries, provider fallback, review attribution and health reporting. Unchanged official and campaign pages now skip both Blob uploads and model extraction.
- Added weekly incremental member research and a manually batched biography backfill workflow. The health page reports official-site crawl failures, review queues and published coverage.
- Verification: TypeScript, ESLint, `git diff --check`, 29/29 tests, `pnpm audit --prod` and `next build` pass. Exact member-scope paid evals passed on Terra and Sonnet 5; the final runs were 3.6s and 4.8s. A live Jim Banks crawl found four official pages, and local HTTP checks returned 200 for member, races, race and health routes.
- The in-app browser was unavailable, so visual and click QA remains unverified. The biography schema was not applied to the external database, no review records were published, and nothing was pushed or deployed.

---

## 2026-07-22 — Verification-first 2026 races and campaign research

**Session Summary:**
- Added a normalized, append-only election layer over the existing FEC staging table: contests, stages, people, candidacies, repeating ballot lines, status events, results and ranked-choice rounds. Senate contest IDs include seat class; special elections require a manual official-source URL.
- Built the mid-cycle bootstrap around historical backfill rather than a pre-cycle monitor. Indiana is the first adapter. Its current statewide feed still marks the primary results unofficial and its general candidate workbook says it is incomplete, so the product labels those records verification pending instead of certified.
- Shipped `/races`, `/race/[contestId]`, state-page race lists, race CSV, sitemap entries and a full `/health` coverage matrix. State-authority data dual-reads first; uncovered states and pre-schema deployments retain the existing clearly labeled FEC-only fallback.

**Notable Changes:**
- Official source bytes are hash-addressed in private Vercel Blob storage before election writes. The daily workflow uses the existing scheduler plus due rows and manual dispatch; special elections remain manual registry entries because governor proclamations have no reliable national feed.
- Added FEC committee-reported campaign-site discovery, an HTTPS-only and DNS-pinned crawler, private/link-local/metadata blocking, redirect revalidation, robots handling, host allowlisting, page/byte/time limits and immutable private page snapshots. Model text is treated as hostile input; scripts, forms and navigation are excluded.
- Campaign extraction uses GPT-5.6 Terra Structured Outputs with Claude Sonnet 5 fallback. Both live synthetic provider evals passed. Every output must carry an exact quote found in the cited snapshot; invalid quotes are dropped, and valid records remain `needs_review` until `review-candidate-research.ts --apply` verifies or rejects them. Race pages publish only verified claims and prior service.
- Campaign extraction ships with per-run candidate, page, character, provider-call and token caps. Weekly ingestion records partial failures in `sync_log`; `/health` surfaces crawl errors and the review queue.
- Paid Ask evaluation found and fixed a real Anthropic fallback outage: a nullable enum schema returned HTTP 400, and compiling all eight strict tools exceeded the route deadline. The fallback now uses a deterministic topic router, strict relevant schemas, forced first retrieval, server-side sentinel cleanup and a forced terminal answer after evidence. OpenAI passed 18/18. Anthropic passed 17/18 in the final full run; the only failed finance-routing regression then passed its isolated rerun after the router fix. Forced OpenAI-to-Anthropic failover passed.
- Hardened FEC API retries with timeouts, bounded `Retry-After`, 5xx handling and API-key redaction. CSV exports now neutralize spreadsheet formulas in untrusted text. `pnpm audit --audit-level high` reports no known vulnerabilities.
- Verification: 23/23 tests, TypeScript, ESLint and `next build` pass. Indiana dry-run parsed 61 current records with no writes. Thirteen core routes and exports returned 200 from the production build. The in-app browser exposed no browser target, so visual/click QA remains unverified. No schema was applied to the external database, and nothing was pushed or deployed.

---

## 2026-07-22 — Midterm product rebuild and scoped records assistant

**Session Summary:**
- Repositioned the product around voters, journalists and the 2026 midterms. The homepage now leads to address lookup, state records and journalist exports; state and member pages each have a server-enforced scoped assistant.
- Demoted STOCK Act pages to a no-indexed “coming feature” preview. Removed trade promotion from navigation, search, sitemap, homepage/state social cards and generic member-coverage language while preserving the ingestion and preview routes.
- Rebuilt `/api/ask` as a provider-neutral strict tool loop. GPT-5.6 Terra is primary and Claude Sonnet 5 is fallback; both must finish through `submit_answer`, and factual answers without a completed record retrieval are rejected.

**Notable Changes:**
- State scope allows only members and races in that state. Member scope allows only that Bioguide ID and seat. Stock/disclosure tools are intentionally absent. Exact SQL retrieval remains the factual layer; embedding search is reserved for future long-form document corpora.
- Added OpenAI Responses API support, one-provider failover, provider-attempt budgets, per-IP limits, same-origin JSON POST guards, byte-limited bodies, request cancellation, a shared 45-second deadline, zero SDK retries, HMACed IP/safety/cache identifiers, non-plaintext cache keys and daily expired-row cleanup.
- Model evaluation: GPT-5.6 Terra passed 12/12 scoped, grounding and injection cases at a 2.93-second average. Claude Sonnet 5 passed 10/12 in the full run; the terminal-status miss and one transient timeout both passed targeted reruns. A controlled invalid-OpenAI-key test completed through Sonnet with `fallbackUsed: true`.
- Added nonce-based Content Security Policy through `proxy.ts`, generic page-error copy, additional response headers, search rate limiting and an actual POST-only `/find` flow so street addresses no longer enter URLs.
- Upgraded Next and its lint config to 16.2.10, added OpenAI SDK 6.47, and pinned patched transitive packages across npm and pnpm. Full `npm audit` and `pnpm audit` both report zero known vulnerabilities.
- Added live roster, 2026 FEC-filer and roll-call-position CSVs for journalists. The vote export initially exceeded Neon’s 64 MB response limit; route verification caught it and the final implementation streams cursor-paginated 10,000-row batches.
- Verification: `pnpm exec tsc --noEmit`, `pnpm lint`, 5/5 security tests, `pnpm audit --prod` and `pnpm build` pass. Local route/header checks confirmed scoped page copy, CSP, no-index stock metadata, CSV headers and a real member-scoped Ask response from Terra. The in-app browser had no available tab, so visual/click testing remains unverified. Nothing was pushed or deployed.

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
## 2026-07-19/20 — Overnight loop: ask hardening round 2, seat charts, 2026 candidates

**Session Summary:**
- Shipped the full Round 2 worklist from docs/ask-security-review.md (commit 9c5cbf1): gate ordering (validate real states/districts, per-IP limit, cache, then global model budget), cross-site guards in lib/request-guards.ts, POST no-store locate with Census timeout, stop-reason branching, 12-tool/45s budgets, evidence-checked link sanitizing.
- New find_member tool ended the "how much has AOC raised" dead end; prompt now forbids reply invitations, redirects voting logistics to vote.gov, and refuses endorsements with a factual substitute.
- Loading UX rebuilt from research (five background agents: security, abuse patterns, UX, challenger data sources, 2026 primary calendar): optimistic pending card, honest timer-based escalation copy, cancel, personalized chips, examples dropdown, singular-pronoun nudge, neutral 429 states with Retry-After minutes.
- Homepage "Congress at a glance": State map / House / Senate toggle with hemicycle seat charts (dd250fc). The Senate chart immediately exposed 101 sitting senators in the DB.
- Root cause: members ingest never retired anyone. Added a retirement pass with a size guard; first run retired G000359 (Graham, died Jul 11), S001157 (Scott, died Apr 22), C001127 (Cherfilus-McCormick, resigned Apr 21). Members ingest moved weekly -> daily. Flushed ask_cache so no cached answer cites a deceased member.
- Freshness panel now shows true table depth (Finance 2,811, Votes 344,961) instead of last-run batch size. Hero corrected to "535 voting members"; /about roster copy computes sitting/vacant counts from the DB at render time (7c81c96, per pre-push review).
- 2026 candidates pipeline (eb14bb5): election_candidates table, FEC Form 2 ingest (statutory filter), daily CI step, get_race_candidates ask tool with a departed-incumbent cross-check — "who is running against Lindsey Graham" now leads with his death and names the current officeholders. Senate filers loaded (281); House lands with first CI run (FEC_API_KEY is CI-only).
- Member pages: "The 2026 race" card for seats on the ballot (be471ba). State pages: pre-scoped ask bar; "Checked:" citations click through to source pages (1a54b88).
- Eval grew from 6 to 13 cases (nickname cross-state, vote.gov redirect, opinion bait, injection, race filers); 12/12 behavioral passes on Haiku 4.5.

**Notable Changes:**
- Two Opus reviews gated the work (mid-loop diff review; full pre-push review). Verdicts: ship / fix-first, with the fix-first item (hardcoded /about roster snapshot) resolved in 7c81c96.
- Seven commits, 9c5cbf1..7c81c96, each behind a clean next build. Not pushed.
- Still user-gated: push, rename (yourdelegation.com / knowyourdelegation.com / delegationwatch.org available Jul 19), House Clerk PTR key rotation (dead ~87 days), Anthropic Console spend cap, Vercel WAF.

---
## 2026-07-22 — Ask polish: deep retrieval, claim citations, follow-ups, SSE; finance committees + 118th backfill

**Session Summary:**
- Retrieval filters: get_member_votes and get_member_bills now take topic / date_from / date_to / congress (and finance takes cycle) backed by new searchMemberVotes / searchMemberBills in lib/queries.ts — per-word ILIKE over vote text plus linked bill title and policy area, with matched/showing totals so the model discloses "10 of 21 matching votes shown." Prompt bumped to midterms-grounded-v4.
- Claim-level citations, cost-neutral: the engine annotates every retrieved record with a ref (v1, f2...); the model appends bracket markers; lib/ask-citations.ts strips markers the registry never issued, renumbers survivors, and the client renders superscript footnotes plus a collapsible Sources drawer with dated, linked records. No second model call (~30 extra output tokens).
- Scoped follow-ups: the client sends the last two exchanges; the route (body cap 2K -> 8K) truncates and sanitizes them; the engine renders them as pronouns-only context. The answered-requires-trace guard still forces fresh retrieval, follow-ups bypass the shared answer cache in both directions, and scope stays server-locked. "What about her donors?" works on a state page now.
- SSE progress: with Accept: text/event-stream the route streams verified tool events ("Checked roll-call votes — 10 records") and a terminal result identical to the JSON path, which stays untouched for eval and tests. No token-level answer streaming by design — answers must pass link and citation validation whole.
- Eval upgrade: expectTools (subset match on trace tool+args), dbTruth (live Neon ground truth with tolerant money/date matchers), latency/token budget WARNs, and a failover case asserting fallbackUsed. 17 cases; new topic-votes, bills-topic, latest-vote, finance-cycle all pass on gpt-5.6-terra.
- Finance committees (new data layer): scripts/ingest/finance-committees.ts pulls each member's linked committees (principal, leadership PAC, joint), per-cycle committee totals, and top contributors by donor employer — finally populating the top_contributors table that has been empty in prod since launch (finance.ts skipped contributors to save requests). Also fixed finance.ts staleness: existing members now get a current-cycle refresh instead of freezing at first ingest. Wired into get_member_finance ("does Sen. X have a leadership PAC?" is answerable once the weekly runs).
- 118th Congress backfill: votes.ts and bills.ts take --congress=118; votes batch-insert positions (also speeds the daily run), bills get a resumable ingest_cursors offset and a per-run detail-fetch cap. New ingest-backfill.yml workflow_dispatch. Coverage prose on /about is now computed from MIN/MAX(congress) in the DB so it can never claim coverage the backfill hasn't delivered.
- Health: fixed a dead check — staleness thresholds were keyed by entity names but indexed by sync_log.source, so they never fired; now keyed by entity_type. New checks: empty finance-committee tables warn until the first ingest, and a successful votes backfill whose rows vanish goes crit.

**Notable Changes:**
- AGENTS.md corrected: /ask is dual-provider (gpt-5.6-terra primary, claude-sonnet-5 fallback), not Haiku. The devlog's earlier find_member claim was wrong — no such tool exists in code; its dead client label was removed rather than wired up, since it contradicts the hard page-scope rule.
- Verified: clean next build, 11/11 tests (new tests/ask-citations.test.ts; npm test now globs tests/*.test.ts), 4/4 targeted paid evals, and a live browser pass on /state/IN — streamed progress, footnotes, Sources drawer, and a follow-up that resolved "her" and honestly reported the empty contributor tables.
- User-gated next steps: push, dispatch ingest-backfill.yml for congress 118 (bills needs ~6 re-runs until "Backfill complete"), and one weekly-ingest dispatch to populate finance committees and refresh frozen 2026 totals (the browser test surfaced Houchin's 2026 receipts recorded as $0 — the staleness fix corrects it on that run).

---
## 2026-07-29 - /ask observability, validation, guardrails, honesty + eval stack + admin log

**Session Summary:**
- Built the accountability layer for /ask ahead of the Houston Chronicle newsroom-AI interview, framed as four ideas: notebook (audit log), confession (answer status), scorecard (/health panel), bouncer (input moderation).
- New `ask_log` table (applied to Neon): one row per request through every exit path — full question and answer, scope, tool trace, provider/model/fallback, tokens, latency, outcome, error class, refusal category, citation count and coverage, HMAC'd IP, 90-day retention on the existing cleanup cycle. Writes are fire-and-forget (`lib/ask-log.ts`) so logging can never delay or break an answer.
- The model's terminal status (answered / not_found / out_of_scope / declined) — previously validated then discarded in `parseTerminalAnswer` — now flows through AskResult, the API payload, the answer cache, the log, and the client, where non-answered replies get an amber boundary badge. Anthropic refusal `stop_details.category` captured on AskError.
- `citationCoverage()` added to `lib/ask-citations.ts`: share of answer sentences carrying a validated marker; logged and trended, not gated.
- Input moderation (`lib/ask-moderation.ts`): OpenAI's free omni-moderation endpoint screens fresh questions before any paid call; fail-open with a 3s timeout; flagged inputs logged as `flagged_input` and rejected 422.
- /health gained an Ask panel (24h/7d outcome mix, cache hits, fallbacks, p50/p95 latency, tokens, coverage, zero-citation count, provider budget vs cap) plus three alarms (error rate >30%, coverage <50%, budget ≥80%) that flow into the existing health-check CI gate.
- Disclosure per AP/Trusting News audience research: every answer footer now says AI-written, not reviewed by a person before display, verify before citing, with a mailto "Report a wrong answer" link. /about discloses the audit log (prior copy implied questions weren't stored in plaintext — corrected) and the moderation screen.
- Eval stack deepened into three tiers. Depth: eval-ask.ts grew to 19 cases — new `verified` provenance field ({source, by, on}, printed on FAIL; roster and senate-term facts checked against senate.gov and houchin.house.gov, attributed as Claude browser checks pending Trevor's own confirmation) and a new national-scope `national-member` case covering the previously untested find_members path. Breadth: new `scripts/eval-ask-sweep.ts`, one national-scope roster question per delegation (56), self-graded from the members table (SWEEP_LIMIT / SWEEP_STATES). Organic: ask_log rows feed future golden cases.
- First full sweep: 52/56. The four failures produced three real fixes — get_delegation/find_members tool descriptions now route territory place-names correctly (AS/VI had flaky not_found), the sweep grader accepts compound-surname components (PR "Hernández Rivera", SC "Graham Nordone"), and get_delegation/find_members records now get annotated citation refs (prefix `d`), killing the model's improvised "[current member roster]" bracket labels. Re-run of AS/PR/SC/VI: 4/4.
- New private `/admin/ask-log` page: last 100 logged Q&As with outcome badges, meta line, expandable answers, and tools checked. Gated by `?key=` compared in constant time against `ASK_ADMIN_KEY`; 404 for everyone while the env var is unset (verified in browser). Key still needs to be set in .env.local and Vercel.
- Handoff doc written for the capitol-releases RAG build: `capitol-releases/docs/rag-validation-handoff-2026-07-29.md` — maps every concept here to its RAG equivalent (retrieval logs, chunk-level citations, retrieval evals vs answer evals, corpus-side injection).

**Notable Changes:**
- Files: scripts/schema.sql (+ask_log), lib/ask-log.ts (new), lib/ask-moderation.ts (new), lib/ask-engine.ts (status threading, refusal category), lib/ask-citations.ts (coverage + roster refs), lib/ask-limits.ts (cache status, setCachedAnswer object arg, log cleanup, exported budget cap), app/api/ask/route.ts (logging at all seven exits, moderation gate), lib/health.ts + app/health/page.tsx (Ask panel + alarms), components/ask-client.tsx (status badge, disclosure footer), app/about/page.tsx (audit-log + moderation disclosure), scripts/eval-ask.ts (expectStatus, verified provenance, national case), scripts/eval-ask-sweep.ts (new), app/admin/ask-log/page.tsx (new), AGENTS.md (sweep documented).
- Verified: clean tsc + next build; roster/opinion/national-member evals pass both providers; 56/56 sweep after fixes; live browser passes on /ask (answered + boundary badge + Sources drawer), /health panel with real rows, /about copy, admin 404 gate.
- User-gated next steps: set ASK_ADMIN_KEY, re-verify the two eval ground-truth facts personally (swap attribution to TB), commit today's work, then the Ask-first homepage/ask UI restructure (question box above location, location as toggle) — plan in progress.

---
## 2026-07-29 (overnight) - Ask-first UI, UX audit, golden baseline

**Session Summary:**
- Ask became the site's front door: question box in the homepage hero, nav cards demoted to a link row, location collapsed to a pill opening a State (type-ahead over 56 delegations) / Address (Census geocoder) popover. Scope plumbing untouched.
- UX audit via four user stories (desktop Chrome + headless Playwright at 390x844). Fixes shipped: Enter selects the top state match; homepage recent-activity rows gained min-w-0 (pre-existing phone overflow to 779px — the documented grid pitfall); /find mounts with the Address tab open (location-first page); "1 races" pluralization.
- Golden baseline before the interview: eval 19/19 on Anthropic and 19/19 on OpenAI after two stale-grader fixes (Indiana races are state-authority covered now, so race-filers grades on the field not FEC wording; opinion legitimately ends status "answered" with refusal text). Delegation sweep 56/56 including territories after the get_delegation/find_members description fixes.
- All Ask surfaces verified in-browser: home, /ask, /find, state, member, race embeds; /health and /races checked; 404 page incidentally verified.

**Notable Changes:**
- components/ask-client.tsx (restructure + pill/popover + defaultLocationOpen/Tab props), app/page.tsx (hero + min-w-0), app/find/page.tsx, app/races/page.tsx, scripts/eval-ask.ts (expectStatus precedence, regraded cases).
- Commits (unpushed pending Trevor's morning review): 9c0626b, 2d5c85d, 6e7aeb5, 2241f66, a9b2eba. Prior push: d1b193d.
- Mobile screenshots from the audit: session scratchpad m1–m6 PNGs.

---
## 2026-08-03 — Audit and hardening pass before hiring-manager review

**Session Summary:**
- Full-repo audit in priority order (correctness, security/spend, pipeline health, code health, docs truth), then fixes as small local commits. Nothing pushed without review.
- Test suite went 79/82 to 82/82: three citation tests still asserted pre-anchor hrefs and a `verified_prior_service` key the race tool never emits. The code was right; the expectations moved to shipped behavior (d763ec0's section anchors, `prior_service_stated_by_campaign`, fact_type/quote biography records).
- CI gate added at last: .github/workflows/ci.yml runs npm test, ESLint, and tsc --noEmit on every push and PR; `typecheck` script added. The README roadmap had admitted this gap since the tests landed.
- Ingest failure issues now open fresh per workflow per day. The old de-dupe reused the most recent open `ingest-failure` issue forever, which is how issue #1 (April 29) collected four months of unrelated daily and weekly comments.
- /health told two lies, both fixed. The House PTR note still said "paused pending key rotation" while the daily workflow re-enabled the step July 27 — the real residue is four oversized filings (three Khanna, one McCaul) that blow the vision parser's 16,000-token output cap and mark the source failed daily. And the finance-backlog alarm added the same morning crit-ed at >50% stale share (77% at ship), which failed today's weekly dispatch and would have redded every daily until the budget-limited crawl drained — demoted to warn with the percentage in the title; a dead crawl still crits via sync staleness.
- /ask security guards re-verified end to end against docs/ask-security-review.md: validation before spend, IP limit before cache before moderation before provider budget, same-origin and byte-limited POSTs, no-store POST locate with a 6s geocoder timeout, 12-call/55s engine budgets with no SDK retries, HMAC-hashed IPs and cache keys, retention cleanup. The review doc's status paragraph matches the code.
- README rewritten from the route tree, workflows, and .env.example: Ask, trades, races, /for-journalists, /health, all seven CSVs, the real stack (no Recharts — charts are hand-rolled SVG), thirty env vars, npm test, honest roadmap.
- npm and pnpm override blocks reconciled: npm's blanket esbuild 0.28.1 became the same per-range pins pnpm uses, so CI (npm ci) and Vercel (pnpm) finally install the same tree. Which lockfile survives is still an open decision — Vercel detects pnpm-lock.yaml while workflows run npm ci.
- Trade timeline: aria-label now reports purchase/sale counts and points at the table below; tooltip date formats readably (UTC-pinned). Verified in-browser on /trades/K000389.

**Notable Changes:**
- The May 31 UI/UX list is now mostly closed: tabular-nums rides the global mono rule, the timeline has a real accessible name, dates format consistently. Still open: /trades loads all transactions per request (server-side aggregation is the fix) and a pre-existing dev-only hydration warning from Date.now() in trade-timeline layout.
- Files: tests/ask-citations.test.ts, .github/workflows/{ci,ingest-daily,ingest-weekly}.yml, lib/health.ts, components/trade-timeline.tsx, package.json, package-lock.json, README.md.
- Known-good gates at session end: next build clean, tsc clean, eslint clean, 82/82 tests, npm ci and pnpm install both verified.

---
## 2026-08-03 — Evening ship: CI live, issue hygiene, pnpm-only

**Session Summary:**
- Second half of the day's audit session: everything the morning pass held for approval got decided and shipped. Eleven audit commits pushed (8a22e65..928aee5), then the pnpm standardization (07738cc).
- CI ran for the first time in this repo's history and passed twice: once on the audit push (npm-based), once after the pnpm switch. Test, lint, and typecheck gate every push and PR now.
- Issue #1 closed with a summary comment explaining the four months of piled-up failure reports; the de-dupe fix means future failures open fresh dated issues per workflow per day. Zero open issues at close.
- Merged branches ask-portfolio-polish and fix/review-findings deleted on origin and locally; both were 0 ahead of main.
- Package manager unified on pnpm: all five workflows install with pnpm install --frozen-lockfile via pnpm/action-setup@v4, version pinned by the new packageManager field (pnpm@10.28.1), package-lock.json and the npm-only overrides block deleted, README setup updated. Production already built with pnpm, so prod behavior is unchanged by design.
- Dead code resolved: components/trades-monthly-bars.tsx removed (orphaned since 53487e3); eval-ask-sweep kept and wired as pnpm run eval:ask-sweep to match its sibling evals.
- elections.ts got the two zero-risk cleanups from the code-health survey: one ADAPTER_STATES constant replaces a four-times-repeated state literal, and the dry-run BACKFILL ternary with identical arms is gone.

**Notable Changes:**
- Production deploys verified READY at 928aee5 and 07738cc; live /health confirmed serving the corrected House PTR text.
- CI log carries one benign annotation: pnpm/action-setup@v4 internally targets Node 20 and is auto-forced to Node 24 by GitHub. Upstream's issue.
- Deferred, on record: House PTR chunked parsing (4 oversized filings still fail daily, suppressed from the crit gate), /trades server-side aggregation, elections.ts per-state split paired with fecMatchesFor* consolidation (~205 lines to ~30), ALLOWED_HOSTS rename (two different allowlists share the name), party vocabulary unification on party-mark.tsx, trade-timeline Date.now() hydration warning, ASK_ADMIN_KEY missing from .env.example.

---
