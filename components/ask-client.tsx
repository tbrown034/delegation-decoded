"use client";

import { useRef, useState } from "react";
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

interface Exchange {
  question: string;
  answer: string;
  trace: TraceEntry[];
  cached?: boolean;
}

const SUGGESTIONS = [
  "Who represents me in Congress?",
  "How did my representative vote recently?",
  "Who are my senators' top campaign contributors?",
  "What bills has my delegation introduced lately?",
  "Who are North Dakota's senators?",
];

const TOOL_LABELS: Record<string, string> = {
  get_delegation: "delegation roster",
  get_member_votes: "roll-call votes",
  get_member_finance: "FEC campaign finance",
  get_member_bills: "Congress.gov bills",
  get_member_committees: "committee assignments",
  get_member_terms: "term dates",
};

const ALLOWED_HOSTS = ["congress.gov", "www.congress.gov", "fec.gov", "www.fec.gov"];

// Minimal renderer for the model's constrained markdown: paragraphs,
// [text](href) links (internal or allow-listed official hosts), **bold**.
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
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let k = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      const href = match[2];
      if (href.startsWith("/")) {
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

export default function AskClient() {
  const [locationInput, setLocationInput] = useState("");
  const [located, setLocated] = useState<Located | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const askInputRef = useRef<HTMLInputElement>(null);

  async function locate(e: React.FormEvent) {
    e.preventDefault();
    if (!locationInput.trim() || locating) return;
    setLocating(true);
    setLocateError(null);
    try {
      const r = await fetch(`/api/ask/locate?q=${encodeURIComponent(locationInput.trim())}`);
      const json = await r.json();
      if (!r.ok) {
        setLocateError(json.error ?? "Lookup failed.");
        return;
      }
      setLocated(json);
      setExchanges([]);
      setAskError(null);
      askInputRef.current?.focus();
    } catch {
      setLocateError("Lookup failed. Check your connection and try again.");
    } finally {
      setLocating(false);
    }
  }

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || !located || asking) return;
    setAsking(true);
    setAskError(null);
    setQuestion("");
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          stateCode: located.stateCode,
          district: located.district,
        }),
      });
      const json = await r.json();
      if (!r.ok) {
        setAskError(json.error ?? "The lookup failed. Try again.");
        return;
      }
      setExchanges((prev) => [...prev, { question: trimmed, answer: json.answer, trace: json.trace ?? [], cached: json.cached === true }]);
    } catch {
      setAskError("The lookup failed. Check your connection and try again.");
    } finally {
      setAsking(false);
    }
  }

  const senators = located?.members.filter((m) => m.chamber === "senate") ?? [];
  const rep =
    located && located.district != null
      ? (located.members.find((m) => m.chamber === "house" && m.district === located.district) ??
        located.members.find((m) => m.chamber === "house" && m.district === 0) ??
        null)
      : null;
  const focusMembers = rep ? [...senators, rep] : senators;

  return (
    <div>
      {/* Bar 1: location */}
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

      {locateError && (
        <div role="alert" className="mt-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {locateError}
        </div>
      )}

      {located && (
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
            located
              ? `Ask about the ${located.stateName} delegation...`
              : "Set a location first, then ask..."
          }
          aria-label="Your question"
          maxLength={400}
          disabled={!located}
          enterKeyHint="send"
          className="flex-1 rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-400"
        />
        <button
          type="submit"
          disabled={!located || asking || !question.trim()}
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {asking ? "Checking..." : "Ask"}
        </button>
      </form>

      {located && exchanges.length === 0 && !asking && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
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
        </ul>
      )}

      {askError && (
        <div role="alert" className="mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {askError}
        </div>
      )}

      {asking && (
        <div className="mt-4 rounded border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-500">
          Checking official records...
        </div>
      )}

      {exchanges.length > 0 && (
        <ol className="mt-6 space-y-4">
          {[...exchanges].reverse().map((ex, i) => (
            <li key={exchanges.length - i} className="rounded border border-neutral-200 bg-white p-4">
              <p className="text-sm font-medium text-neutral-900">{ex.question}</p>
              <div className="mt-3">{renderAnswer(ex.answer)}</div>
              {ex.trace.length > 0 && (
                <p className="mt-3 border-t border-neutral-100 pt-2 text-xs text-neutral-400">
                  Checked:{" "}
                  {[...new Set(ex.trace.map((t) => TOOL_LABELS[t.tool] ?? t.tool))].join(", ")}. Answers draw only on official records in this site&apos;s database.
                  {ex.cached && " Served from today's cache."}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
