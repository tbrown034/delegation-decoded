import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import type { SafeFetchResult } from "./safe-fetch";

function extensionFor(result: SafeFetchResult) {
  if (result.contentType === "application/json") return "json";
  if (result.contentType === "text/csv") return "csv";
  if (result.contentType === "application/tab-separated-values") return "tsv";
  if (
    result.contentType ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }
  return "bin";
}

export async function storeElectionSnapshot(
  sourceId: string,
  result: SafeFetchResult
) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required for durable election snapshots");
  const sha256 = createHash("sha256").update(result.body).digest("hex");
  const blob = await put(
    `elections/${sourceId}/${sha256}.${extensionFor(result)}`,
    result.body,
    {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: result.contentType,
      token,
    }
  );
  return {
    sha256,
    blobUrl: blob.url,
    originalUrl: result.finalUrl,
    contentType: result.contentType,
    contentLength: result.body.length,
    etag: result.etag,
    lastModified: result.lastModified,
  };
}
