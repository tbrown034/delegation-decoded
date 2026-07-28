import { Children } from "react";

/**
 * Shows the first `initial` rows and tucks the rest behind a disclosure.
 *
 * Uses native details/summary rather than state so member pages stay Server
 * Components — the full list is in the HTML for search and Cmd-F either way.
 * Rows keep their own `last:border-0`, which still resolves correctly because
 * the visible head and the hidden tail are each their own last-child scope.
 */
export function CollapsibleList({
  children,
  initial = 8,
  label,
}: {
  children: React.ReactNode;
  initial?: number;
  label: string;
}) {
  const items = Children.toArray(children);
  const hidden = items.length - initial;

  if (hidden <= 0) return <div>{items}</div>;

  return (
    <div>
      {items.slice(0, initial)}
      <details className="group">
        <summary className="cursor-pointer list-none py-2 font-mono text-[11px] uppercase tracking-wider text-neutral-400 transition-colors hover:text-neutral-900 [&::-webkit-details-marker]:hidden">
          <span className="group-open:hidden">
            Show {hidden} more {label}
          </span>
          <span className="hidden group-open:inline">Show fewer</span>
        </summary>
        {items.slice(initial)}
      </details>
    </div>
  );
}
