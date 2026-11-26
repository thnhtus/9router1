import { NextResponse } from "next/server";
import { promptInstructionStats } from "@/lib/db/repos/promptInstructionRepo.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const hours = Math.min(Math.max(Number(new URL(request.url).searchParams.get("hours")) || 168, 1), 24 * 90);
    const counts = await promptInstructionStats(hours);
    return NextResponse.json({ hours, counts });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}