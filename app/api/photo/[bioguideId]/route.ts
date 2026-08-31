import { NextRequest, NextResponse } from "next/server";
import { checkIpLimit } from "@/lib/ask-limits";
import { memberExists } from "@/lib/queries";
import { clientIp } from "@/lib/request-guards";

export const runtime = "nodejs";

const UNITEDSTATES_BASE =
  "https://raw.githubusercontent.com/unitedstates/images/gh-pages/congress/225x275";

const CACHE_HEADER =
  "public, max-age=604800, stale-while-revalidate=2592000";
const CACHE_404 = "public, max-age=86400"; // cache misses for 1 day

// No upstream here has an SLA; a hung one must not hold the function open.
const UPSTREAM_TIMEOUT_MS = 6000;
// A congressional headshot is tens of kilobytes. Anything near this ceiling is
// not the file we asked for.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function fetchImage(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "image/*" },
      next: { revalidate: 604800 },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok || !res.headers.get("content-type")?.includes("image")) {
      return null;
    }
    const declaredLength = Number(res.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      return null;
    }
    // Without a content-length we buffer anyway: every URL that reaches this
    // point is either a hard-coded host or one validated by isCongressGovUrl.
    return await res.arrayBuffer();
  } catch {
    // fall through
  }
  return null;
}

// Step 4 follows a URL out of a Congress.gov JSON payload. Bound it to that
// origin so a changed or tampered response cannot aim our fetch anywhere else.
function isCongressGovUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return (
    parsed.hostname === "congress.gov" || parsed.hostname.endsWith(".congress.gov")
  );
}

function imageResponse(body: ArrayBuffer) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": CACHE_HEADER,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bioguideId: string }> }
) {
  const { bioguideId } = await params;

  if (!bioguideId || !/^[A-Z]\d{6}$/i.test(bioguideId)) {
    return new NextResponse(null, { status: 400 });
  }

  const rate = await checkIpLimit(clientIp(request), "photo");
  if (!rate.allowed) {
    return new NextResponse(null, {
      status: 429,
      headers: rate.retryAfterSeconds
        ? { "Retry-After": String(rate.retryAfterSeconds) }
        : undefined,
    });
  }

  const id = bioguideId.toUpperCase();

  // An ID we never ingested has no photo at any upstream, so resolve it here
  // rather than spending four requests (and the Congress.gov key) to find out.
  if (!(await memberExists(id))) {
    return new NextResponse(null, {
      status: 404,
      headers: { "Cache-Control": CACHE_404 },
    });
  }

  // 1. Try @unitedstates (most reliable, fastest)
  const usImage = await fetchImage(`${UNITEDSTATES_BASE}/${id}.jpg`);
  if (usImage) return imageResponse(usImage);

  // 2. Try Congress.gov with bioguide ID pattern
  const cgImage = await fetchImage(
    `https://www.congress.gov/img/member/${id.toLowerCase()}_200.jpg`
  );
  if (cgImage) return imageResponse(cgImage);

  // 3. Try the Bioguide portrait archive (covers new members before the
  // unitedstates repo and Congress.gov catch up)
  const bgImage = await fetchImage(
    `https://bioguide.congress.gov/photo/${id}.jpg`
  );
  if (bgImage) return imageResponse(bgImage);

  // 4. Try Congress.gov API to get the actual image URL (for newer members)
  const apiKey = process.env.CONGRESS_API_KEY;
  if (apiKey) {
    try {
      const apiRes = await fetch(
        `https://api.congress.gov/v3/member/${id}?api_key=${apiKey}`,
        {
          next: { revalidate: 604800 },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        }
      );
      if (apiRes.ok) {
        const data = await apiRes.json();
        const imageUrl = data?.member?.depiction?.imageUrl;
        if (isCongressGovUrl(imageUrl)) {
          const apiImage = await fetchImage(imageUrl);
          if (apiImage) return imageResponse(apiImage);
        }
      }
    } catch {
      // fall through
    }
  }

  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": CACHE_404 },
  });
}
