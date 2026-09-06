# Grok mock-panel review of the interview walkthrough (September 5, 2026)

`grok -p` read-only run role-playing the Houston R4 panel against the walkthrough draft and main at 869620f, captured verbatim. Every contradiction it found was either fixed the same night (the tool description, the candidate page, the Michigan paragraph, workflow step names, the merged citation gate) or folded into the walkthrough's honest-limits wording (grounding scope, roster links, audit-row timing, ISR window).

**The walkthrough oversells the gates.** Citation inventing is stripped, not rejected. Grounding is “one tool fired,” not “this sentence matches a record.” Copy still contradicts the code in places they told the panel they already cleaned up.

---

## 1. CLAIMS THAT DO NOT HOLD

**“An invented one rejects the whole answer.”** (Stop 3)

The registry never rejects. Unknown markers are deleted and the answer is served. A no-marker answer is also served.

```250:252:lib/ask-citations.ts
// Validates and renumbers markers. Unknown markers are stripped (same
// fail-soft posture as sanitizeAnswerLinks); an answer with zero surviving
// markers degrades to the tool-level footer, never to a failed request.
```

```45:53:tests/ask-citations.test.ts
test("markers the registry never issued are stripped", () => {
  // ...
  assert.equal(answer, "She voted yea. [1] The sky is green. Also this.");
```

The later hedge (“on the branch being merged this week”) does not save Stop 3 or the hard-question line **“A bad citation is impossible.”** A real ref glued to the wrong sentence still ships. Zero citations on `answered` still ships. `citationCoverage` is logged, not gated (`lib/ask-citations.ts:284-287`).

**“The model never gets to state a fact it did not look up.”** / **“An ungrounded answer is impossible.”**

The 502 only checks that *some* tool was pushed onto the trace, including a failed lookup. Trace is written *before* execute. One error object unlocks `status: "answered"`.

```198:200:lib/ask-engine.ts
  if (status === "answered" && traceLength === 0) {
    throw new AskError("The assistant did not verify that answer against a record.", 502);
  }
```

```413:426:lib/ask-engine.ts
        trace.push({ tool: call.name, input });
        // ...
        try {
          result = annotateToolResult(/* ... */);
        } catch {
          result = safeToolError();
        }
```

State/member pages also inject the roster into the prompt as `rosterEvidence` before any retrieval (`lib/ask-engine.ts:301-325, 352, 467`). That is not a lookup.

**“An internal link survives only if that ID appears in this run's retrieved evidence.”**

`sanitizeAnswerLinks` searches the whole evidence haystack, which starts as the injected roster, not tool results (`lib/ask-engine.ts:73-92, 352, 467`). In-scope bioguide IDs are linkable with no retrieval.

**“Every request exits through a log line.”** / **“every request writes an audit row”**

Cross-site, oversized body, short/long question, and invalid scope return *before* `logBase` exists (`app/api/ask/route.ts:159-185`). The code comment is the true contract: only a validated question+scope is logged (`app/api/ask/route.ts:190-191`).

**“Tonight the copy on /about… says what the code does.”** Three live contradictions on that page:

- Press-release collection is retired in `GOALS.md` and `lib/health.ts:157-158`. `/about` still lists RSS as a current source and “Ingest press releases” as a current step (`app/about/page.tsx:306-324, 479-483`).
- Michigan ingest promotes `verified_ballot` when the general report is Official (`scripts/ingest/elections.ts:2244-2249`). `/about` still says Michigan “remains verification pending” and that November filings “do not receive general-election ballot lines” (`app/about/page.tsx:421-426`).
- House PTR is paused in the daily workflow (`.github/workflows/ingest-daily.yml:127-140`). `/about` describes vision parsing in the present tense, no pause (`app/about/page.tsx:261-282`).

**The model is still told biography facts are human-reviewed.**

```169:172:lib/ask-tools.ts
    name: "get_member_biography",
    description:
      "Get human-reviewed biography facts extracted from a scoped lawmaker's official House or Senate website. ...
```

That is the string the model sees. Review was retired (`lib/biography-queries.ts:49-51`). Weekly CI still names the jobs “queue extracted claims for review” and “queue facts for review” (`.github/workflows/ingest-weekly.yml:74, 94`).

**“They now display only when their words are in the quote.”**

Race pages and `/ask` gate on `officeInQuote`. Candidate pages print `officeTitle` and `jurisdiction` unconditionally (`app/candidate/[contestPersonId]/page.tsx:124-127`).

**“Content pages are ISR-cached for an hour.”**

Root layout caches a day: `export const revalidate = 86400` (`app/layout.tsx:39-42`). Only the homepage is 3600.

**“Audit-log retention now runs on the nightly schedule, not on request traffic.”**

Nightly exists (`.github/workflows/ingest-daily.yml:156-158`). The request path still deletes 90-day rows (`lib/ask-limits.ts:253-262`, called from `app/api/ask/route.ts:241`).

**If eval is presented as a gate: it is not.** `eval-ask.ts` prints `FAIL` and still exits 0. `process.exitCode = 1` is only for the signature self-check or a thrown error (`scripts/eval-ask.ts:448, 561-581`). They admit this later. Stop 7 still uses “22 of 22” as proof.

---

## 2. THE SIX QUESTIONS THIS PANEL WOULD ACTUALLY ASK

**1. Where is the discrepancy check on the reader-facing answer?**

Wanted: “There isn’t one. Quote-in-snapshot is extraction only. /ask checks that a ref was issued, not that the sentence matches the record.”

**2. What is the production miss rate, and who read the 35 answers?**

Wanted: “Thirty-five lifetime questions, no sampled score, no second reader. The 22 evals are paid, manual, and on this branch a FAIL still exits 0.”

**3. A wrong answer is cached 24 hours with no purge and no kill switch. What is the incident playbook?**

Wanted: “Redeploy or wait. There is no cache delete, no runtime flag, no dollar cap. That is the gap.”

**4. You published thousands of quotes still labelled `needs_review`. Why is ‘the words appear on the page’ enough to ship?**

Wanted: “It proves the page said those words. It does not prove the quote is fair, in context, or current. A person still owns fitness to publish; that person has not run.”

**5. Hearst reviews AI output except where disclosed. Who owns corrections in a 130-person newsroom?**

Wanted: “A mailto to the builder. No desk, no role, no SLA, no queue. The audit row is how I debug. It is not how a newsroom corrects.”

**6. Why is this the simplest thing that works?**

Wanted: “The simple piece is the citation registry: issue refs in code, resolve in code, no second model. The rest is fences around a tool loop that can still misread a real row.”

---

## 3. WHAT IS GENUINELY IMPRESSIVE

**1. Server-issued citation registry, resolved in code.** Refs are stamped onto retrieved rows before the model sees them and remapped after (`lib/ask-citations.ts:1-6, 71-70, 253-281`). No second model grading the first. That is the Meeting Monitor instinct applied to *provenance*, and it is the part that belongs in a newsroom.

**2. Verbatim-only publication with a snapshot check.** The model’s paraphrase is stored and never shown. A quote that is not in the captured page is dropped and now counted (`lib/elections/campaign-research.ts:41-49, 189-192`; `lib/biography-queries.ts:24-26, 49-51`). That is a real, testable witness.

**3. Fail closed, then say so in public.** State adapters throw on a changed page. House PTR was paused with a dated note in the workflow and on `/health` instead of being left to fail silently (`.github/workflows/ingest-daily.yml:127-140`; `lib/health.ts:151-159`). That is editorial judgment in ops, not a prompt rule.
