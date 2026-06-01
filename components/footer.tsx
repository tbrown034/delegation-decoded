import Link from "next/link";
import { HealthDot } from "./health-dot";

export function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-stone-50">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <span aria-hidden className="inline-flex size-6 items-center justify-center rounded bg-neutral-900 font-[family-name:var(--font-source-serif)] text-[11px] font-bold tracking-tight text-white opacity-70">
              DD
            </span>
            <p className="text-xs text-neutral-400">
              Congressional accountability by state delegation
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-500">
            <Link href="/" className="transition-colors hover:text-neutral-900">
              States
            </Link>
            <Link href="/find" className="transition-colors hover:text-neutral-900">
              Find mine
            </Link>
            <Link href="/compare" className="transition-colors hover:text-neutral-900">
              Compare
            </Link>
            <Link href="/trades" className="transition-colors hover:text-neutral-900">
              Trades
            </Link>
            <Link href="/for-journalists" className="transition-colors hover:text-neutral-900">
              For journalists
            </Link>
            <HealthDot />
            <Link href="/about" className="transition-colors hover:text-neutral-900">
              About & Methodology
            </Link>
          </nav>
        </div>

        <div className="mt-8 space-y-3 border-t border-neutral-200 pt-6 text-[11px] leading-relaxed text-neutral-400">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Data from{" "}
              <a
                href="https://github.com/unitedstates/congress-legislators"
                className="underline hover:text-neutral-600"
                target="_blank"
                rel="noopener noreferrer"
              >
                @unitedstates
              </a>
              {", "}
              <a
                href="https://api.congress.gov"
                className="underline hover:text-neutral-600"
                target="_blank"
                rel="noopener noreferrer"
              >
                Congress.gov
              </a>
              {", "}
              <a
                href="https://api.open.fec.gov"
                className="underline hover:text-neutral-600"
                target="_blank"
                rel="noopener noreferrer"
              >
                FEC
              </a>
              {", "}
              <a
                href="https://disclosures-clerk.house.gov"
                className="underline hover:text-neutral-600"
                target="_blank"
                rel="noopener noreferrer"
              >
                House Clerk
              </a>
              {", and "}
              <a
                href="https://efdsearch.senate.gov"
                className="underline hover:text-neutral-600"
                target="_blank"
                rel="noopener noreferrer"
              >
                Senate eFD
              </a>
              . For journalism and public-records purposes. Not affiliated with the U.S. government.
            </p>
            <p className="whitespace-nowrap">
              Built by{" "}
              <a
                href="https://trevorthewebdeveloper.com"
                className="underline hover:text-neutral-600"
                target="_blank"
                rel="noopener noreferrer"
              >
                Trevor Brown
              </a>
            </p>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <a
              href="https://github.com/tbrown034/delegation-decoded"
              className="underline hover:text-neutral-600"
              target="_blank"
              rel="noopener noreferrer"
            >
              Source code
            </a>
            <a
              href="https://github.com/tbrown034/delegation-decoded/issues"
              className="underline hover:text-neutral-600"
              target="_blank"
              rel="noopener noreferrer"
            >
              Report a bug
            </a>
            <a
              href="mailto:trevorbrown.web@gmail.com"
              className="underline hover:text-neutral-600"
            >
              Contact
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
