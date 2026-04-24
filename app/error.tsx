"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <p className="font-mono text-xs uppercase text-neutral-400">Error</p>
      <h1 className="mt-2 font-serif text-2xl font-semibold">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-neutral-500">
        {error.message || "An unexpected error occurred while loading this page."}
      </p>
      <button
        onClick={() => reset()}
        className="mt-6 rounded bg-neutral-900 px-4 py-2 text-sm text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Try again
      </button>
    </div>
  );
}
