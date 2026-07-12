import { NextRequest, NextResponse } from "next/server";
import { getPartOutValue } from "@/lib/bricklink";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const setNo = req.nextUrl.searchParams.get("set")?.trim();
  const cond = req.nextUrl.searchParams.get("cond") === "N" ? "N" : "U";
  if (!setNo || !/^\d{4,7}(-\d)?$/.test(setNo)) {
    return NextResponse.json({ error: "Invalid set number" }, { status: 400 });
  }
  try {
    const data = await getPartOutValue(setNo, cond);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Part-out calc failed" }, { status: 502 });
  }
}
