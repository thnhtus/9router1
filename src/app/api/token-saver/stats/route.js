import { NextResponse } from "next/server";
import { tokenSaverStats } from "@/lib/db/repos/tokenSaverRepo.js";

export const dynamic = "force-dynamic";

// GET ?hours=N (1..720, default 168) → summary, per-Jev-level breakdown, daily timeline.
export async function GET(request) {
  try {
    const hours = Math.min(Math.max(Number(new URL(request.url).searchParams.get("hours")) || 168, 1), 720);
    return NextResponse.json(await tokenSaverStats(hours));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
