# Codex red-team review of /ask, extraction, proxy, exports and public copy (September 5, 2026)

Non-interactive `codex exec --sandbox read-only` run against main at 576cc8e, captured verbatim. Status of each finding is recorded in docs/devlog.md (2026-09-05 entry): findings 1, 2, 5 and 9 were addressed by the citation hard gate merged from interview-safeguards-isolated; 3, 4, 10, 11, 12, 13, 14 and 16 on main the same night; 6, 7, 8 and 15 remain open on record.

**The “all 10 fixed” claim is unsupported.**

Read-only review completed against the latest working files, including `midterms-grounded-v7`. Files changed during the review; findings below reflect the later version. **52 existing tests passed**, but mocked checks reproduced grounding, extraction, crawler, and truncation failures. No files changed, database queries, or paid model calls.

Confidence is high in the identified code paths. Production deployment, WAF configuration, stored records, and live jailbreak success remain unverified.

  **1. High — Unsupported answers can reach the UI and shared cache.** [lib/ask-engine.ts:198](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-engine.ts:198), [lib/ask-engine.ts:597](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-engine.ts:597). A failed lookup still increments the trace, satisfying the “answered” gate; unknown citations are removed without rejecting the prose. A mocked provider returned `answered` with zero citations after a failed retrieval—so successful injection through a biography quote, campaign quote, or bill title would encounter no effective factual-output barrier.

**Fix:** Require successful evidence retrieval and supported, structured claims; reject unknown references and unsupported claims. Use fixed refusal messages for non-answer statuses, and invalidate existing answer caches when changing this gate.

  **2. Med — Fabricated numeric footnotes look validated.** [lib/ask-citations.ts:259](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-citations.ts:259), [components/ask-client.tsx:212](/Users/home/Desktop/dev/active/delegation-decoded/components/ask-client.tsx:212). The server recognizes `[b1]`-style references, while the client renders arbitrary numeric markers as citation superscripts. My `[99]` survived with an empty sources list; those markers also inflate `citationCoverage`.

**Fix:** Reject model-supplied numeric footnotes and generate displayed citation numbers exclusively from validated references. Calculate coverage from those validated associations.

  **3. High — Human approval is promised but bypassed.** [lib/biography-queries.ts:47](/Users/home/Desktop/dev/active/delegation-decoded/lib/biography-queries.ts:47), [lib/elections/queries.ts:519](/Users/home/Desktop/dev/active/delegation-decoded/lib/elections/queries.ts:519), [app/about/page.tsx:677](/Users/home/Desktop/dev/active/delegation-decoded/app/about/page.tsx:677). Public queries accept everything except `rejected`, including newly ingested `needs_review` records without reviewer attribution. `/about` nevertheless promises reviewer names and timestamps before publication or delivery to Ask.

**Fix:** Enforce `verified` status and reviewer attribution in the shared publication queries if that safeguard is intended. Otherwise explicitly disclose automatic publication and remove the approval claims; quotation matching alone does not verify attribution or context.

  **4. High — Invented prior-service metadata is published beside authentic quotes.** [lib/elections/campaign-research.ts:174](/Users/home/Desktop/dev/active/delegation-decoded/lib/elections/campaign-research.ts:174), [app/race/[contestId]/page.tsx:353](/Users/home/Desktop/dev/active/delegation-decoded/app/race/[contestId]/page.tsx:353), [lib/ask-tools.ts:475](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-tools.ts:475). Validation accepted an invented office, jurisdiction, and date supported only by “Alex helped the mayor organize a cleanup.” Those extracted fields reach race pages and Ask, contradicting the broader “only verbatim quotes” guarantee even though `claimText` itself is excluded.

**Fix:** Publish the quote alone unless each structured field has independently validated source support. Require review for inferred office identities and dates.

  **5. Med — Failed lookups are presented as completed checks.** [lib/ask-engine.ts:528](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-engine.ts:528), [components/ask-client.tsx:285](/Users/home/Desktop/dev/active/delegation-decoded/components/ask-client.tsx:285), [components/ask-client.tsx:1235](/Users/home/Desktop/dev/active/delegation-decoded/components/ask-client.tsx:1235). Query exceptions and rejected tool arguments become “Checked … — 0 records,” indistinguishable from successful empty searches. Trace-free refusals also receive “Answered from the delegation roster,” despite performing no retrieval.

**Fix:** Record tool outcomes explicitly as success, empty, rejected, or failed. Render those distinctions and remove the unconditional roster fallback.

  **6. Med — Rejected requests still perform avoidable work.** [app/api/ask/route.ts:76](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:76), [app/api/ask/route.ts:231](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:231), [lib/request-guards.ts:61](/Users/home/Desktop/dev/active/delegation-decoded/lib/request-guards.ts:61). Member-scope requests query member and term records before checking the IP quota, including requests from already-blocked callers. Separately, the body guard buffers the entire request before enforcing its byte limit; a local check consumed 1 MB before rejecting an 8 KB-limited body.

