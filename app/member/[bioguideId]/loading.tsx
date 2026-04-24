export default function MemberLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="animate-pulse">
        {/* Breadcrumb */}
        <div className="mb-8 h-3 w-40 rounded bg-neutral-100 dark:bg-neutral-800" />

        {/* Header */}
        <div className="mb-10 flex items-start gap-5">
          <div className="h-20 w-20 shrink-0 rounded-full bg-neutral-100 dark:bg-neutral-800" />
          <div className="space-y-2">
            <div className="h-7 w-56 rounded bg-neutral-100 dark:bg-neutral-800" />
            <div className="h-4 w-40 rounded bg-neutral-100 dark:bg-neutral-800" />
            <div className="h-3 w-64 rounded bg-neutral-100 dark:bg-neutral-800" />
          </div>
        </div>

        {/* Content sections */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mb-10 space-y-2">
            <div className="h-5 w-32 rounded bg-neutral-100 dark:bg-neutral-800" />
            {Array.from({ length: 4 }).map((_, j) => (
              <div
                key={j}
                className="h-10 rounded bg-neutral-50 dark:bg-neutral-900"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
