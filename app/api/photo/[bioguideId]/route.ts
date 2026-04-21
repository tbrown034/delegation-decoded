import { NextRequest, NextResponse } from "next/server";

const UNITEDSTATES_BASE =
  "https://raw.githubusercontent.com/unitedstates/images/gh-pages/congress/225x275";

const CACHE_HEADER =
  "public, max-age=604800, stale-while-revalidate=2592000";
const CACHE_404 = "public, max-age=86400"; // cache misses for 1 day

async function fetchImage(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "image/*" } });
    if (res.ok && res.headers.get("content-type")?.includes("image")) {
      return res.arrayBuffer();
    }
  } catch {
    // fall through
  }
  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ bioguideId: string }> }
) {
  const { bioguideId } = await params;

  if (!bioguideId || !/^[A-Z]\d{6}$/i.test(bioguideId)) {
    return new NextResponse(null, { status: 400 });
  }

  const id = bioguideId.toUpperCase();

  // 1. Try @unitedstates (most reliable, fastest)
  const usImage = await fetchImage(`${UNITEDSTATES_BASE}/${id}.jpg`);
  if (usImage) {
    return new NextResponse(usImage, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": CACHE_HEADER,
      },
    });
  }

  // 2. Try Congress.gov with bioguide ID pattern
  const cgImage = await fetchImage(
    `https://www.congress.gov/img/member/${id.toLowerCase()}_200.jpg`
  );
  if (cgImage) {
    return new NextResponse(cgImage, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": CACHE_HEADER,
      },
    });
  }

  // 3. Try Congress.gov API to get the actual image URL (for newer members)
  const apiKey = process.env.CONGRESS_API_KEY;
  if (apiKey) {
    try {
      const apiRes = await fetch(
        `https://api.congress.gov/v3/member/${id}?api_key=${apiKey}`
      );
      if (apiRes.ok) {
        const data = await apiRes.json();
        const imageUrl = data?.member?.depiction?.imageUrl;
        if (imageUrl) {
          const apiImage = await fetchImage(imageUrl);
          if (apiImage) {
            return new NextResponse(apiImage, {
              headers: {
                "Content-Type": "image/jpeg",
                "Cache-Control": CACHE_HEADER,
              },
            });
          }
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
