import { NextRequest, NextResponse } from "next/server";
import { getSetPrices } from "@/lib/bricklink";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const setNo = req.nextUrl.searchParams.get("set")?.trim();
  if (!setNo || !/^\d{4,7}(-\d)?$/.test(setNo)) {
    return NextResponse.json({ error: "Invalid set number" }, { status: 400 });
  }
  try {
    const data = await getSetPrices(setNo);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "BrickLink fetch failed" }, { status: 502 });
  }
}
