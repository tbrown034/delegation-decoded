import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { stableBiographyId } from "../../lib/biography-research";
import type { CrawledCampaignPage } from "./candidate-site-crawler";

export async function storeMemberSiteSnapshot(
  bioguideId: string,
  page: CrawledCampaignPage
) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required for member-site snapshots");
  const contentSha256 = createHash("sha256").update(page.result.body).digest("hex");
  const snapshotId = stableBiographyId(
    "member-site",
    bioguideId,
    page.url,
    contentSha256
  );
  const blob = await put(
    `member-sites/${bioguideId}/${snapshotId}.html`,
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
    bioguideId,
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
