// Cross-entity search across members, states, bills, and committees.
//
// Uses plain ILIKE rather than pg_trgm so we don't have to introduce a schema
// migration; ranking is a CASE expression that prefers exact > prefix > sub.

import { db } from "./db";
import { sql } from "drizzle-orm";

export type SearchHit = {
  type: "member" | "state" | "bill" | "committee";
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

  const [memberRows, stateRows, billRows, committeeRows] = await Promise.all([
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
    db.execute(sql`
      SELECT bill_id, bill_type, bill_number, congress, title,
        CASE
          WHEN LOWER(bill_id) = ${exact} THEN 100
          WHEN LOWER(REPLACE(bill_id, '-', '')) = ${exact} THEN 95
          WHEN LOWER(bill_id) LIKE ${prefix} THEN 80
          WHEN LOWER(title) LIKE ${prefix} THEN 60
          ELSE 40
        END AS rank
      FROM bills
      WHERE LOWER(bill_id) LIKE ${like} OR LOWER(title) LIKE ${like}
      ORDER BY rank DESC, introduced_date DESC NULLS LAST
      LIMIT ${MAX_PER_BUCKET}
    `),
    db.execute(sql`
      SELECT committee_id, name, chamber,
        CASE
          WHEN LOWER(name) = ${exact} THEN 100
          WHEN LOWER(name) LIKE ${prefix} THEN 70
          ELSE 40
        END AS rank
      FROM committees
      WHERE LOWER(name) LIKE ${like}
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

  for (const r of stateRows.rows as Array<Record<string, unknown>>) {
    hits.push({
      type: "state",
      href: `/state/${r.code}`,
      title: r.name as string,
      subtitle: `Delegation page · ${r.code}`,
      rank: Number(r.rank),
    });
  }

  for (const r of billRows.rows as Array<Record<string, unknown>>) {
    const label = `${(r.bill_type as string).toUpperCase()} ${r.bill_number}`;
    hits.push({
      type: "bill",
      href: `/bill/${r.bill_id}`,
      title: label,
      subtitle: `${truncate((r.title as string) ?? "", 70)} · ${r.congress}th Congress`,
      rank: Number(r.rank),
    });
  }

  for (const r of committeeRows.rows as Array<Record<string, unknown>>) {
    const chamberLabel =
      r.chamber === "senate"
        ? "Senate committee"
        : r.chamber === "house"
          ? "House committee"
          : "Joint committee";
    hits.push({
      type: "committee",
      href: `/committee/${r.committee_id}`,
      title: r.name as string,
      subtitle: chamberLabel,
      rank: Number(r.rank),
    });
  }

  return hits.sort((a, b) => b.rank - a.rank).slice(0, TOTAL_LIMIT);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}
