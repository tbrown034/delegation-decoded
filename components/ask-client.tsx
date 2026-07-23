"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

interface LocatedMember {
  bioguideId: string;
  fullName: string;
  party: string;
  chamber: string;
  district: number | null;
  photoUrl: string | null;
}

interface Located {
  stateCode: string;
  stateName: string;
  district: number | null;
  matchedAddress: string | null;
  members: LocatedMember[];
}

interface TraceEntry {
  tool: string;
  input: Record<string, unknown>;
}

interface Citation {
  n: number;
  ref: string;
  tool: string;
  label: string;
  href: string | null;
}

type ProgressEvent =
  | { type: "provider"; provider: string; fallback: boolean }
  | { type: "tool"; tool: string; detail?: string }
  | { type: "tool_result"; tool: string; records: number };

interface Exchange {
  question: string;
  answer: string;
  citations: Citation[];
  trace: TraceEntry[];
  cached?: boolean;
  provider?: "anthropic" | "openai";
  model?: string;
  fallbackUsed?: boolean;
}

type FixedAskScope =
  | { type: "state"; stateCode: string }
  | { type: "member"; bioguideId: string };

const SUGGESTIONS = [
  "Who represents me in Congress?",
  "How did my representative vote recently?",
  "Who are my senators' top campaign contributors?",
];

const MORE_EXAMPLES: { group: string; items: string[] }[] = [
  {
    group: "Votes",
    items: [
      "How did my senators vote this month?",
      "Has my representative missed many votes?",
    ],
  },
  {
    group: "Money",
    items: [
      "Who are my senators' top campaign contributors?",
      "How much of my representative's money comes from PACs?",
      "How much did this delegation raise for the 2026 cycle?",
    ],
  },
  {
    group: "Bills & committees",
    items: [
      "What bills has my delegation introduced lately?",
      "What committees does my representative sit on?",
    ],
  },
  {
    group: "2026 races",
    items: [
      "Which congressional seats here are up in 2026?",
      "Who has filed with the FEC for these races?",
    ],
  },
];

// Shown when no location is set: name a state so the stateless backend can
// scope each question. Every one is answerable from official records.
const NATIONAL_SUGGESTIONS = [
  "Who represents Texas in Congress?",
  "How did California's senators vote recently?",
  "Which Ohio seats are up in 2026?",
];

const NATIONAL_EXAMPLES: { group: string; items: string[] }[] = [
  {
    group: "Members",
    items: [
      "Who represents Florida in the House?",
      "What committees do Michigan's senators sit on?",
    ],
  },
  {
    group: "Money",
    items: [
      "Who are Pennsylvania's senators' top contributors?",
      "How much has Arizona's delegation raised this cycle?",
    ],
  },
  {
    group: "2026 races",
    items: [
      "Which Georgia seats are up in 2026?",
      "Who has filed with the FEC in Nevada?",
    ],
  },
];

const TOOL_LABELS: Record<string, string> = {
  find_members: "member search",
  get_race_candidates: "FEC candidate filings",
  get_delegation: "delegation roster",
  get_member_votes: "roll-call votes",
  get_member_finance: "FEC campaign finance",
  get_member_bills: "Congress.gov bills",
  get_member_committees: "committee assignments",
  get_member_terms: "term dates",
  get_member_biography: "reviewed official biography",
};

const ALLOWED_HOSTS = [
  "congress.gov",
  "www.congress.gov",
  "fec.gov",
  "www.fec.gov",
  "vote.gov",
  "www.vote.gov",
];

// Where a "Checked:" footer chip should point: the page that holds the data
// the tool read. Citations the reader can actually click beat bare assertions.
function traceHref(t: TraceEntry): string | null {
  const id =
    typeof t.input.bioguide_id === "string" ? t.input.bioguide_id : null;
  const st =
    typeof t.input.state_code === "string"
      ? t.input.state_code.toUpperCase()
      : null;
  switch (t.tool) {
    case "get_delegation":
    case "get_race_candidates":
      return st && /^[A-Z]{2}$/.test(st) ? `/state/${st}` : null;
    case "get_member_votes":
    case "get_member_finance":
    case "get_member_bills":
    case "get_member_terms":
    case "get_member_biography":
    case "get_member_committees":
      return id && /^[A-Z][0-9]{6}$/.test(id) ? `/member/${id}` : null;
    default:
      return null;
  }
}

