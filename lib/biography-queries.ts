import { sql } from "drizzle-orm";
import { db } from "./db";
import { dedupeByQuote } from "./quote-dedupe";
import type { BiographyFactType } from "./biography-classify";

function isMissingBiographySchema(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const record = current as { code?: string; cause?: unknown };
    if (record.code === "42P01") return true;
    current = record.cause;
  }
  return false;
}

export type PublishedMemberBiography = {
  bioguideId: string;
  siteUrl: string;
  biographyUrl: string | null;
  verifiedSourceUrl: string;
  cmsFamily: string | null;
  facts: Array<{
    claimId: string;
    // The model's paraphrase. Retained for search and debugging; never
    // displayed and never sent to Ask. Published text is sourceQuote.
    claimText: string;
    sourceUrl: string;
    sourceQuote: string;
    factType: BiographyFactType | null;
  }>;
};

export type MemberBiographyHealth = {
  verifiedSites: number;
  crawlErrors: number;
  // Publication is automatic: any fact whose verbatim quote survived the
  // snapshot check and was not rejected is live. Human review is a spot-check
  // and rejection path, not a gate, so these counters report both truths.
  membersPublished: number;
  publishedFacts: number;
  reviewedFacts: number;
  rejectedFacts: number;
};

export async function getPublishedMemberBiography(
  bioguideId: string
): Promise<PublishedMemberBiography | null> {
  if (!/^[A-Z][0-9]{6}$/.test(bioguideId)) return null;
  // Human review was retired: provenance is the verbatim quote plus its
  // source link, so everything not explicitly rejected is publishable.
  const reviewFilter = sql`review_status <> 'rejected'`;
  try {
    const [siteResult, claimResult] = await Promise.all([
      db.execute(sql`
        SELECT bioguide_id, site_url, biography_url, verified_source_url, cms_family
        FROM member_official_sites
        WHERE bioguide_id = ${bioguideId}
          AND verification_status = 'verified'
        LIMIT 1
      `),
      // Identity is the verbatim source span, not the model's sentence. Two
      // crawls of an unchanged page quote the same words and collapse here;
      // paraphrases differ every run and never deduplicated.
      db.execute(sql`
        SELECT DISTINCT ON (LOWER(BTRIM(REGEXP_REPLACE(source_quote, '[[:space:]]+', ' ', 'g'), ' .,;:')))
               claim_id, claim_text, source_url, source_quote, fact_type, extracted_at
        FROM member_biography_claims
        WHERE bioguide_id = ${bioguideId}
          AND ${reviewFilter}
          AND source_quote IS NOT NULL
          AND BTRIM(source_quote) <> ''
        ORDER BY LOWER(BTRIM(REGEXP_REPLACE(source_quote, '[[:space:]]+', ' ', 'g'), ' .,;:')),
                 extracted_at DESC
      `),
    ]);
    const site = siteResult.rows[0] as Record<string, unknown> | undefined;
    if (!site) return null;
    return {
      bioguideId: site.bioguide_id as string,
      siteUrl: site.site_url as string,
      biographyUrl: (site.biography_url as string | null) ?? null,
      verifiedSourceUrl: site.verified_source_url as string,
      cmsFamily: (site.cms_family as string | null) ?? null,
      // SQL collapsed identical quotes; this collapses overlapping ones, where
      // a later crawl quoted a longer span of the same sentence.
      facts: dedupeByQuote(
        (claimResult.rows as Array<Record<string, unknown>>).map((row) => ({
          claimId: row.claim_id as string,
          claimText: row.claim_text as string,
          sourceUrl: row.source_url as string,
          sourceQuote: row.source_quote as string,
          factType: (row.fact_type as BiographyFactType | null) ?? null,
        })),
        (fact) => fact.sourceQuote
      ),
    };
  } catch (error) {
    if (!isMissingBiographySchema(error)) throw error;
    return null;
  }
}

export async function getMemberBiographyHealth(): Promise<MemberBiographyHealth> {
  try {
    const result = await db.execute(sql`
      WITH eligible AS (
        SELECT claim.bioguide_id
        FROM member_biography_claims claim
        JOIN member_official_sites site ON site.bioguide_id = claim.bioguide_id
        WHERE site.verification_status = 'verified'
          AND claim.review_status <> 'rejected'
          AND BTRIM(claim.source_quote) <> ''
      )
      SELECT
        -- "Published" means what the member page query would actually show:
        -- a non-rejected quote on a verified official site.
        (SELECT COUNT(DISTINCT bioguide_id)::int FROM eligible) AS members_published,
        (SELECT COUNT(*)::int FROM eligible) AS published_facts,
        (SELECT COUNT(*)::int FROM member_official_sites WHERE verification_status = 'verified') AS verified_sites,
        (SELECT COUNT(*)::int FROM member_official_sites WHERE crawl_error IS NOT NULL) AS crawl_errors,
        (SELECT COUNT(*)::int FROM member_biography_claims WHERE review_status = 'verified') AS reviewed_facts,
        (SELECT COUNT(*)::int FROM member_biography_claims WHERE review_status = 'rejected') AS rejected_facts
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return {
      verifiedSites: Number(row?.verified_sites ?? 0),
      crawlErrors: Number(row?.crawl_errors ?? 0),
      membersPublished: Number(row?.members_published ?? 0),
      publishedFacts: Number(row?.published_facts ?? 0),
      reviewedFacts: Number(row?.reviewed_facts ?? 0),
      rejectedFacts: Number(row?.rejected_facts ?? 0),
    };
  } catch (error) {
    if (!isMissingBiographySchema(error)) throw error;
    return {
      verifiedSites: 0,
      crawlErrors: 0,
      membersPublished: 0,
      publishedFacts: 0,
      reviewedFacts: 0,
      rejectedFacts: 0,
    };
  }
}
