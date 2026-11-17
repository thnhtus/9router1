// GET /api/memory/harness-turns — sessions captured through /api/v1/memory/ingest,
// grouped per session so the Memory page can offer a manual Jev evaluation.
import { NextResponse } from "next/server";
import { listHarnessSessions } from "@/lib/db/repos/requestDetailsRepo.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const limit = parseInt(new URL(request.url).searchParams.get("limit") || "50", 10);
    const sessions = await listHarnessSessions({ limit: Number.isNaN(limit) ? 50 : limit });
    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Error listing harness sessions:", error);
    return NextResponse.json({ error: "Failed to list harness sessions" }, { status: 500 });
  }
}
