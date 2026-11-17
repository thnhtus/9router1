// GET /api/memory/harness-turns/[sessionId] — individual captured turns for one
// harness session, so the Memory page can open a detail view.
import { NextResponse } from "next/server";
import { getHarnessSessionDetail } from "@/lib/db/repos/requestDetailsRepo.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { sessionId } = await params;
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    const limit = parseInt(new URL(request.url).searchParams.get("limit") || "50", 10);
    const turns = await getHarnessSessionDetail(sessionId, { limit: Number.isNaN(limit) ? 50 : limit });
    return NextResponse.json({ turns });
  } catch (error) {
    console.error("Error listing harness turns:", error);
    return NextResponse.json({ error: "Failed to list harness turns" }, { status: 500 });
  }
}
