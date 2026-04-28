// Cross-entity search across members, tickers, and states.
//
// Bills and committees aren't included because they don't have dedicated
// routes — they're only viewed in the context of a member or state.
//
// Uses plain ILIKE rather than pg_trgm so we don't have to introduce a schema
// migration; ranking is a CASE expression that prefers exact > prefix > sub.

import { db } from "./db";
import { sql } from "drizzle-orm";

export type SearchHit = {
  type: "member" | "ticker" | "state";
  href: string;
  title: string;
  subtitle: string;
  rank: number;
};

const MAX_PER_BUCKET = 8;
const TOTAL_LIMIT = 20;

export async function searchAll(query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const like = `%${q.toLowerCase()}%`;
  const exact = q.toLowerCase();
  const prefix = `${q.toLowerCase()}%`;

  const [memberRows, tickerRows, stateRows] = await Promise.all([
    db.execute(sql`
      SELECT bioguide_id, full_name, party, state_code, district, chamber,
        CASE
          WHEN LOWER(full_name) = ${exact} THEN 100
          WHEN LOWER(last_name) = ${exact} THEN 95
          WHEN LOWER(full_name) LIKE ${prefix} THEN 80
          WHEN LOWER(last_name) LIKE ${prefix} THEN 75
          ELSE 50
        END AS rank
      FROM members
      WHERE in_office = true
        AND (LOWER(full_name) LIKE ${like} OR LOWER(last_name) LIKE ${like})
      ORDER BY rank DESC, last_name ASC
      LIMIT ${MAX_PER_BUCKET}
    `),
    db.execute(sql`
      SELECT ticker, COUNT(*)::int AS n,
        MAX(asset_description) AS sample,
        CASE
          WHEN LOWER(ticker) = ${exact} THEN 100
          WHEN LOWER(ticker) LIKE ${prefix} THEN 80
          ELSE 50
        END AS rank
      FROM stock_transactions
      WHERE ticker IS NOT NULL AND LOWER(ticker) LIKE ${like}
      GROUP BY ticker
      ORDER BY rank DESC, n DESC
      LIMIT ${MAX_PER_BUCKET}
    `),
    db.execute(sql`
      SELECT code, name,
        CASE
          WHEN LOWER(code) = ${exact} THEN 100
          WHEN LOWER(name) = ${exact} THEN 95
          WHEN LOWER(name) LIKE ${prefix} THEN 80
          ELSE 50
        END AS rank
      FROM states
      WHERE LOWER(name) LIKE ${like} OR LOWER(code) LIKE ${like}
      ORDER BY rank DESC, name ASC
      LIMIT ${MAX_PER_BUCKET}
    `),
  ]);

  const hits: SearchHit[] = [];

  for (const r of memberRows.rows as Array<Record<string, unknown>>) {
    const districtSuffix = r.district ? `-${r.district}` : "";
    hits.push({
      type: "member",
      href: `/member/${r.bioguide_id}`,
      title: r.full_name as string,
      subtitle: `${r.party} · ${r.state_code}${districtSuffix} · ${r.chamber === "senate" ? "Senate" : "House"}`,
      rank: Number(r.rank),
    });
  }

  for (const r of tickerRows.rows as Array<Record<string, unknown>>) {
    const sample = r.sample ? ` · ${truncate(r.sample as string, 60)}` : "";
    hits.push({
      type: "ticker",
      href: `/trades/companies/${r.ticker}`,
      title: r.ticker as string,
      subtitle: `${r.n} disclosed trade${r.n === 1 ? "" : "s"}${sample}`,
      rank: Number(r.rank),
    });
  }

  for (const r of stateRows.rows as Array<Record<string, unknown>>) {
    hits.push({
      type: "state",
      href: `/state/${r.code}`,
      title: r.name as string,
      subtitle: `Delegation page · ${r.code}`,
      rank: Number(r.rank),
    });
  }

  return hits.sort((a, b) => b.rank - a.rank).slice(0, TOTAL_LIMIT);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}
