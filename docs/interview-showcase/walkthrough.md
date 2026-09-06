# Walk through the project, one stage at a time

**Core explanation:** the model helps locate and explain records. The application controls access to the records and checks the answer’s citation references. A person still determines reporting significance, independently verifies consequential claims, and decides what to publish as journalism.

This guide describes the code on the interview-safeguards-isolated branch. Check the hardening report before describing a change as live.

## 1. Start with a reporting question

Open a state delegation page. Show a member, a vote or bill, and its source information before opening the question box.

**Say:** “The records are useful without AI. A reporter can inspect them directly. Ask adds a natural-language way to find and summarize them.”

Use a narrow example: “What was this member’s latest recorded vote?” An actual live answer depends on the current database. Do not memorize yesterday’s vote as today’s answer.

**Human decision:** which sources belong in the product, which questions it should support, and which omissions must be disclosed.

**Code to open:** `app/state/[code]/page.tsx`, `app/member/[bioguideId]/page.tsx`, `GOALS.md`.

## 2. Collect and store the records

Scheduled TypeScript scripts read congressional records, House and Senate roll-call XML, FEC records, the community-maintained member roster, and supported state election sources. They write structured rows to Neon Postgres through Drizzle.

An upsert uses the record’s natural identity to update an existing row instead of creating another copy. Each ingest records its outcome in `sync_log`. Coverage checks and the public health page share reporting code.

**Say:** “The model does not calculate the vote totals or invent the member roster. These are database records collected by ordinary code. Collection has its own failure modes, so I track freshness and coverage separately from whether the website loads.”

**Stops and limits:** source formats can change; a successful job does not establish complete coverage or external accuracy. The member roster is community-maintained, so do not call every input an official government API. House PDF disclosure ingestion is paused; press-release collection is retired here.

**Human decision:** approve source adapters, investigate failures, and decide whether coverage is sufficient to expose a feature.

**Code:** `scripts/ingest/`, `scripts/schema.sql`, `lib/schema.ts`, `lib/health.ts`, `.github/workflows/`.

## 3. Explain every place a model is involved

| Path | What the model does | What code does | What publication means |
|---|---|---|---|
| Ask | Select retrieval tools and compose a short answer | Scope-check arguments, run SQL, issue and validate citation refs | Automatically displayed, not individually approved |
| Official biography / campaign research | Select quoted passages and classify them | Bound crawling, capture snapshots, check quote presence | A source said these words; the statement is not independently verified |
| Historical House PTR extraction | Read disclosure images into structured rows | Validate fields and carry confidence/review flags | A parsed record may require checking against the filing; ingestion is paused |
| Senate PTR, votes, bills, finance, roster | No model for ordinary collection | Parse structured sources and store rows | Source-derived data with collection limits |

Campaign and official biography pages publish the source quote, not the model’s paraphrase. That reduces one type of invention. A quote can still be misleading through selection, classification, source error or missing context.

**Human decision:** choose the categories, review suspicious or reported records, and decide whether a claim needs independent reporting. The current system does not require a person to approve each extracted quote before display.

**Code:** `lib/biography-research.ts`, `lib/elections/campaign-research.ts`, `lib/biography-queries.ts`, `lib/elections/queries.ts`, `scripts/lib/parse-ptr.ts`.

## 4. Accept a question and set its scope

A request carries the question and the page’s state/member/national scope. The server resolves that scope and creates the allowed member set. Prior exchanges can clarify pronouns, but are explicitly not evidence.

**Say:** “A tool call is a request from the model for the application to run a named function. The model supplies arguments; it does not write or execute SQL.”

The route checks input shape, length and request origin, applies rate and provider-attempt limits, and screens known injection patterns. Moderation is an additional layer that fails open if unavailable. Scope and answer validation fail closed.

A member outside the allowed set is rejected before its record query. Stock-disclosure tools are absent from Ask. Voting-logistics questions are directed to vote.gov by the prompt; do not present that prompt instruction as a mathematically guaranteed semantic restriction.

**Limits in code:** 20 Ask questions per IP-derived identifier per hour; 500 global provider attempts per day and 350 per provider. These bound activity, not an exact dollar amount.

**Code:** `app/api/ask/route.ts`, `lib/ask-limits.ts`, `lib/ask-moderation.ts`, `lib/ask-tools.ts`.

## 5. Retrieve evidence in a bounded model loop

Defaults are OpenAI as primary and Anthropic as fallback, with model names configurable through environment variables. The application exposes nine retrieval tools plus `submit_answer`, narrowed according to page scope and, for Anthropic, question routing.

The model requests a lookup. Code validates the arguments and runs parameterized SQL. Each returned record gets a short server-issued reference such as `v1`. The model receives those records as data and can request another lookup.

**Say:** “I use exact database queries for these structured records. I do not need embedding similarity to identify a particular member, vote date or finance cycle.”

The loop allows six iterations and twelve retrieval calls, with a 55-second engine deadline after scope preparation and no SDK retries. Fallback is for provider unavailability. It is not a second model verifying the first model’s answer.

