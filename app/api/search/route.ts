import { NextRequest, NextResponse } from "next/server";
import { searchAll } from "@/lib/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return NextResponse.json({ hits: [] });
  }
  const hits = await searchAll(q);
  return NextResponse.json(
    { hits },
    {
      headers: { "Cache-Control": "private, max-age=30" },
    }
  );
}
