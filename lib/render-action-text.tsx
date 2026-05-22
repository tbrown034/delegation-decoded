// Congress.gov occasionally embeds a `<a href="https://...">label</a>` in
// the latest-action text — usually a pointer to a discharge petition or
// CR reference. JSX escapes raw strings, so without help the user sees the
// literal tags. Render the text as a mix of plain segments and anchor
// elements, but only allow https:// links to a tight allowlist of hosts so
// hostile content from upstream can't smuggle in arbitrary URLs.

import { Fragment, type ReactNode } from "react";

const ALLOWED_HOSTS = new Set([
  "clerk.house.gov",
  "www.congress.gov",
  "congress.gov",
  "www.senate.gov",
  "senate.gov",
]);

const ANCHOR = /<a\s+href=(?:"|')([^"']+)(?:"|')[^>]*>([^<]*)<\/a>/gi;

export function renderActionText(raw: string | null): ReactNode {
  if (!raw) return null;
  const out: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  ANCHOR.lastIndex = 0;
  while ((match = ANCHOR.exec(raw)) !== null) {
    if (match.index > cursor) {
      out.push(raw.slice(cursor, match.index));
    }
    const [full, href, label] = match;
    let host: string | null = null;
    try {
      const u = new URL(href);
      host = u.protocol === "https:" ? u.host : null;
    } catch {
      host = null;
    }
    if (host && ALLOWED_HOSTS.has(host)) {
      out.push(
        <a
          key={`a-${match.index}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-neutral-900"
        >
          {label || href}
        </a>
      );
    } else {
      // Strip the markup but keep the visible label text.
      out.push(label || "");
    }
    cursor = match.index + full.length;
  }
  if (cursor < raw.length) out.push(raw.slice(cursor));
  return (
    <>
      {out.map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </>
  );
}
