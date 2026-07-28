import "./lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import {
  BIOGRAPHY_FACT_TYPES,
  classifyBiographyFact,
} from "../lib/biography-classify";

// Assigns fact_type to stored biography facts. Read-only by default so the
// classification can be reviewed before it lands; pass --apply to write.
//
// Classification runs on text already in the database, so it never crawls,
// never calls a model, and can be re-run safely after the rules change.

const APPLY = process.argv.includes("--apply");
const RECLASSIFY = process.argv.includes("--reclassify");

type Row = {
  claim_id: string;
  bioguide_id: string;
  claim_text: string;
  source_quote: string;
  fact_type: string | null;
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const db = drizzle(neon(process.env.DATABASE_URL));

  const scope = RECLASSIFY
    ? sql``
    : sql`AND fact_type IS NULL`;
  const result = await db.execute(sql`
    SELECT claim_id, bioguide_id, claim_text, source_quote, fact_type
    FROM member_biography_claims
    WHERE review_status <> 'rejected'
      ${scope}
  `);
  const rows = result.rows as Row[];
  if (rows.length === 0) {
    console.log("No biography facts require classification.");
    return;
  }

  const counts = new Map<string, number>();
  const updates: Array<{ claimId: string; type: string }> = [];
  const samples = new Map<string, string>();
  for (const row of rows) {
    const classified = classifyBiographyFact(row.source_quote, row.claim_text);
    const key = classified.type ?? "(unclassified)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!samples.has(key)) samples.set(key, row.source_quote.slice(0, 110));
    if (classified.type) {
      updates.push({ claimId: row.claim_id, type: classified.type });
    }
  }

  console.log(`Classified ${rows.length} facts:`);
  for (const type of [...BIOGRAPHY_FACT_TYPES, "(unclassified)"]) {
    const n = counts.get(type) ?? 0;
    if (n === 0) continue;
    const pct = ((n / rows.length) * 100).toFixed(1);
    console.log(`  ${type.padEnd(16)} ${String(n).padStart(5)}  ${pct.padStart(5)}%  e.g. "${samples.get(type) ?? ""}"`);
  }

  if (!APPLY) {
    console.log(`\nRead-only. Re-run with --apply to write ${updates.length} classifications.`);
    return;
  }

  // Batched so a few thousand rows do not become a few thousand round trips.
  const BATCH = 200;
  let written = 0;
  for (let index = 0; index < updates.length; index += BATCH) {
    const batch = updates.slice(index, index + BATCH);
    const ids = sql.join(batch.map((item) => sql`${item.claimId}`), sql`, `);
    const cases = sql.join(
      batch.map((item) => sql`WHEN ${item.claimId} THEN ${item.type}`),
      sql` `
    );
    await db.execute(sql`
      UPDATE member_biography_claims
      SET fact_type = CASE claim_id ${cases} END,
          fact_type_source = 'rules'
      WHERE claim_id IN (${ids})
    `);
    written += batch.length;
  }
  console.log(`\nApplied ${written} classifications.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
