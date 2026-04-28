"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Hit = {
  type: "member" | "ticker" | "state";
  href: string;
  title: string;
  subtitle: string;
  rank: number;
};

const TYPE_LABEL: Record<Hit["type"], string> = {
  member: "Member",
  ticker: "Ticker",
  state: "State",
};

export function Search() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setActive(0);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      // wait one frame for the input to mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: ctl.signal,
        });
        const data = await res.json();
        setHits(data.hits as Hit[]);
        setActive(0);
      } catch {
        // aborted
      } finally {
        setLoading(false);
      }
    }, 120);
    return () => {
      ctl.abort();
      clearTimeout(t);
    };
  }, [query]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) {
        router.push(hit.href);
        close();
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open search"
        className="hidden h-8 items-center gap-2 rounded border border-neutral-200 px-3 text-xs text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-700 md:inline-flex"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <circle cx="7" cy="7" r="5" />
          <line x1="11" y1="11" x2="14" y2="14" strokeLinecap="round" />
        </svg>
        Search
        <kbd className="ml-1 rounded border border-neutral-200 bg-neutral-50 px-1 font-mono text-[10px] text-neutral-500">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/30 px-4 pt-[15vh]"
          onClick={close}
          role="presentation"
        >
          <div
            className="w-full max-w-xl rounded-lg border border-neutral-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-3">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-neutral-400"
                aria-hidden
              >
                <circle cx="7" cy="7" r="5" />
                <line x1="11" y1="11" x2="14" y2="14" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search members, tickers, states…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
              />
              {loading && (
                <span className="font-mono text-[10px] uppercase tracking-wide text-neutral-400">
                  Searching…
                </span>
              )}
            </div>

            <div className="max-h-[60vh] overflow-y-auto py-2">
              {query.trim().length < 2 ? (
                <p className="px-4 py-3 text-xs text-neutral-500">
                  Type at least 2 characters. Try “khanna”, “NVDA”, or “California”.
                </p>
              ) : hits.length === 0 && !loading ? (
                <p className="px-4 py-3 text-xs text-neutral-500">No matches.</p>
              ) : (
                <ul role="listbox">
                  {hits.map((hit, i) => (
                    <li key={`${hit.type}-${hit.href}-${i}`}>
                      <Link
                        href={hit.href}
                        onClick={close}
                        onMouseEnter={() => setActive(i)}
                        className={`flex items-baseline justify-between gap-3 px-4 py-2 text-sm no-underline ${
                          active === i ? "bg-stone-100" : "hover:bg-stone-50"
                        }`}
                        role="option"
                        aria-selected={active === i}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-neutral-900">
                            {hit.title}
                          </p>
                          <p className="truncate text-[12px] text-neutral-500">
                            {hit.subtitle}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-neutral-400">
                          {TYPE_LABEL[hit.type]}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
