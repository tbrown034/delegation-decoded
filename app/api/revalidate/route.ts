import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { secretMatches } from "@/lib/secure-compare";

export const runtime = "nodejs";

// Called once at the end of the daily ingest. Clears the whole site's
// cache so readers see new data same-day instead of waiting out the
// 86400-second footer-driven revalidate window on every route.
//
// An unconfigured or wrong secret answers 404, the same way proxy.ts's
// /admin gate does, rather than a 401/500 that would confirm to an
// anonymous caller that this route exists and is unconfigured. The detail
// is logged server-side instead.
export async function POST(req: NextRequest) {
  const expected = process.env.REVALIDATE_SECRET;
  const provided = req.headers.get("x-revalidate-secret");
  if (!(await secretMatches(provided, expected))) {
    if (!expected) console.error("/api/revalidate: REVALIDATE_SECRET is not configured");
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ revalidated: true, now: Date.now() });
}
