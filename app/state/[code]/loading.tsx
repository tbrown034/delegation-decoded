export default function StateLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="animate-pulse">
        {/* Breadcrumb */}
        <div className="mb-8 h-3 w-32 rounded bg-neutral-100 dark:bg-neutral-800" />

        {/* Header */}
        <div className="mb-10 space-y-2">
          <div className="h-9 w-48 rounded bg-neutral-100 dark:bg-neutral-800" />
          <div className="h-4 w-64 rounded bg-neutral-100 dark:bg-neutral-800" />
          <div className="mt-3 h-2 w-48 rounded bg-neutral-100 dark:bg-neutral-800" />
        </div>

        {/* Two column layout */}
        <div className="grid gap-10 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <div className="h-3 w-20 rounded bg-neutral-100 dark:bg-neutral-800" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 py-2.5"
              >
                <div className="h-9 w-9 rounded-full bg-neutral-100 dark:bg-neutral-800" />
                <div className="h-4 w-40 rounded bg-neutral-100 dark:bg-neutral-800" />
              </div>
            ))}
          </div>
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-8 rounded bg-neutral-100 dark:bg-neutral-800"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
