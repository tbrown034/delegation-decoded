import Link from "next/link";

export default function StateNotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <p className="font-mono text-xs uppercase text-neutral-400">
        State not found
      </p>
      <h1 className="mt-2 font-serif text-2xl font-semibold">
        No delegation data for this state code
      </h1>
      <p className="mt-2 text-sm text-neutral-500">
        Check the URL and try again, or select a state from the homepage.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded bg-neutral-900 px-4 py-2 text-sm text-white no-underline transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        All states
      </Link>
    </div>
  );
}
