// Expanded plain-text methodology for AI crawlers, referenced from /llms.txt.
export const revalidate = 86400;

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://delegationdecoded.org";

export function GET() {
  const body = `# Delegation Decoded — full methodology

Delegation Decoded (${BASE_URL}) organizes congressional accountability data
by state delegation. This file describes where every number comes from and
what the site's AI assistant can and cannot do.

## Sources and cadence

- Members, terms, committees: the @unitedstates project's legislator files,
  synced daily. Members absent from the upstream current-legislators file are
  retired automatically (deaths, resignations), including their term records.
- Bills and sponsorships: the Congress.gov API, synced daily.
- Roll-call votes: House Clerk XML and Senate XML, synced daily, stored as
  individual member positions.
- Campaign finance: the FEC API — candidate totals per cycle, principal
  committees, and top contributors aggregated by reported employer (FEC
  reporting categories such as RETIRED and SELF-EMPLOYED are excluded).
  Refreshed on a rolling stalest-first schedule.
- 2026 candidates: FEC Form 2 statutory filers, synced daily, cross-checked
  against sitting members so a departed filer is never presented as the
  officeholder. Where state election authorities publish verifiable ballots
  (including Indiana, Delaware, Florida, Rhode Island, Michigan, Nebraska,
  Washington), race pages carry state-verified labels; elsewhere candidates
  are labeled FEC-only.
- Stock trades (STOCK Act): Senate eFD tables are parsed deterministically
  and synced daily. House PTR parsing (PDF, model-assisted) is paused as of
  August 31, 2026 pending a rebuild; previously parsed House trades remain
  published with per-row confidence scores, and rows under 80% confidence
  are flagged in the interface rather than hidden.
- Official biographies and campaign sites: bounded crawlers snapshot pages
  privately and publish only verbatim quotes with links to their sources.
  The site never displays a model's paraphrase as fact.

Every ingest run is idempotent and logged; a public health page
(${BASE_URL}/health) renders per-source coverage and sync history from the
same checks that gate the project's CI.

## The assistant (/ask)

The assistant answers questions using a tool-calling loop over this site's
own database — never the open web and never model memory. Every claim in an
answer carries a citation linking to the record behind it. When the records
cannot answer, it says so instead of guessing. Requests are rate-limited,
input is screened for prompt-injection signatures, answers pass a moderation
check before serving, and every request is logged for audit with 90-day
retention. Answers disclose AI authorship and the absence of human review.

## Limitations

- Coverage begins with the current (119th) Congress; historical depth varies
  by source and is documented on ${BASE_URL}/about.
- Campaign-finance freshness varies by member because FEC refresh is
  budgeted; per-member coverage cards state what is and is not tracked.
- Filer errors exist in source data (for example future-dated trades) and
  are displayed with warnings rather than silently corrected.
- Press releases are not collected here; statements are archived at the
  companion project Capitol Releases (capitolreleases.com).

## Reuse

Bulk CSV endpoints are listed in ${BASE_URL}/llms.txt and on
${BASE_URL}/for-journalists. Data is drawn from public government records.
Cite as "Delegation Decoded (delegationdecoded.org)".
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
