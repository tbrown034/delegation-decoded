export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 rounded bg-neutral-100 dark:bg-neutral-800" />
        <div className="h-4 w-96 rounded bg-neutral-100 dark:bg-neutral-800" />
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="h-16 rounded bg-neutral-100 dark:bg-neutral-800"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
