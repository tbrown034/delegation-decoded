import { NextRequest, NextResponse } from "next/server";
import { searchAll } from "@/lib/search";
import { checkIpLimit } from "@/lib/ask-limits";
import { clientIp } from "@/lib/request-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2 || q.length > 100) {
    return NextResponse.json({ hits: [] });
  }
  const rate = await checkIpLimit(clientIp(req), "search");
  if (!rate.allowed) {
    return NextResponse.json(
      { hits: [], error: rate.reason },
      {
        status: 429,
        headers: rate.retryAfterSeconds
          ? { "Retry-After": String(rate.retryAfterSeconds) }
          : undefined,
      }
    );
  }
  const hits = await searchAll(q);
  return NextResponse.json(
    { hits },
    {
      headers: { "Cache-Control": "private, max-age=30" },
    }
  );
}
