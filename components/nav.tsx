"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "./search";

const links = [
  { href: "/", label: "States" },
  { href: "/find", label: "Find mine" },
  { href: "/compare", label: "Compare" },
  { href: "/trades", label: "Trades" },
  { href: "/for-journalists", label: "For journalists" },
  { href: "/health", label: "Health" },
  { href: "/about", label: "About" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="relative border-b border-neutral-200">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link
          href="/"
          aria-label="Delegation Decoded home"
          className="flex items-center gap-2 no-underline"
        >
          <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center rounded bg-neutral-900 font-[family-name:var(--font-source-serif)] text-[13px] font-bold tracking-tight text-white">
            DD
          </span>
          <span className="font-[family-name:var(--font-source-serif)] text-base font-semibold tracking-tight text-neutral-900">
            Delegation Decoded
          </span>
        </Link>

        <div className="hidden items-center gap-5 text-sm text-neutral-500 md:flex">
          {links.map((link) => {
            const active =
              pathname === link.href ||
              (link.href !== "/" && pathname?.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`transition-colors ${
                  active ? "text-neutral-900" : "hover:text-neutral-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <Search />
        </div>

        <div className="flex items-center md:hidden">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="-mr-1.5 cursor-pointer p-1.5"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="text-neutral-700"
            >
              {open ? (
                <>
                  <line x1="4" y1="4" x2="16" y2="16" />
                  <line x1="16" y1="4" x2="4" y2="16" />
                </>
              ) : (
                <>
                  <line x1="3" y1="5" x2="17" y2="5" />
                  <line x1="3" y1="10" x2="17" y2="10" />
                  <line x1="3" y1="15" x2="17" y2="15" />
                </>
              )}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 border-b border-neutral-200 bg-white md:hidden">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3">
            {links.map((link) => {
              const active =
                pathname === link.href ||
                (link.href !== "/" && pathname?.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`py-1.5 text-sm transition-colors ${
                    active
                      ? "font-medium text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-900"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