**Fix:** Apply a coarse request limiter before database-backed scope validation, while retaining validation before model-budget consumption. Read bodies incrementally and cancel immediately at the byte ceiling.

  **7. Med — Exhausted providers consume the remaining global budget.** [lib/ask-limits.ts:127](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-limits.ts:127). Both counters increment before provider eligibility is checked, so an exhausted primary consumes a global slot and its fallback consumes another. After 350 primary attempts, the remaining 150 global slots fund only 75 fallback attempts.

**Fix:** Atomically reserve budget only for an eligible provider attempt. Checking an already-exhausted provider must not consume another global slot.

  **8. Med — The deadline does not cover the whole request.** [app/api/ask/route.ts:33](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:33), [lib/ask-engine.ts:572](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-engine.ts:572), [app/api/ask/route.ts:310](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:310). The 55-second engine deadline starts after preparation and excludes input moderation, output moderation, and cache writes. Two three-second moderation calls already push the possible total beyond the route’s 60-second allowance; database calls also receive no cancellation signal.

**Fix:** Establish one deadline at route entry and propagate its remaining budget through database, moderation, provider, and cache operations. Reserve time to send a terminal SSE result or error.

  **9. Med — Anthropic truncation is still accepted.** [lib/ask-engine.ts:382](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-engine.ts:382). Only `refusal` is explicitly rejected before terminal-tool processing; a response marked `max_tokens` can still be returned and cached if it contains a usable `submit_answer`. A mocked Anthropic response reproduced this acceptance.

