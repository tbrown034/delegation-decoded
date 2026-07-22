import "./lib/env";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";
import { candidatePriorService, candidateSiteClaims } from "../lib/schema";

const APPLY = process.argv.includes("--apply");
const action = process.argv.find((argument) =>
  /^--(verify|reject)-(claim|service)=/.test(argument)
);
const reviewerArg = process.argv.find((argument) => argument.startsWith("--reviewer="));
const REVIEWER = (reviewerArg?.split("=", 2)[1] ?? process.env.RESEARCH_REVIEWER ?? "").trim();

function parseAction() {
  if (!action) return null;
  const match = /^--(verify|reject)-(claim|service)=(.+)$/.exec(action);
  if (!match) throw new Error("Invalid review action");
  return {
    status: match[1] === "verify" ? "verified" : "rejected",
    kind: match[2] as "claim" | "service",
    id: match[3],
  } as const;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const db = drizzle(neon(process.env.DATABASE_URL));
  const parsed = parseAction();
  if (!parsed) {
    const queue = await db.execute(sql`
      SELECT 'claim' AS kind, claim.claim_id AS id, p.display_name,
             claim.claim_text AS record_text, claim.source_quote, claim.source_url,
             claim.confidence, claim.extractor_provider, claim.extractor_model,
             claim.extracted_at
      FROM candidate_site_claims claim
      JOIN candidacies ca ON ca.candidacy_id = claim.candidacy_id
      JOIN candidate_people p ON p.person_id = ca.person_id
      WHERE claim.review_status = 'needs_review'
      UNION ALL
      SELECT 'service' AS kind, service.service_id AS id, p.display_name,
             service.office_title AS record_text, service.source_quote, service.source_url,
             NULL::integer AS confidence, service.extractor_provider,
             service.extractor_model, service.extracted_at
      FROM candidate_prior_service service
      JOIN candidate_people p ON p.person_id = service.person_id
      WHERE service.verification_status = 'needs_review'
      ORDER BY extracted_at, display_name
      LIMIT 100
    `);
    if (queue.rows.length === 0) {
      console.log("No candidate research is waiting for review.");
      return;
    }
    console.table(queue.rows);
    console.log(
      "Review the live source and quoted evidence, then use an action with --reviewer=NAME --apply."
    );
    return;
  }

  const statusColumn = parsed.kind === "claim" ? "review_status" : "verification_status";
  const row = await db.execute(sql`
    SELECT * FROM ${sql.raw(parsed.kind === "claim" ? "candidate_site_claims" : "candidate_prior_service")}
    WHERE ${sql.raw(parsed.kind === "claim" ? "claim_id" : "service_id")} = ${parsed.id}
    LIMIT 1
  `);
  if (row.rows.length === 0) throw new Error(`No ${parsed.kind} found for ${parsed.id}`);
  console.table(row.rows);
  if (!APPLY) {
    console.log(`Dry run: would set ${statusColumn}=${parsed.status}. Add --reviewer=NAME --apply after checking the source.`);
    return;
  }
  if (REVIEWER.length < 2 || REVIEWER.length > 100) {
    throw new Error("--reviewer=NAME or RESEARCH_REVIEWER is required for an applied review");
  }
  const reviewMetadata = { reviewedAt: new Date(), reviewedBy: REVIEWER };
  if (parsed.kind === "claim") {
    await db
      .update(candidateSiteClaims)
      .set({ reviewStatus: parsed.status, ...reviewMetadata })
      .where(eq(candidateSiteClaims.claimId, parsed.id));
  } else {
    await db
      .update(candidatePriorService)
      .set({ verificationStatus: parsed.status, ...reviewMetadata })
      .where(eq(candidatePriorService.serviceId, parsed.id));
  }
  console.log(`${parsed.kind} ${parsed.id} marked ${parsed.status} by ${REVIEWER}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Candidate research review failed");
  process.exit(1);
});
