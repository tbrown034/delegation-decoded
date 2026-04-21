export function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-stone-50 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-serif text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Delegation Decoded
            </p>
            <p className="mt-1 max-w-md text-[11px] leading-relaxed text-neutral-500">
              A public records project tracking U.S. congressional delegations
              across legislation, committee assignments, and campaign finance.
              Built for reporters, researchers, and the public.
            </p>
          </div>
          <div className="text-[11px] text-neutral-400">
            <p>
              Data:{" "}
              <a
                href="https://github.com/unitedstates/congress-legislators"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700 dark:decoration-neutral-600 dark:hover:text-neutral-300"
              >
                @unitedstates
              </a>
              {" / "}
              <a
                href="https://api.congress.gov"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700 dark:decoration-neutral-600 dark:hover:text-neutral-300"
              >
                Congress.gov
              </a>
              {" / "}
              <a
                href="https://api.open.fec.gov"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700 dark:decoration-neutral-600 dark:hover:text-neutral-300"
              >
                FEC
              </a>
            </p>
            <p className="mt-1">
              Built by{" "}
              <a
                href="https://trevorthewebdeveloper.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700 dark:decoration-neutral-600 dark:hover:text-neutral-300"
              >
                Trevor Brown
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
