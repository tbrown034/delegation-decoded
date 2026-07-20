# Codex security review of /ask (July 19, 2026)

Non-interactive `codex exec` review of the ask feature, captured verbatim.
Round 1 of the portfolio-polish loop shipped before these arrived; treat the
prioritized top five as the Round 2 worklist.


### Findings

1. **High — The global rate limit is a kill switch attackers can trigger.**  
   Both counters increment before either limit is checked in [lib/ask-limits.ts:42-75](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-limits.ts:42). Because any two-letter state passes validation in [app/api/ask/route.ts:45](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:45), one IP can repeatedly submit `ZZ`: the first 15 requests fail before Anthropic, but every subsequent IP-blocked request still advances the global counter. Request 401 disables the assistant for everyone until midnight, with zero model spend.

   Increment the per-IP attempt counter first. Increment a separate global model-budget counter only after the IP check and location validation succeed.

2. **High — Cross-site drive-by requests can consume the budget.**  
   [app/api/ask/route.ts:24-29](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:24) accepts JSON regardless of `Content-Type` and performs no `Origin` or `Sec-Fetch-Site` check. A hostile page can issue `no-cors` `text/plain` POSTs containing JSON; it cannot read the response, but the request still reaches the counter and model.

   Require `application/json`, enforce same-origin browser requests, and put a Vercel edge/WAF limiter ahead of the function. The current cache lookup also occurs before rate limiting in [app/api/ask/route.ts:52-62](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:52), so every flood request reaches Neon even after the caller is blocked.

