import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Called once at the end of the daily ingest. Clears the whole site's
// cache so readers see new data same-day instead of waiting out the
// 86400-second footer-driven revalidate window on every route.
export async function POST(req: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { revalidated: false, error: "REVALIDATE_SECRET not configured" },
      { status: 500 }
    );
  }
  const provided = req.headers.get("x-revalidate-secret");
  if (provided !== secret) {
    return NextResponse.json(
      { revalidated: false, error: "unauthorized" },
      { status: 401 }
    );
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ revalidated: true, now: Date.now() });
}