// Exact allowlist for internal links: entity routes only. This rejects
// protocol-relative tricks like //evil.example and /\evil.example, which
// a bare startsWith("/") check lets through.
const INTERNAL_HREF_RE =
  /^\/(member|bill|state|committee|race)\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Minimal renderer for the model's constrained markdown: paragraphs,
// [text](href) links (entity routes or allow-listed official hosts), **bold**.
function renderAnswer(text: string): ReactNode[] {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((para, pi) => (
      <p key={pi} className="mt-2 first:mt-0 text-sm leading-relaxed text-neutral-800">
        {renderInline(para.trim(), pi)}
      </p>
    ));
}

function renderInline(text: string, keyBase: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\[(\d{1,2})\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let k = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[4] !== undefined) {
      // Server-validated footnote marker: every number maps to a retrieved
      // record listed in the Sources drawer below the answer.
      nodes.push(
        <sup
          key={`${keyBase}-${k++}`}
          className="ml-0.5 font-mono text-[10px] text-neutral-400"
        >
          [{match[4]}]
        </sup>
      );
    } else if (match[1] !== undefined) {
      const href = match[2];
      if (INTERNAL_HREF_RE.test(href)) {
        nodes.push(
          <Link key={`${keyBase}-${k++}`} href={href} className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-800">
            {match[1]}
          </Link>
        );
      } else if (isAllowedExternal(href)) {
        nodes.push(
          <a key={`${keyBase}-${k++}`} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-800">
            {match[1]}
          </a>
        );
      } else {
        nodes.push(match[1]);
      }
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={`${keyBase}-${k++}`}>{match[3]}</strong>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isAllowedExternal(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === "https:" && ALLOWED_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

const partyColor = (party: string) =>
  party === "Democrat"
    ? "text-blue-700"
    : party === "Republican"
      ? "text-red-700"
      : "text-neutral-700";

// Pair "tool" events with their "tool_result" in arrival order so each line
// upgrades from "Checking..." to "Checked — N records" as the loop verifies
// it. Every line mirrors a call the server actually made — no fabricated
// progress.
function progressLines(progress: ProgressEvent[]): string[] {
  const lines: string[] = [];
  const pending: number[] = [];
  for (const event of progress) {
    if (event.type === "tool") {
      const label = TOOL_LABELS[event.tool] ?? event.tool;
      lines.push(
        `Checking ${label}${event.detail ? ` for "${event.detail}"` : ""}...`
      );
      pending.push(lines.length - 1);
    } else if (event.type === "tool_result") {
      const label = TOOL_LABELS[event.tool] ?? event.tool;
      const line = `Checked ${label} — ${event.records} record${event.records === 1 ? "" : "s"}`;
      const idx = pending.shift();
      if (idx != null) lines[idx] = line;
      else lines.push(line);
    } else if (event.type === "provider" && event.fallback) {
      lines.push("Primary provider unavailable — retrying with the fallback...");
    }
  }
  return lines.slice(-4);
}

// Honest wait status: verified progress events when streaming, time-based
// escalation copy as the fallback. It never names a record type it cannot
// know is being read.
function PendingStatus({ progress }: { progress: ProgressEvent[] }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const lines = progressLines(progress);
  if (lines.length > 0) {
    return (
      <div className="text-sm text-neutral-500" role="status">
        {lines.map((line, i) => (
          <p key={i} className="mt-0.5 first:mt-0 flex items-center gap-2">
            {i === lines.length - 1 && (
              <span className="size-2 animate-pulse rounded-full bg-neutral-400" aria-hidden />
            )}
            <span>{line}</span>
          </p>
        ))}
      </div>
    );
  }
  const copy =
    seconds < 8
      ? "Checking official records..."
      : seconds < 20
        ? "Still checking - this one needs several lookups..."
        : `Still working (${seconds}s). Lookups stop at 45 seconds.`;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-neutral-500">
      <span className="size-2 animate-pulse rounded-full bg-neutral-400" aria-hidden />
      <span role="status">{copy}</span>
    </span>
  );
}

// A question built on a bare SINGULAR pronoun with no name is guaranteed to
// fail on a backend where every question stands alone. Plural pronouns stay
// allowed - "who are their top donors?" validly means the located delegation,
// which the model always receives. Catch the doomed shape client-side and
// teach it instead of burning a model call.
const DANGLING_REFERENT_RE =
  /\b(he|she|his|her|hers|him|that (bill|vote|member)|what about)\b/i;

function hasDanglingReferent(q: string): boolean {
  if (!DANGLING_REFERENT_RE.test(q)) return false;
  if (/\b(my|me|our)\b/i.test(q)) return false;
  // A capitalized word mid-question is probably a name; give it the benefit
  // of the doubt.
  return !/\s[A-Z][a-z]/.test(q);
}

// With no location set, "who represents me?" has nothing to resolve against.
// Nudge to set a location or name a place — but only when the reader named no
// member or state (any capitalized word after the first is treated as one).
const SELF_REFERENCE_RE = /\b(my|me|i|mine|our|us)\b/i;

function needsLocationForSelf(q: string): boolean {
  if (!SELF_REFERENCE_RE.test(q)) return false;
  const words = q.trim().split(/\s+/);
  return !words.slice(1).some((w) => /^[A-Z][a-z]/.test(w));
}

export default function AskClient({
  initialLocated,
  scope,
}: {
  // When set (state pages), the surface is pre-scoped: no location bar, no
  // delegation card — the page around it already shows the roster.
  initialLocated?: Located;
  scope?: FixedAskScope;
} = {}) {
  const fixedLocation = Boolean(initialLocated);
  const [locationInput, setLocationInput] = useState("");
  const [located, setLocated] = useState<Located | null>(initialLocated ?? null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [rateLimitNote, setRateLimitNote] = useState<string | null>(null);
  const [budgetExhausted, setBudgetExhausted] = useState(false);
  const [referentNudge, setReferentNudge] = useState(false);
  const [locationNudge, setLocationNudge] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [showExamples, setShowExamples] = useState(false);
  const askInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const asking = pendingQuestion !== null;

  async function locate(e: React.FormEvent) {
    e.preventDefault();
    if (!locationInput.trim() || locating) return;
    setLocating(true);
    setLocateError(null);
    try {
      const r = await fetch("/api/ask/locate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: locationInput.trim() }),
      });
      const json = await r.json();
      if (!r.ok) {
        setLocateError(json.error ?? "Lookup failed.");
        return;
      }
      setLocated(json);
      setExchanges([]);
      setAskError(null);
      setLocationNudge(false);
      askInputRef.current?.focus();
    } catch {
      setLocateError("Lookup failed. Check your connection and try again.");
    } finally {
      setLocating(false);
    }
  }

  function pushExchange(question: string, data: Record<string, unknown>) {
    setExchanges((prev) => [
      ...prev,
      {
        question,
        answer: typeof data.answer === "string" ? data.answer : "",
        citations: Array.isArray(data.citations)
          ? (data.citations as Citation[])
          : [],
        trace: Array.isArray(data.trace) ? (data.trace as TraceEntry[]) : [],
        cached: data.cached === true,
        provider:
          data.provider === "anthropic" || data.provider === "openai"
            ? data.provider
            : undefined,
        model: typeof data.model === "string" ? data.model : undefined,
        fallbackUsed: data.fallbackUsed === true,
      },
    ]);
  }

  function noteRateLimit(message: string, question: string, retryAfterSeconds?: number) {
    // A working limit is not an error: neutral styling, a concrete retry
    // time, and the daily budget puts the whole surface to sleep rather
    // than inviting retries.
    const wait =
      retryAfterSeconds && retryAfterSeconds > 0
        ? ` Try again in about ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minutes.`
        : "";
    setRateLimitNote(`${message}${wait}`);
    if (message.includes("daily budget")) setBudgetExhausted(true);
    setQuestion(question);
  }

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || asking || budgetExhausted) return;
    const national = !scope && !located;
    // No location and a bare self-reference ("who represents me?") has nothing
    // to resolve against — send them to the location bar before spending a call.
    if (national && exchanges.length === 0 && needsLocationForSelf(trimmed)) {
      setLocationNudge(true);
      setQuestion(trimmed);
      return;
    }
    setLocationNudge(false);
    // With follow-ups, "she" can resolve against the prior exchange — the
    // nudge only fires when there is no earlier answer to point at.
    if (exchanges.length === 0 && hasDanglingReferent(trimmed)) {
      setReferentNudge(true);
      setQuestion(trimmed);
      askInputRef.current?.focus();
      return;
    }
    setReferentNudge(false);
    setPendingQuestion(trimmed);
    setAskError(null);
    setRateLimitNote(null);
    setQuestion("");
    setShowExamples(false);
    setProgress([]);
    const history = exchanges
      .slice(-2)
      .map((e) => ({ question: e.question, answer: e.answer }));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        signal: controller.signal,
        body: JSON.stringify({
          question: trimmed,
          scope:
            scope ??
            (located
              ? {
                  type: "state",
                  stateCode: located.stateCode,
                  district: located.district,
                }
              : { type: "national" }),
          history,
        }),
      });

      const contentType = r.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        // Pre-stream rejections (rate limits, validation) come back as JSON.
        const json = await r.json();
        if (r.status === 429) {
          const retryAfter = parseInt(r.headers.get("Retry-After") ?? "", 10);
          noteRateLimit(
            json.error ?? "Limit reached.",
            trimmed,
            Number.isFinite(retryAfter) ? retryAfter : undefined
          );
          return;
        }
        if (!r.ok) {
          setAskError(json.error ?? "The lookup failed. Try again.");
          return;
        }
        pushExchange(trimmed, json);
        return;
      }

      // SSE: verified progress events while the loop runs, then a terminal
      // result or error event carrying the same payload as the JSON path.
      const reader = r.body?.getReader();
      if (!reader) {
        setAskError("The lookup failed. Try again.");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let terminalSeen = false;
      const handleEvent = (name: string, data: unknown) => {
        if (name === "progress" && data && typeof data === "object") {
          setProgress((prev) => [...prev, data as ProgressEvent]);
          return;
        }
        if (name === "result" && data && typeof data === "object") {
          terminalSeen = true;
          pushExchange(trimmed, data as Record<string, unknown>);
          return;
        }
        if (name === "error" && data && typeof data === "object") {
          terminalSeen = true;
          const payload = data as Record<string, unknown>;
          const message =
            typeof payload.error === "string" ? payload.error : "The lookup failed.";
          if (payload.status === 429) noteRateLimit(message, trimmed);
          else setAskError(message);
        }
      };
      let finished = false;
      while (!finished) {
        const chunk = await reader.read();
        finished = chunk.done;
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), {
          stream: !finished,
        });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const eventMatch = /^event: (.+)$/m.exec(rawEvent);
          const dataMatch = /^data: (.+)$/m.exec(rawEvent);
          if (!eventMatch || !dataMatch) continue;
          try {
            handleEvent(eventMatch[1], JSON.parse(dataMatch[1]));
          } catch {
            // Malformed frame; skip.
          }
        }
      }
      if (!terminalSeen) {
        setAskError("The lookup ended without an answer. Try again.");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Reader cancelled; restore the question so it isn't lost.
        setQuestion(trimmed);
      } else {
        setAskError("The lookup failed. Check your connection and try again.");
      }
    } finally {
      abortRef.current = null;
      setPendingQuestion(null);
    }
  }

  function cancelAsk() {
    abortRef.current?.abort();
  }

  const senators = located?.members.filter((m) => m.chamber === "senate") ?? [];
  const rep =
    located && located.district != null
      ? (located.members.find((m) => m.chamber === "house" && m.district === located.district) ??
        located.members.find((m) => m.chamber === "house" && m.district === 0) ??
        null)
      : null;
  const focusMembers = rep ? [...senators, rep] : senators;
  const scopedMember = scope?.type === "member" ? located?.members[0] ?? null : null;

  // Chips with real names outperform generic ones, and they teach the
  // "name the member" question shape this stateless backend needs.
  const suggestions = scopedMember
    ? [
        `What does ${scopedMember.fullName}'s official biography say about their background?`,
        `How did ${scopedMember.fullName} vote recently?`,
        `Who are ${scopedMember.fullName}'s top campaign contributors?`,
      ]
    : located
      ? [
          "Who represents me in Congress?",
          rep
            ? `How did ${rep.fullName} vote recently?`
            : "How did my representative vote recently?",
          senators[0]
            ? `Who are ${senators[0].fullName}'s top campaign contributors?`
            : SUGGESTIONS[2],
        ]
      : NATIONAL_SUGGESTIONS;

  const exampleGroups = scopedMember
    ? [
        {
          group: "Record",
          items: [
            `What does ${scopedMember.fullName}'s official biography say?`,
            `What bills has ${scopedMember.fullName} sponsored?`,
            `What committees does ${scopedMember.fullName} sit on?`,
          ],
        },
        {
          group: "2026 race",
          items: [
            `Is ${scopedMember.fullName}'s seat up in 2026?`,
            "Who has filed with the FEC for this seat?",
          ],
        },
      ]
    : located
      ? MORE_EXAMPLES
      : NATIONAL_EXAMPLES;

  return (
    <div>
      {/* Bar 1: location (hidden when the page pre-scopes the location) */}
      {!fixedLocation && (
      <form onSubmit={locate} className="flex gap-2">
        <input
          type="search"
          value={locationInput}
          onChange={(e) => setLocationInput(e.target.value)}
          placeholder='Your state or address — "Indiana", "IN", or a street address'
          aria-label="State or street address"
          autoComplete="street-address"
          spellCheck={false}
          enterKeyHint="search"
          className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
          required
        />
        <button
          type="submit"
          disabled={locating}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {locating ? "Locating..." : "Set location"}
        </button>
      </form>
      )}

      {!fixedLocation && !located && (
        <p className="mt-2 text-xs text-neutral-500">
          Optional. Setting your location pins your district, highlights your own
          lawmakers, and tailors answers to your delegation. Or ask about any
          member of Congress below.
        </p>
      )}

      {locateError && (
        <div role="alert" className="mt-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {locateError}
        </div>
      )}

      {located && !fixedLocation && (
        <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-neutral-400">
            Your delegation
          </p>
          <p className="mt-1 text-sm">
            <Link href={`/state/${located.stateCode}`} className="font-medium text-neutral-900 hover:underline">
              {located.stateName}
            </Link>
            {located.district != null && (
              <span className="ml-2 text-neutral-500">· District {located.district}</span>
            )}
            {located.matchedAddress && (
              <span className="ml-2 font-mono text-xs text-neutral-400">{located.matchedAddress}</span>
            )}
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {(focusMembers.length > 0 ? focusMembers : located.members).map((m) => (
              <li key={m.bioguideId}>
                <Link
                  href={`/member/${m.bioguideId}`}
                  className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white py-1 pl-1 pr-3 no-underline hover:bg-neutral-100"
                >
                  {m.photoUrl ? (
                    <Image src={m.photoUrl} alt="" width={24} height={24} className="size-6 shrink-0 rounded-full bg-neutral-100 object-cover" />
                  ) : (
                    <span className="size-6 shrink-0 rounded-full bg-neutral-200" />
                  )}
                  <span className="text-xs font-medium text-neutral-900">{m.fullName}</span>
                  <span className={`text-xs ${partyColor(m.party)}`}>
                    {m.chamber === "senate" ? "Sen." : m.district === 0 ? "At-large" : `${located.stateCode}-${m.district}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {located.district == null && located.members.some((m) => m.chamber === "house") && (
            <p className="mt-2 text-xs text-neutral-400">
              Add a street address to pin down your House district.
            </p>
          )}
        </div>
      )}

      {/* Bar 2: ask */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="mt-6 flex gap-2"
      >
        <input
          ref={askInputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            budgetExhausted
              ? "The assistant is done for today — records below still work"
              : located
                ? scope?.type === "member"
                  ? `Ask about ${located.members[0]?.fullName ?? "this lawmaker"}`
                  : `Ask about the ${located.stateName} delegation`
                : "Ask about any member of Congress, or set your location above..."
          }
          aria-label="Your question"
          maxLength={400}
          disabled={budgetExhausted}
          enterKeyHint="send"
          className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-400"
        />
        <button
          type="submit"
          disabled={asking || budgetExhausted || !question.trim()}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {asking ? "Checking..." : "Ask"}
        </button>
      </form>

      {!budgetExhausted && (
        <p className="mt-2 text-xs text-neutral-400">
          Answers come only from retrieved records — votes, bills, campaign
          money, committees and reviewed official-site biographies. Follow-ups can build on your last two answers;
          every fact is re-checked against the records.
        </p>
      )}

      {locationNudge && (
        <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          No location is set, so there&apos;s nothing for &quot;me&quot; or
          &quot;my&quot; to point at. Set your location above, or name a state —
          like &quot;How did Ohio&apos;s senators vote?&quot;
        </div>
      )}

      {referentNudge && (
        <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
          There&apos;s no earlier answer yet for &quot;he&quot; or &quot;she&quot;
          to point at. Name the member instead
          {senators[0] ? ` — like "${senators[0].fullName}'s top donors".` : "."}
        </div>
      )}

      {rateLimitNote && (
        <div className="mt-3 rounded border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
          {rateLimitNote}
          {budgetExhausted && located && (
            <span>
              {" "}Every record it reads is still browsable:{" "}
              <Link href={`/state/${located.stateCode}`} className="font-medium underline decoration-stone-300 underline-offset-2">
                the {located.stateName} delegation page
              </Link>
              .
            </span>
          )}
        </div>
      )}

      {/* Example questions: chips before the first answer, a compact
          dropdown after, so exploration never disappears. Shown for the
          national (no-location) surface too. */}
      {(located || !fixedLocation) && (
        <div className="mt-3">
          {exchanges.length === 0 && !asking && (
            <ul className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
                  >
                    {s}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => setShowExamples((v) => !v)}
                  aria-expanded={showExamples}
                  className="rounded-full border border-dashed border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-500 hover:border-neutral-400 hover:text-neutral-900"
                >
                  {showExamples ? "Fewer examples" : "More examples"}
                </button>
              </li>
            </ul>
          )}
          {exchanges.length > 0 && !asking && (
            <button
              type="button"
              onClick={() => setShowExamples((v) => !v)}
              aria-expanded={showExamples}
              className="text-xs text-neutral-400 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700"
            >
              {showExamples ? "Hide example questions" : "Example questions"}
            </button>
          )}
          {showExamples && !asking && (
            <div className="mt-2 grid gap-3 rounded border border-neutral-200 bg-neutral-50 px-4 py-3 sm:grid-cols-2">
              {exampleGroups.map((g) => (
                <div key={g.group}>
                  <p className="text-xs uppercase tracking-wide text-neutral-400">{g.group}</p>
                  <ul className="mt-1 space-y-1">
                    {g.items.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          onClick={() => ask(s)}
                          className="text-left text-xs text-neutral-600 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {askError && (
        <div role="alert" className="mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {askError}
        </div>
      )}

      {(asking || exchanges.length > 0) && (
        <ol className="mt-6 space-y-4">
          {/* The pending question echoes immediately so the reader sees it
              landed; the status line stages honestly while the loop runs. */}
          {asking && (
            <li className="rounded border border-neutral-200 bg-white p-4">
              <p className="text-sm font-medium text-neutral-900">{pendingQuestion}</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <PendingStatus progress={progress} />
                <button
                  type="button"
                  onClick={cancelAsk}
                  className="text-xs text-neutral-400 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700"
                >
                  Cancel
                </button>
              </div>
            </li>
          )}
          {[...exchanges].reverse().map((ex, i) => (
            <li key={exchanges.length - i} className="rounded border border-neutral-200 bg-white p-4">
              <p className="text-sm font-medium text-neutral-900">{ex.question}</p>
              <div className="mt-3">{renderAnswer(ex.answer)}</div>
              {ex.citations.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-700">
                    Sources ({ex.citations.length})
                  </summary>
                  <ol className="mt-2 space-y-1">
                    {ex.citations.map((c) => (
                      <li key={c.n} className="flex gap-2 text-xs text-neutral-600">
                        <span className="font-mono text-neutral-400">{c.n}.</span>
                        {c.href ? (
                          <Link
                            href={c.href}
                            className="underline decoration-neutral-200 underline-offset-2 hover:text-neutral-900"
                          >
                            {c.label}
                          </Link>
                        ) : (
                          <span>{c.label}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <p className="mt-3 border-t border-neutral-100 pt-2 text-xs text-neutral-400">
                {ex.trace.length > 0 ? (
                  <>
                    Checked:{" "}
                    {[
                      ...ex.trace
                        .reduce((m, t) => {
                          const label = TOOL_LABELS[t.tool] ?? t.tool;
                          if (!m.has(label) || !m.get(label))
                            m.set(label, traceHref(t));
                          return m;
                        }, new Map<string, string | null>())
                        .entries(),
                    ].map(([label, href], i, arr) => (
                      <span key={label}>
                        {href ? (
                          <Link
                            href={href}
                            className="underline decoration-neutral-200 underline-offset-2 hover:text-neutral-700"
                          >
                            {label}
                          </Link>
                        ) : (
                          label
                        )}
                        {i < arr.length - 1 ? ", " : ". "}
                      </span>
                    ))}
                  </>
                ) : (
                  "Answered from the delegation roster. "
                )}
                Answers draw only on official records in this site&apos;s database.
                {ex.cached && " Served from today's cache."}
                {ex.provider && (
                  <>
                    {" "}Processed by {ex.provider === "anthropic" ? "Anthropic" : "OpenAI"}
                    {ex.fallbackUsed ? " after the primary provider was unavailable" : ""}.
                  </>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