Oversized results omit whole records and explicitly disclose partial results. References for omitted records are not committed to the evidence registry.

**Human decision:** choose tools and allowable queries. Review eval failures before changing the prompt, router or provider.

**Code:** `lib/ask-engine.ts`, `lib/ask-tools.ts`, `lib/ask-citations.ts`.

## 6. Check the answer before display

The model must call `submit_answer` with a status and answer text. Ordinary unstructured final prose is not accepted as the answer.

For `answered`, a lookup attempt alone is insufficient. The final answer must contain at least one citation to a record registered in that run. Unknown citation references reject the answer. Code also strips unsupported links, then renumbers valid citations for display. If a cited finance answer omits the agency name, code adds its known FEC attribution so that it survives copy/paste.

**Say:** “A failed lookup used to count toward the answer gate. I changed the final gate to require an actual retrieved-record citation. I also reject invented references instead of quietly dropping them and serving the remaining claim.”

**Critical limit:** a real citation can still accompany an incorrect interpretation, or an unrelated claim. This is a reference-membership check, not sentence-by-sentence fact-checking. Citation coverage is a monitoring heuristic, not an accuracy score. The non-answer statuses are model-declared and are not semantic proofs either.

State/member answers can be cached for up to 24 hours; follow-ups and national queries bypass that answer cache. Prompt-version changes, newer successful ingests and explicit biography/campaign review decisions invalidate older cached entries. In-progress writes, failed partial ingests, and unlogged manual edits remain freshness limits.

**Code:** `finalizeAskAnswer` in `lib/ask-engine.ts`, `prepareToolPayload` and `resolveCitations` in `lib/ask-citations.ts`, `getCachedAnswer` in `lib/ask-limits.ts`.

## 7. Show the result, disclose it and support corrections

The interface shows citations, the record categories requested, provider information, AI disclosure, a warning that answers may contain mistakes, and a correction link. A tool trace records attempts; it does not establish successful retrieval or correctness.

**Say:** “Readers are told that an answer is not reviewed by a person before display. A journalist should inspect the original record before citing a consequential claim. I retain an audit log to investigate problems, and review tools can reject extracted records.”

The log records question/answer text, scope, tool arguments, provider, tokens, latency and outcome, using an HMAC-derived connection identifier rather than the raw IP address. The intended retention is 90 days. This is pseudonymous logging, not anonymous text: a reader can type personal information into a question. Logging is best-effort and does not preserve every retrieved payload or guarantee exact replay.

Some citation links land on member-page sections. A historical retrieved record may not be visible in the default section. Direct, durable record links and captured answer evidence are future improvements; do not promise one-click historical verification today.

**Human decision:** investigate corrections, check the source and context, reject records where appropriate, pause unreliable features, and decide what becomes a reported story.

**Code:** `components/ask-client.tsx`, `app/about/page.tsx`, `lib/ask-log.ts`, `scripts/review-member-biographies.ts`, `scripts/review-candidate-research.ts`.

## How to explain evaluation

**Deterministic tests:** verify specific contracts such as scope rejection, citation membership, error-only lookup rejection, oversized evidence handling, and quote checks. Passing tests does not prove current model behavior.

**Paid depth eval:** sends curated real prompts through the model engine, including record questions, scope boundaries, injection/history attacks and forced fallback. Expected facts often come from the same database as the product. That tests fidelity to this database, not whether the database matches the world. A missing case selection or failed case now exits nonzero.

**Breadth sweep:** asks roster questions across delegations. It exercises geographic and roster edge cases, not all journalistic questions. See the dated report for what actually ran.

**Human source audit:** choose consequential examples, compare answers and stored rows against the original record, and assess context and usefulness. This remains separate work; do not claim a systematic source audit was completed by running database-based evals.

## A repeatable process for new features

1. Define the reporting task and the consequence of a wrong answer.

2. Try a deterministic implementation first. Use a model only for a task where language interpretation or irregular documents justify it.

3. Define the source boundary, publication conditions, fallback/refusal behavior and cost limits before implementation.

4. Build examples of correct answers, missing evidence, ambiguous questions, poisoned source text and source-format changes. Decide acceptable behavior before looking at the outputs.

5. Test code, run both-provider evals, inspect source-backed samples, and have a person judge whether the result is useful and responsibly framed.

6. Release narrowly, disclose limits, monitor and retain a way to disable the feature. Production release remains a separate decision.

**Worked example:** a finance filter should be SQL. A model may interpret a reader’s phrase into a filter, but code should validate the cycle and member and show the filter. An allegation that a donation influenced a vote requires reporting, context, response and editorial judgment; the model should not turn a correlation into that conclusion.

## Rehearsal questions

- Where does the model run, and where does ordinary code run?
- What happens if the lookup fails but the model still writes an answer?
- What does a citation prove, and what does it not prove?
- Does anyone approve each answer or biography quote before display?
- What is the difference between a campaign claim and an independently established fact?
- How did a real eval failure change the implementation?
- Why use SQL instead of embedding retrieval here?
- What would you pause, and what would require a reporter or editor?

Do one stage at a time. Explain it without the file open, then open the named function to check your explanation.