**Fix:** Accept only the expected completed tool-use stop condition. Reject truncation and other incomplete stop reasons before executing tools or accepting terminal output.

  **10. Med — Crawl limits count retained pages, not requests.** [scripts/lib/candidate-site-crawler.ts:300](/Users/home/Desktop/dev/active/delegation-decoded/scripts/lib/candidate-site-crawler.ts:300), [scripts/lib/candidate-site-crawler.ts:327](/Users/home/Desktop/dev/active/delegation-decoded/scripts/lib/candidate-site-crawler.ts:327). An endless sequence of distinct meta-refresh stubs never increments `pages.length`; my mocked crawl attempted 26 page fetches with `maxPages=1`. Furthermore, `safe-fetch` uses a socket timeout rather than an absolute fetch deadline, allowing sufficiently slow continuous responses to occupy a worker. [Node timeout behavior](https://nodejs.org/api/http.html#requestsettimeouttimeout-callback)

**Fix:** Cap attempted fetches, queued URLs, aggregate bytes, and redirect chains independently. Apply absolute per-fetch and per-crawl deadlines, including DNS resolution.

  **11. Med — Robots handling violates ordinary disallow rules.** [scripts/lib/candidate-site-crawler.ts:138](/Users/home/Desktop/dev/active/delegation-decoded/scripts/lib/candidate-site-crawler.ts:138), [scripts/lib/candidate-site-crawler.ts:305](/Users/home/Desktop/dev/active/delegation-decoded/scripts/lib/candidate-site-crawler.ts:305). Matching uses literal `startsWith`: both `Disallow: /*` and `Disallow: /about$` incorrectly allowed `/about` in local checks. HTTP redirects also bypass a fresh path-policy check, undermining `/about`’s claim that robots rules are respected. [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.3)

**Fix:** Implement RFC-compatible wildcard and end-anchor matching, and check every redirect destination before fetching it. Treat unresolved robots redirects as unresolved policy rather than automatic permission.

  **12. Med — CSV “streaming” can exhaust resources on cache misses.** [app/api/data/votes.csv/route.ts:34](/Users/home/Desktop/dev/active/delegation-decoded/app/api/data/votes.csv/route.ts:34), [app/api/data/trades.csv/route.ts:40](/Users/home/Desktop/dev/active/delegation-decoded/app/api/data/trades.csv/route.ts:40). Export handlers run database-pagination loops inside `start()` without waiting for reader demand, checking cancellation, or applying an application rate limit. Concurrent uncached downloads can repeatedly scan the dataset while slow readers cause queued output to accumulate.

**Fix:** Prefer periodically generated export files served through the CDN. Otherwise use demand-driven `pull()`, cancellation handling, concurrency limits, and export-specific rate limits.

  **13. Med — Audit retention and reproducibility are overstated.** [lib/ask-limits.ts:253](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-limits.ts:253), [scripts/cleanup-ask-data.ts:5](/Users/home/Desktop/dev/active/delegation-decoded/scripts/cleanup-ask-data.ts:5), [lib/ask-log.ts:137](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-log.ts:137). The scheduled cleanup never deletes `ask_log`; its 90-day deletion depends on opportunistic request traffic. Audit writes are fire-and-forget, and records omit retrieved evidence and actual follow-up history, so the promise that every served answer is reproducible is unsupported.

**Fix:** Schedule and monitor audit-log retention explicitly, ensure writes complete through an awaited or platform-supported background operation, and retain the evidence identifiers/snapshots and context needed for reconstruction. Otherwise narrow the documentation to what the log actually preserves.

  **14. Med — Trade methodology invents a publication hold.** [app/trades/methodology/page.tsx:172](/Users/home/Desktop/dev/active/delegation-decoded/app/trades/methodology/page.tsx:172), [scripts/ingest/disclosures-house.ts:258](/Users/home/Desktop/dev/active/delegation-decoded/scripts/ingest/disclosures-house.ts:258), [lib/disclosure-queries.ts:51](/Users/home/Desktop/dev/active/delegation-decoded/lib/disclosure-queries.ts:51). The methodology says uncertain or invalid rows remain hidden until human clearance, but ingestion inserts them and public queries return them. Its claimed regression set of hand-verified filings was also not found in the repository tests.

**Fix:** Describe the actual published-with-flags behavior and the House ingest pause. Remove the regression-set claim unless a maintained, runnable corpus can substantiate it.

  **15. Low — Input pages fall outside the documented nonce policy.** [proxy.ts:7](/Users/home/Desktop/dev/active/delegation-decoded/proxy.ts:7), [proxy.ts:50](/Users/home/Desktop/dev/active/delegation-decoded/proxy.ts:50), [app/layout.tsx:42](/Users/home/Desktop/dev/active/delegation-decoded/app/layout.tsx:42). `/`, `/state/*`, `/member/*`, and `/race/*` embed Ask but receive the static `unsafe-inline` policy; `/races` also accepts search parameters outside the nonce list. The existing nonce-listed pages do declare dynamic rendering; this is a policy-coverage gap, not demonstrated XSS.

**Fix:** Either extend nonce protection with matching dynamic rendering or explicitly revise the route policy around a reviewed static-CSP approach. Add a check that input-route classification and rendering configuration agree.

  **16. Low — District validation still accepts nonexistent scopes.** [app/api/ask/route.ts:90](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:90). The range check accepts district `0` in numbered-district states and district `1` in at-large states. The former `-1` cache collision is fixed, but invalid district context can still reach the model and receive its own cached answer.

**Fix:** Validate against actual district identities, including the at-large convention, rather than `0..numDistricts`.

**July review: each claim checked**

| Original finding | Current verdict |
|---|---|
| 1. Invalid/IP-blocked requests exhaust global budget | Original path fixed; exhausted-provider variant remains in finding 7. |
| 2. Cross-site budget consumption | Browser JSON/origin guards implemented; deployed WAF unverified. |
| 3. Address GET and unlimited geocoder | Fixed: POST, no-store, independent quota, six-second upstream timeout. |
| 4. Runtime validation/cache collision | Collision fixed; district validation remains incomplete. |
| 5. Grounding enforcement | **Still open.** Failed retrieval and uncited answers are accepted. |
| 6. External-navigation link bypass | Fixed in the answer renderer’s exact allowlist. |
| 7. Resource controls | Improved substantially; request deadline and pre-limit work remain incomplete. |
| 8. Incomplete answers cached | **Still open for Anthropic truncation.** |
| 9. Plaintext cache keys and retention | HMAC keys and scheduled cache cleanup implemented; audit-log guarantees introduce finding 13. |
| 10. Misleading tool contracts | Original lifetime/share descriptions corrected; cycle filtering and explicit cycle labels implemented. |

**What is genuinely strong**

  • **Retrieval scope is enforced in code.** Member IDs are checked against the allowed roster, cross-state tools reject mismatches, and member race lookup selects the exact seat server-side. [lib/ask-tools.ts:357](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-tools.ts:357)

  • **The crawler has meaningful SSRF defenses.** HTTPS restrictions, host allowlists, private-address rejection, DNS-to-connection pinning, and redirect revalidation are real. [scripts/lib/safe-fetch.ts:64](/Users/home/Desktop/dev/active/delegation-decoded/scripts/lib/safe-fetch.ts:64)

  • **Extraction preserves source evidence.** Private snapshots precede extraction, and validators reject quotes absent from captured text; this proves text presence, with the interpretation limits above. [scripts/ingest/candidate-sites.ts:495](/Users/home/Desktop/dev/active/delegation-decoded/scripts/ingest/candidate-sites.ts:495)

  • **Several abuse boundaries are concrete.** Tool-call and iteration ceilings exist, SDK retries are disabled, history-dependent answers bypass shared caching, and stock tools are absent. [lib/ask-engine.ts:35](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-engine.ts:35), [app/api/ask/route.ts:255](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:255)

  • **Readers receive a real correction path.** Answers disclose AI generation and lack of prepublication human review, link sources, and offer “Report a wrong answer.” Parameterized queries, CSV formula neutralization, and photo roster checks also provide substantive protections. [components/ask-client.tsx:1237](/Users/home/Desktop/dev/active/delegation-decoded/components/ask-client.tsx:1237), [lib/csv.ts:5](/Users/home/Desktop/dev/active/delegation-decoded/lib/csv.ts:5), [photo route:93](/Users/home/Desktop/dev/active/delegation-decoded/app/api/photo/[bioguideId]/route.ts:93)

