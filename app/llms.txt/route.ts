import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

// Curated map for AI crawlers and assistants. Counts come from the database
// so the file never drifts from what the site actually holds.
export const revalidate = 86400;

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://delegationdecoded.org";

export async function GET() {
  const [row] = (
    (await db.execute(sql`
      SELECT
        (SELECT count(*) FROM members WHERE in_office) AS members,
        (SELECT count(*) FROM bills)                    AS bills,
        (SELECT count(*) FROM vote_positions)           AS vote_positions,
        (SELECT count(*) FROM campaign_finance)         AS finance_rows,
        (SELECT count(*) FROM election_candidates)      AS candidates
    `)) as unknown as {
      rows: {
        members: string;
        bills: string;
        vote_positions: string;
        finance_rows: string;
        candidates: string;
      }[];
    }
  ).rows;

  const body = `# Delegation Decoded

> A state-by-state guide to Congress and the 2026 midterms, built from seven
> official government sources: Congress.gov, House and Senate roll-call XML,
> the FEC, the @unitedstates project, Senate financial disclosures, and state
> election authorities. Every number on the site traces to an official record.
> The built-in assistant (/ask) answers only from this database — never the
> open web — and requires a retrieved-record citation for factual answers.

Currently tracking ${row.members} sitting members across all 50 states, DC,
and the territories: ${row.bills} bills, ${row.vote_positions} individual
vote positions, ${row.finance_rows} campaign-finance summaries, and
${row.candidates} FEC-registered 2026 candidates.

## Core pages

- [About & methodology](${BASE_URL}/about): sources, update cadence, limitations, and AI transparency.
- [For journalists](${BASE_URL}/for-journalists): bulk CSV downloads, freshness notes, reporting tips.
- [2026 races](${BASE_URL}/races): every federal contest, with candidate fields verified against state election authorities where adapters exist and labeled FEC-only elsewhere.
- [Pipeline health](${BASE_URL}/health): live per-source coverage and sync history, rendered from the same checks that gate CI.
- [Ask](${BASE_URL}/ask): plain-language questions answered from the records, with citations.
- State dashboards at /state/{code} (e.g. ${BASE_URL}/state/IL) and member profiles at /member/{bioguideId}.

## Bulk data (CSV)

- [Members](${BASE_URL}/api/data/members.csv): every sitting member with party, chamber, state, district.
- [Votes](${BASE_URL}/api/data/votes.csv): every recorded roll-call position.
- [Campaign finance](${BASE_URL}/api/data/finance.csv): FEC candidate totals per cycle.
- [2026 candidates](${BASE_URL}/api/data/candidates.csv): statutory FEC filers per contest.
- [Races](${BASE_URL}/api/data/races.csv): contest-level summaries with verification status.
- [Trades](${BASE_URL}/api/data/trades.csv) and [filings](${BASE_URL}/api/data/filings.csv): STOCK Act data (preview quality; House parsing paused, Senate current).

## Attribution

Cite as "Delegation Decoded (delegationdecoded.org)". Statements and press
releases are archived at the companion project Capitol Releases
(capitolreleases.com). A longer plain-text methodology lives at
${BASE_URL}/llms-full.txt.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
