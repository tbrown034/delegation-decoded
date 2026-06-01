export default function MemberLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="animate-pulse">
        {/* Breadcrumb */}
        <div className="mb-8 h-3 w-40 rounded bg-neutral-100" />

        {/* Header */}
        <div className="mb-10 flex items-start gap-5">
          <div className="size-20 shrink-0 rounded-full bg-neutral-100" />
          <div className="space-y-2">
            <div className="h-7 w-56 rounded bg-neutral-100" />
            <div className="h-4 w-40 rounded bg-neutral-100" />
            <div className="h-3 w-64 rounded bg-neutral-100" />
          </div>
        </div>

        {/* Content sections */}
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mb-10 space-y-2">
            <div className="h-5 w-32 rounded bg-neutral-100" />
            {Array.from({ length: 4 }).map((_, j) => (
              <div
                key={j}
                className="h-10 rounded bg-neutral-50"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
