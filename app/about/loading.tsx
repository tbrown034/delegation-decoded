export default function AboutLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="animate-pulse space-y-6">
        <div className="h-9 w-72 rounded bg-neutral-100 dark:bg-neutral-800" />
        <div className="space-y-2">
          <div className="h-4 w-full rounded bg-neutral-100 dark:bg-neutral-800" />
          <div className="h-4 w-5/6 rounded bg-neutral-100 dark:bg-neutral-800" />
          <div className="h-4 w-4/6 rounded bg-neutral-100 dark:bg-neutral-800" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="h-8 w-16 rounded bg-neutral-100 dark:bg-neutral-800" />
              <div className="h-3 w-24 rounded bg-neutral-100 dark:bg-neutral-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