3. **High — Street addresses are placed in a GET URL and the geocoder is unlimited.**  
   [components/ask-client.tsx:137](/Users/home/Desktop/dev/active/delegation-decoded/components/ask-client.tsx:137) sends the complete address as `?q=...`. That exposes it to hosting, proxy and observability logs. [app/api/ask/locate/route.ts:5-25](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/locate/route.ts:5) has no rate limit, timeout, or explicit `no-store`, making it an unrestricted Census-geocoder and database amplification endpoint. Next.js specifically recommends POST for geolocation because GET URLs may be logged or cached. [Next.js guidance](https://nextjs.org/docs/app/guides/backend-for-frontend)

   Use POST with a JSON body, explicit `Cache-Control: no-store`, a short upstream timeout, and independent edge/app rate limits.

4. **High correctness — Runtime validation is absent, and `district = -1` poisons the state-only cache.**  
   The TypeScript interface is not runtime validation. `null` bodies and numeric `question`/`stateCode` values throw 500s at [app/api/ask/route.ts:25-37](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:25); any finite fractional, negative, or impossible district is accepted.

   Worse, `null` and attacker-supplied `-1` map to the same cache key at [lib/ask-limits.ts:94-100](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-limits.ts:94) and [lib/ask-limits.ts:112-116](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-limits.ts:112). An attacker can generate an answer under “district -1,” then have it served to legitimate state-only users asking the same question. Validate with a runtime schema, require an integer district that exists in the selected state, and add database constraints at [scripts/schema.sql:285-293](/Users/home/Desktop/dev/active/delegation-decoded/scripts/schema.sql:285).

5. **High correctness — “Grounded only in official records” is not enforced.**  
   The trusted roster and attacker-controlled question are concatenated into one user message at [lib/ask-engine.ts:73-84](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-engine.ts:73). Any response that does not request a tool is accepted verbatim at [lib/ask-engine.ts:110-116](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-engine.ts:110), then cached and served.

   Prompt instructions cannot prevent hallucination or prompt injection. The UI nevertheless labels every trace-free answer “Answered from the delegation roster” at [components/ask-client.tsx:334-339](/Users/home/Desktop/dev/active/delegation-decoded/components/ask-client.tsx:334). Require structured output, verify cited member/bill IDs and factual claims against collected results, and refuse to cache unverifiable answers.

6. **Medium — The internal-link allowlist permits external navigation.**  
   [components/ask-client.tsx:78-84](/Users/home/Desktop/dev/active/delegation-decoded/components/ask-client.tsx:78) trusts every href beginning with `/`. Both `//evil.example` and `/\evil.example` resolve as external URLs in browsers. A prompted or compromised model response can therefore emit a phishing link.

   Allow only explicit routes such as `/member/<validated-id>` and `/bill/<validated-id>`. Normal React escaping prevents direct HTML XSS here, but it does not fix URL validation.

7. **Medium — Model and tool resource controls are too weak.**  
   `MAX_ITERATIONS` limits turns, not tool calls: every `tool_use` block is executed at [lib/ask-engine.ts:121-141](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-engine.ts:121), with no total-call, result-byte, token-cost, or wall-clock budget. `maxDuration = 60` in [app/api/ask/route.ts:10](/Users/home/Desktop/dev/active/delegation-decoded/app/api/ask/route.ts:10) lets Vercel terminate the function; it does not explicitly abort the Anthropic request. [Vercel duration behavior](https://vercel.com/docs/functions/configuring-functions/duration)

   Add a request-wide `AbortSignal`, short SDK timeout/retry policy, maximum tool calls, per-tool call limits, and maximum accumulated result size. The tool schemas should also use strict mode and server-side validation rather than casting `use.input`; Anthropic recommends `strict: true` for invented or mistyped parameters. [Anthropic tool guidance](https://platform.claude.com/docs/en/agents-and-tools/tool-use/troubleshooting-tool-use)

8. **Medium — Stop reasons are mishandled and incomplete answers are cached.**  
   [lib/ask-engine.ts:110-116](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-engine.ts:110) treats every stop reason except `tool_use` as a completed answer. That includes `max_tokens` truncation and `refusal`, potentially producing partial or empty 200 responses that remain cached for a day. Anthropic requires callers to branch on these reasons. [Anthropic stop-reason documentation](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)

9. **Medium privacy — Prompts and linkable IP identifiers outlive their stated purpose.**  
   `ask_cache.question_norm` stores the user’s normalized question in plaintext at [scripts/schema.sql:285-292](/Users/home/Desktop/dev/active/delegation-decoded/scripts/schema.sql:285). The cache expires functionally after 24 hours, but deletion waits until seven days and happens only during a fire-and-forget 2% cleanup at [lib/ask-limits.ts:31-40](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-limits.ts:31); low traffic can leave rows indefinitely.

   The deterministic, public-prefix IP hash at [lib/ask-limits.ts:14-21](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-limits.ts:14) is linkable across windows and dictionary-attackable for IPv4. Use an HMAC with a rotating secret/window, hash cache keys instead of storing raw prompts, and run scheduled retention cleanup.

10. **Medium correctness — Several tool contracts misdescribe the data.**  
    [lib/ask-tools.ts:34-36](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-tools.ts:34) calls vote totals “lifetime,” but ingestion covers the 119th Congress. [lib/ask-tools.ts:50-52](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-tools.ts:50) promises a “small-dollar share,” while [lib/ask-tools.ts:161-167](/Users/home/Desktop/dev/active/delegation-decoded/lib/ask-tools.ts:161) returns the raw small-dollar amount. Top contributors are also mixed across cycles rather than selected per cycle.

    These descriptions invite confident, factually wrong prose. Rename the fields, include coverage metadata, and make cycle an explicit required parameter where appropriate.

I did **not** find direct SQL injection: attacker-controlled values use Drizzle parameter interpolation, and the only `sql.raw` value is a constant. I also would not call `x-forwarded-for` spoofable on a direct Vercel deployment because Vercel overwrites it; that assumption becomes unsafe if another proxy sits in front. [Vercel request-header documentation](https://vercel.com/docs/headers/request-headers)

## Prioritized top five

1. Redesign the rate-limit transaction so rejected and invalid requests cannot exhaust the global budget.
2. Move abuse controls to the edge, reject cross-site/non-JSON POSTs, and rate-limit the location endpoint.
3. Replace address GET requests with no-store POST requests.
4. Add runtime state/district/body validation and eliminate the `null`/`-1` cache collision.
5. Treat model output as untrusted: strict tool inputs, hard execution budgets, correct stop-reason handling, validated citations, and an exact internal-link allowlist.
