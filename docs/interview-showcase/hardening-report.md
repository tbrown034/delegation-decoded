# Hardening report — September 5, 2026

**Local safeguard implementation; not deployed.** Built in the isolated worktree `delegation-decoded-interview` on branch `interview-safeguards-isolated`, from base `576cc8e`. The original checkout remains on main with another session’s Michigan election changes preserved.

## What changed and why

| Problem reproduced or confirmed | Repair | Evidence |
|---|---|---|
| An attempted failed lookup counted toward an “answered” gate | Final factual answers require a retrieved-record citation; unknown refs reject the whole answer | Failed/empty lookup and mixed real/fake citation regression tests |
| Model-generated citation lists/ranges could remain unvalidated | Expand grouped references and validate each constituent; reject malformed reference groups | List/range and invented-group tests |
| Text truncation could register citations for records the model never received completely | Bound complete JSON records, retain partial-result labels, commit only the surviving registry | Oversized result test preserves old evidence and excludes dropped rows |
| A record field could overwrite its server-issued ref | Server ref assigned after untrusted fields | Reference override regression |
| Official-looking links could be invented | Require exact URL presence in retrieved evidence; retain fixed vote.gov referral | Invented URL and prefix-collision tests |
| Fallback router missed FEC-filer language and unknown member/state topics | Add explicit vocabulary and retain substantive scoped tools for unmatched questions; keep recognizable roster questions narrow | Routing tests and paid evals |
| Finance prose could omit its known source | Add FEC attribution deterministically when a finance citation is present and the agency name is missing | Regression test and six targeted paid cases |
| Spending questions lacked a spending field | Add stored disbursements alongside receipts, distinguish both and preserve null | New finance-spending eval against database values |
| Stale caches could survive an ingest or human rejection | Successful ingest and explicit review timestamps invalidate older answers; prompt version also changes cache identity | Read-only live cache query; independent code review |
| Site claimed mandatory human review that code had retired | Correct About, Health, tool descriptions, Ask footer and trade methodology; distinguish eligible stored quotes from approval counts | Rendered visible-text checks and database-backed health rendering |
| About described paused/retired sources as active | Date the House PTR pause and press-release retirement; point statements coverage to Capitol Releases | Rendered About checks |
| Eval failures still exited successfully | Failure/empty-selection exit status is nonzero; optional complete-answer output supports inspection | Actual CLI exit checks with no model calls |
| Some terminal answers included model wrapper tags | Remove answer wrapper tags before reader display | Terminal normalization test |

## Verification results

| Check | Observed result | Boundary |
|---|---|---|
| Deterministic tests | **99/99 passed** | Scope, citations, payload limits, source extraction and existing app logic; no model calls |
| ESLint, TypeScript, production build | **Passed** | Final local code; not a production deployment |
| 23-case depth run, each provider | **OpenAI 23/23; Anthropic 22/23** | The one failure was missing FEC prose attribution, before the final deterministic attribution fix |
| Finance after attribution fix | **3/3 per provider, 6/6 total** | Includes receipts, historical cycle and spending; original failed run retained |
| Roster after narrowing schemas | **1/1 per provider** | Anthropic 8.7 seconds in the rerun versus 40.0 seconds with the broad schema set; individual measurements, not a benchmark |
| Stock-boundary after status instruction | **1/1 per provider** | Does not guarantee all future refusals use the intended status |
| Bounded roster sweep | **4/4 passed** | IN, TX, DC and PR; not all 56 delegations |
| Local HTTP Ask request | **200, answered, two valid roster citations** | Exercised the built route and ordinary accounting; not production hosting |
| Local rendered routes | **Five 200 responses** | About, Health, Ask, Indiana and trade methodology; visible disclosure text checked, no visual or accessibility certification |
| Eval failure exit behavior | **Exit 1 for empty selection and unavailable providers** | Executed CLI checks, not inferred from code |
| Cache invalidation query | **Executed successfully; cache miss** | Read-only against existing schema; no artificial cache/data mutations |

