import { sql } from "drizzle-orm";
import { db } from "./db";

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
    claimText: string;
    sourceUrl: string;
    sourceQuote: string;
  }>;
};

export type MemberBiographyHealth = {
  verifiedSites: number;
  crawlErrors: number;
  membersWithVerifiedFacts: number;
  pendingFacts: number;
  verifiedFacts: number;
};

export async function getPublishedMemberBiography(
  bioguideId: string
): Promise<PublishedMemberBiography | null> {
  if (!/^[A-Z][0-9]{6}$/.test(bioguideId)) return null;
  try {
    const [siteResult, claimResult] = await Promise.all([
      db.execute(sql`
        SELECT bioguide_id, site_url, biography_url, verified_source_url, cms_family
        FROM member_official_sites
        WHERE bioguide_id = ${bioguideId}
          AND verification_status = 'verified'
        LIMIT 1
      `),
      db.execute(sql`
        SELECT DISTINCT ON (LOWER(claim_text))
               claim_id, claim_text, source_url, source_quote, extracted_at
        FROM member_biography_claims
        WHERE bioguide_id = ${bioguideId}
          AND review_status = 'verified'
        ORDER BY LOWER(claim_text), extracted_at DESC
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
      facts: (claimResult.rows as Array<Record<string, unknown>>).map((row) => ({
        claimId: row.claim_id as string,
        claimText: row.claim_text as string,
        sourceUrl: row.source_url as string,
        sourceQuote: row.source_quote as string,
      })),
    };
  } catch (error) {
    if (!isMissingBiographySchema(error)) throw error;
    return null;
  }
}

export async function getMemberBiographyHealth(): Promise<MemberBiographyHealth> {
  try {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM member_official_sites WHERE verification_status = 'verified') AS verified_sites,
        (SELECT COUNT(*)::int FROM member_official_sites WHERE crawl_error IS NOT NULL) AS crawl_errors,
        (SELECT COUNT(DISTINCT bioguide_id)::int FROM member_biography_claims WHERE review_status = 'verified') AS members_with_verified_facts,
        (SELECT COUNT(*)::int FROM member_biography_claims WHERE review_status = 'needs_review') AS pending_facts,
        (SELECT COUNT(*)::int FROM member_biography_claims WHERE review_status = 'verified') AS verified_facts
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return {
      verifiedSites: Number(row?.verified_sites ?? 0),
      crawlErrors: Number(row?.crawl_errors ?? 0),
      membersWithVerifiedFacts: Number(row?.members_with_verified_facts ?? 0),
      pendingFacts: Number(row?.pending_facts ?? 0),
      verifiedFacts: Number(row?.verified_facts ?? 0),
    };
  } catch (error) {
    if (!isMissingBiographySchema(error)) throw error;
    return {
      verifiedSites: 0,
      crawlErrors: 0,
      membersWithVerifiedFacts: 0,
      pendingFacts: 0,
      verifiedFacts: 0,
    };
  }
}
