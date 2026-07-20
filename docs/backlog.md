# Backlog — as of July 19, 2026

Everything left over from the /ask build and the Round 1 polish loop.
Branch: `ask-portfolio-polish`. Round 1 shipped: grounded /ask (Haiku 4.5,
eval-picked), Postgres rate limiting + 24h answer cache (both verified live),
security headers, events dedupe, trades/releases made quiet, nav trimmed to
States / Ask / Compare / About.

## Round 2 — security hardening (worklist: docs/ask-security-review.md)

Codex review of /ask, prioritized:

1. Rate-limit ordering: rejected/invalid requests can currently drain the
   global daily budget with zero model spend. Count the global budget only
   after the IP check and validation pass.
2. Reject cross-site / non-JSON POSTs (Origin + Content-Type checks); move
   the cache lookup behind the rate limiter; rate-limit /api/ask/locate.
3. Address lookup should be a no-store POST, not GET — addresses in query
   strings land in logs, which contradicts the site's own privacy promise.
4. Runtime body validation (zod or hand-rolled); fix the district null/-1
   cache-key collision.
5. Treat model output as untrusted: strict tool schemas, handle max_tokens /
   refusal stop reasons (don't cache truncated answers), exact-route link
   allowlist (`//evil.example` currently passes as "internal").

Also from that review: rename misleading tool fields ("lifetime" vote totals
are 119th-Congress-only; "small-dollar share" is an amount), HMAC the IP
hash with a rotating secret, add abort/timeout budgets to the tool loop.

## Rounds 3-10 — user-story passes (not started)

Act out each story in the browser, review, fix, commit per round:
voter ("who represents me / is my seat up"), journalist on deadline
(CSV downloads, citing a vote), skeptic (verify an AI answer against the
member page), mobile user (two bars + chips on a phone viewport),
cross-state researcher, repeat visitor (cache behavior).

## Data issues found while testing

- FEC finance is stale for some members: Todd Young's newest cycle is 2014.
  Neither Indiana senator has top-contributor rows. Audit the finance ingest.
- Homepage freshness panel reads oddly ("Finance: 1 records / 35d ago") —
  it shows per-run insert counts, not totals; and the latest-success logic
  disagrees with /health.
- Headline says "538 members," counter says "540 members tracked," DB has
  439 House + 101 Senate. Pick one honest number and verify it (535 voting
  + delegates?). Don't print an unverified count.
- Committee roster renders Rudy Yakym III as "III" (last-name extraction).
- House Clerk PTR key is rejected upstream (CRIT on /health since ~July 5).
  Rotate the key or pause the sync cleanly so /health goes green.

## Strategy items (from the repositioning conversation)

- FEC 2026 candidates ingest — the "who is on the ballot / do they face
  someone" unlock. New candidates table + get_candidates tool + "On the
  ballot in 2026" section. Filter paper candidates by money raised; label
  as "FEC-registered candidates," which is not ballot access.
- Primary results: no free official API exists. Recommended: small curated
  table (Senate + marquee House races), source-linked and dated. Avoid
  50-state scraping.
- Rename + domain before the next resume push. Shortlist discussed: "Sent
  to Washington," "Home State." Redirect delegation-decoded.vercel.app to
  the new domain so old resumes keep working.
- Update the resume line: lead with the grounded AI lookup, drop "STOCK Act
  trades" from the description.
- Verify the resume's Capitol Releases claim ("all 535 members") against
  what it actually covers (repo docs say 100 senators as of May 2026).

## Pre-deploy checklist (before merging to main)

- Round 2 security items 1-4 at minimum.
- Set a monthly spend cap on the Anthropic workspace key.
- next build clean; /about numbers reconcile with homepage (project rule).
- Truncate ask_cache after any system-prompt change (stale cached wording).
- Consider truncating ask_rate_limits/ask_cache and re-running
  scripts/eval-ask.ts as a smoke test in the deploy checklist.
