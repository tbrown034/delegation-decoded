import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { stableResearchId } from "../../lib/elections/campaign-research";
import type { CrawledCampaignPage } from "./candidate-site-crawler";

export async function storeCandidateSiteSnapshot(
  candidacyId: string,
  page: CrawledCampaignPage
) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required for campaign snapshots");
  const contentSha256 = createHash("sha256").update(page.result.body).digest("hex");
  const snapshotId = stableResearchId("site", candidacyId, page.url, contentSha256);
  const blob = await put(
    `candidate-sites/${candidacyId}/${snapshotId}.html`,
    page.result.body,
    {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: page.result.contentType,
      token,
    }
  );
  return {
    snapshotId,
    candidacyId,
    pageUrl: page.url,
    finalUrl: page.result.finalUrl,
    contentSha256,
    blobUrl: blob.url,
    contentType: page.result.contentType,
    contentLength: page.result.body.length,
    etag: page.result.etag,
    lastModified: page.result.lastModified,
  };
}
