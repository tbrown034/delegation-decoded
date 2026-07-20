# What this project demonstrates for a newsroom

Working notes for job applications and outreach. Every claim below shipped and is verifiable in the repo or on the site.

## The one-paragraph version

I built a congressional accountability site that lets any reader ask plain-language questions about their delegation — votes, bills, committees, campaign money, and who is running against whom in 2026 — answered only from official government records, with every answer citing what it checked. It runs on seven official data sources, syncs nightly, audits itself, and cost under a dollar a day to operate.

## Why it's a newsroom story, not a demo

The AI never answers from memory. It reads from a Postgres database filled by documented pipelines — Congress.gov, House and Senate roll-call XML, the FEC, the @unitedstates project — and each answer footer links to the pages holding the records it read. When the data can't answer, it says so instead of guessing.

The edge cases are the product. Ask who is running against Lindsey Graham and it leads with the fact that he filed for re-election and then died — because the site cross-checks FEC "incumbent" filers against the current member roster. FEC filings are framed as filings, never as the ballot, because state deadlines and primaries decide ballots.

The data audits itself. A seat-chart feature exposed that the database carried 101 sitting senators; the fix was a pipeline change that now retires deceased and resigned members automatically, daily. The methodology page computes its own numbers from the live database so it can never contradict the homepage.

## Guardrails that made it shippable without a login wall

Per-IP and global daily budgets cap model spend at a known dollar figure. Cross-site requests, invented districts, and prompt-injection attempts are rejected before they cost anything. Voting-logistics questions redirect to vote.gov rather than generate — the one category where a wrong answer disenfranchises someone.

Refusals are product copy, not error states. Rate limits render as neutral notices with concrete retry times, and when the daily budget runs out the assistant says so and hands readers direct links to the same records.

## What this would look like for a local newsroom

The same pattern — official records in, grounded tool-loop out, citations always — works for any structured civic data a newsroom sits on: county budgets, police logs, campaign filings, court calendars. The expensive part is not the AI; it is the pipelines, the filters (which FEC filers are real candidates), and the honesty rules. That is journalism work, and it is what I do.

Cost reality: the ask feature runs on a small, fast model chosen by an eval harness, roughly half a cent per answered question, capped at a few dollars a day. A newsroom pilot does not need a platform budget.
