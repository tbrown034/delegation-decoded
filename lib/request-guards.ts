import { NextRequest } from "next/server";

// Browser-facing POST guards shared by /api/ask and /api/ask/locate.
// These endpoints are same-origin only: no third-party page should be able
// to spend our model budget or farm the geocoder with drive-by fetches.

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

// Returns an error Response for cross-site or non-JSON requests, null if OK.
export function rejectCrossSite(request: NextRequest): Response | null {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return Response.json(
      { error: "Requests must be application/json." },
      { status: 415 }
    );
  }

  // Modern browsers stamp fetch metadata; "cross-site" is a definitive no.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  }

  // Fallback for anything that sends Origin without fetch metadata.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return Response.json(
          { error: "Cross-site requests are not allowed." },
          { status: 403 }
        );
      }
    } catch {
      return Response.json({ error: "Invalid origin." }, { status: 403 });
    }
  }

  return null;
}

export async function readLimitedJson(
  request: NextRequest,
  maxBytes: number
): Promise<
  | { ok: true; body: unknown }
  | { ok: false; reason: "invalid" | "too_large" }
> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
