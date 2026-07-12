import { NextRequest, NextResponse } from "next/server";
import { searchCarousell } from "@/lib/carousell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }
  try {
    const listings = await searchCarousell(q, 48);
    return NextResponse.json({ query: q, count: listings.length, listings });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Carousell fetch failed" }, { status: 502 });
  }
}