The 46-case depth run was not rerun in full after the final attribution/display changes. The affected finance and roster paths were rerun, and the final deterministic tests/build passed. Do not summarize this as a single clean 46/46 final-build run.

All model evaluation results are point-in-time. Saved responses are evaluation artifacts, not independently verified reporting. The engine eval bypasses route moderation/rate/cache logic; the separate HTTP smoke request covers one real route invocation. The evidence directory contains exact outcomes and the earlier failures.

## What the independent reviews establish

Claude CLI performed three read-only reviews. The first confirmed the human-review and attempted-lookup gaps and found invented-link and routing defects. The second found grouped citations, state-scope fallback routing and missing spending data. After those repairs, the final focused review found no remaining high or medium regressions in its five-file scope.

These are code reviews, not certifications. The reviewer did not execute tests or independently audit the underlying public records. Its broad statement in the initial review that there is “no human in the loop” is too broad: source selection, feature boundaries, review/rejection, corrections and reporting decisions are human touchpoints. There is no mandatory individual pre-display review of answers or extracted biography quotes.

## Evaluation findings preserved, not hidden

Earlier depth runs exposed a missing FEC-filer routing phrase and a stock-boundary response mislabeled as answered. The final gate blocked the latter. The prompt now explicitly requires an out-of-scope stock response, and the targeted rerun passed on both providers.

The old South Carolina case did not specify a Senate class and incorrectly required “no longer” even when the application properly withheld an ambiguous special-election FEC fallback. A read-only query confirmed records for the regular Class 2 contest. The test now names that contest and requires matching tool arguments, preserving the original departed-filer check rather than removing it.

A later finance response repeatedly omitted the agency name from its prose despite returning record citations. Code now adds the known FEC attribution whenever a finance citation is present and the acronym is missing, so the source survives copying an answer without the UI footer. All six targeted finance cases passed after that change. The earlier failures remain in the evidence; a rerun does not erase them. Keyword, database-fidelity and tool-use grading do not amount to semantic fact-checking.

## Current operational limits

- The health snapshot has warning-level conditions: campaign/biography crawl errors, missing campaign websites, paused sources, unrecovered sync failures and PTR review flags. Another session owns the Michigan parser work. No claim is made here that those operational failures were repaired.
- House PDF disclosure ingestion remains paused. Historical trade records and low-confidence rows may remain visible; a review flag is not a publication hold.
- Quote selection/classification and answer interpretation can still be wrong. Matching words to a snapshot verifies what was said, not truth or context. A valid citation does not entail the claim attached to it.
- Source text may contain prompt injection. Tools are bounded and source text is labeled untrusted, but source-level adversarial model evaluation was not completed here.
- Some citation targets are member-page sections, which may not show a retrieved historical record. Durable links to individual records are still needed.
- Unrecognized fallback questions can expose more schemas and take longer. Same-turn retrieval plus submit_answer can fail closed; truncated/no-tool provider outputs have asymmetric fallback handling. These remain availability limits.
- Cached answers may still outlive in-progress writes, failed partial ingests or unlogged manual corrections. The read-only cache smoke check verifies the live query’s schema and execution, not a controlled end-to-end timestamp invalidation experiment.
- Audit logging is best-effort and lacks full retrieved-payload snapshots. A saved answer is inspectable; exact replay is not guaranteed. Question text may itself contain identifying information.
- The four-delegation sweep is bounded. It is not a fresh 56-delegation sweep or a load test. No systematic human source audit or user rehearsal has been completed.

## Release boundary and next step

No source records were edited, no ingest or review action was applied, and nothing was merged, pushed or deployed. Model evals used paid provider calls and read the database. One local HTTP Ask smoke request exercised the real route and therefore used its ordinary audit and rate/budget accounting; national scope avoided an answer-cache write.

Review the commits before release. Keep the site’s current warning disclosures. The next user-facing step is to rehearse the walkthrough one stage at a time and perform a source check on the specific record chosen for the live demo.
