"use client";

import { useCallback, useEffect, useEffectEvent, useReducer, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Hit = {
  type: "member" | "state" | "bill" | "committee";
  href: string;
  title: string;
  subtitle: string;
  rank: number;
};

const TYPE_LABEL: Record<Hit["type"], string> = {
  member: "Member",
  state: "State",
  bill: "Bill",
  committee: "Committee",
};

interface SearchState {
  open: boolean;
  query: string;
  hits: Hit[];
  active: number;
  loading: boolean;
}

type SearchAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "query"; query: string }
  | { type: "clearResults" }
  | { type: "loading" }
  | { type: "loaded"; hits: Hit[] }
  | { type: "active"; active: number };

const initialSearchState: SearchState = {
  open: false,
  query: "",
  hits: [],
  active: 0,
  loading: false,
};

function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "open":
      return { ...state, open: true };
    case "close":
      return initialSearchState;
    case "query":
      return { ...state, query: action.query };
    case "clearResults":
      return { ...state, hits: [], active: 0, loading: false };
    case "loading":
      return { ...state, loading: true };
    case "loaded":
      return { ...state, hits: action.hits, active: 0, loading: false };
    case "active":
      return { ...state, active: action.active };
  }
}

export function Search() {
  const [state, dispatch] = useReducer(searchReducer, initialSearchState);
  const inputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const router = useRouter();

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const openSearch = useCallback(() => {
    dispatch({ type: "open" });
    focusInput();
  }, [focusInput]);

  const close = useCallback(() => {
    controllerRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    dispatch({ type: "close" });
  }, []);
  const closeEvent = useEffectEvent(close);
  const openSearchEvent = useEffectEvent(openSearch);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openSearchEvent();
      } else if (e.key === "Escape" && state.open) {
        closeEvent();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.open]);

  useEffect(() => {
    return close;
  }, [close]);

  function handleQueryChange(nextQuery: string) {
    dispatch({ type: "query", query: nextQuery });
    controllerRef.current?.abort();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (nextQuery.trim().length < 2) {
      dispatch({ type: "clearResults" });
      return;
    }

    const ctl = new AbortController();
    controllerRef.current = ctl;
    dispatch({ type: "loading" });
    timeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(nextQuery)}`, {
          signal: ctl.signal,
        });
        const data = await res.json();
        dispatch({ type: "loaded", hits: data.hits as Hit[] });
      } catch {
        if (!ctl.signal.aborted) dispatch({ type: "loaded", hits: [] });
      }
    }, 120);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      dispatch({
        type: "active",
        active: Math.min(state.active + 1, state.hits.length - 1),
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      dispatch({ type: "active", active: Math.max(state.active - 1, 0) });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = state.hits[state.active];
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
        onClick={openSearch}
        aria-label="Open search"
        className="inline-flex h-8 items-center gap-2 rounded border border-neutral-200 px-3 text-xs text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-700"
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

      {state.open && (
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
                value={state.query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded={state.hits.length > 0}
                aria-controls="search-listbox"
                aria-autocomplete="list"
                aria-activedescendant={
                  state.active >= 0 && state.hits.length > 0
                    ? `search-opt-${state.active}`
                    : undefined
                }
                aria-label="Search members, states, bills, and committees"
                placeholder="Search members, states, bills…"
                spellCheck={false}
                autoComplete="off"
                enterKeyHint="search"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
              />
              {state.loading && (
                <span className="font-mono text-[10px] uppercase tracking-wide text-neutral-400">
                  Searching…
                </span>
              )}
            </div>

            <div
              className="max-h-[60vh] overflow-y-auto overscroll-contain py-2"
              aria-live="polite"
            >
              {state.query.trim().length < 2 ? (
                <p className="px-4 py-3 text-xs text-neutral-500">
                  Type at least 2 characters. Try “Khanna”, “HR 1”, or “California”.
                </p>
              ) : state.hits.length === 0 && !state.loading ? (
                <p className="px-4 py-3 text-xs text-neutral-500">No matches.</p>
              ) : (
                <ul id="search-listbox" role="listbox">
                  {state.hits.map((hit, i) => (
                    <li key={`${hit.type}-${hit.href}`}>
                      <Link
                        href={hit.href}
                        id={`search-opt-${i}`}
                        role="option"
                        aria-selected={state.active === i}
                        onClick={close}
                        onMouseEnter={() =>
                          dispatch({ type: "active", active: i })
                        }
                        className={`flex items-baseline justify-between gap-3 px-4 py-2 text-sm no-underline ${
                          state.active === i ? "bg-stone-100" : "hover:bg-stone-50"
                        }`}
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
