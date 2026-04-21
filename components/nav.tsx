import Link from "next/link";

export function Nav() {
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          href="/"
          className="font-serif text-lg font-semibold tracking-tight text-neutral-900 no-underline dark:text-neutral-100"
        >
          Delegation Decoded
        </Link>
        <nav className="flex items-center gap-5 text-[13px]">
          <Link
            href="/"
            className="text-neutral-500 no-underline transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            States
          </Link>
          <Link
            href="/about"
            className="text-neutral-500 no-underline transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            About & Methodology
          </Link>
        </nav>
      </div>
    </header>
  );
}
