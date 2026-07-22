import "./lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";
import { memberBiographyClaims } from "../lib/schema";

const APPLY = process.argv.includes("--apply");
const action = process.argv.find((argument) =>
  /^--(verify|reject)-claim=/.test(argument)
);
const reviewerArg = process.argv.find((argument) => argument.startsWith("--reviewer="));
const REVIEWER = (reviewerArg?.split("=", 2)[1] ?? process.env.RESEARCH_REVIEWER ?? "").trim();

function parseAction() {
  if (!action) return null;
  const match = /^--(verify|reject)-claim=(.+)$/.exec(action);
  if (!match) throw new Error("Invalid member-biography review action");
  return {
    status: match[1] === "verify" ? "verified" : "rejected",
    id: match[2],
  } as const;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const db = drizzle(neon(process.env.DATABASE_URL));
  const parsed = parseAction();
  if (!parsed) {
    const queue = await db.execute(sql`
      SELECT claim.claim_id AS id, m.full_name, claim.claim_text,
             claim.source_quote, claim.source_url, claim.confidence,
             claim.extractor_provider, claim.extractor_model, claim.extracted_at
      FROM member_biography_claims claim
      JOIN members m ON m.bioguide_id = claim.bioguide_id
      WHERE claim.review_status = 'needs_review'
      ORDER BY claim.extracted_at, m.full_name
      LIMIT 100
    `);
    if (queue.rows.length === 0) {
      console.log("No member biography facts are waiting for review.");
      return;
    }
    console.table(queue.rows);
    console.log(
      "Check the official source and exact quote, then use --verify-claim=ID --reviewer=NAME --apply or --reject-claim=ID --reviewer=NAME --apply."
    );
    return;
  }
  const row = await db.execute(sql`
    SELECT * FROM member_biography_claims WHERE claim_id = ${parsed.id} LIMIT 1
  `);
  if (row.rows.length === 0) throw new Error(`No member biography claim found for ${parsed.id}`);
  console.table(row.rows);
  if (!APPLY) {
    console.log(`Dry run: would set review_status=${parsed.status}. Add --reviewer=NAME --apply after checking the source.`);
    return;
  }
  if (REVIEWER.length < 2 || REVIEWER.length > 100) {
    throw new Error("--reviewer=NAME or RESEARCH_REVIEWER is required for an applied review");
  }
  await db
    .update(memberBiographyClaims)
    .set({
      reviewStatus: parsed.status,
      reviewedAt: new Date(),
      reviewedBy: REVIEWER,
    })
    .where(eq(memberBiographyClaims.claimId, parsed.id));
  console.log(`Member biography claim ${parsed.id} marked ${parsed.status} by ${REVIEWER}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Member biography review failed");
  process.exit(1);
});
