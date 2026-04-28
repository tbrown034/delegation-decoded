import type { CoverageDetailItem } from "@/lib/queries";

const STATUS_STYLES = {
  present: {
    dot: "bg-emerald-500",
    label: "text-emerald-700",
  },
  expected_empty: {
    dot: "bg-neutral-300",
    label: "text-neutral-500",
  },
  missing: {
    dot: "bg-amber-500",
    label: "text-amber-700",
  },
} as const;

const STATUS_LABEL: Record<CoverageDetailItem["status"], string> = {
  present: "Tracked",
  expected_empty: "Not applicable",
  missing: "Investigating",
};

export function MemberCoverageCard({ items }: { items: CoverageDetailItem[] }) {
  return (
    <section className="mb-10 rounded border border-neutral-200 bg-stone-50 p-4">
      <h2 className="font-mono text-[10px] uppercase tracking-wide text-neutral-500">
        Data coverage for this member
      </h2>
      <p className="mt-1 max-w-2xl text-[12px] text-neutral-600">
        Every data source on the site, mapped to this member. A grey dot means the member is not expected to have data for that source — most members do not actively trade individual securities, and not every congressional office publishes an RSS feed.
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => {
          const style = STATUS_STYLES[item.status];
          return (
            <li key={item.source} className="flex items-baseline gap-3 text-sm">
              <span
                className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-neutral-900">
                    {item.label}
                  </span>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-wider ${style.label}`}
                  >
                    {STATUS_LABEL[item.status]}
                    {item.count > 0 ? ` · ${item.count.toLocaleString()}` : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-600">
                  {item.description}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
