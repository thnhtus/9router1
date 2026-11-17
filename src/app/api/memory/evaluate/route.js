import { NextResponse } from "next/server";
import { evaluateSession } from "@/lib/memory/evaluate.js";

export const dynamic = "force-dynamic";

const OWNER_TYPES = ["user", "agent", "team", "project"];

// Gate (memoryEvalEnabled) is enforced inside evaluateSession: dryRun always scores,
// writing a candidate needs the setting on or force=true.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { sessionId, ownerType = "agent", ownerId, model, dryRun = false, force = false } = body || {};
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    if (!OWNER_TYPES.includes(ownerType)) {
      return NextResponse.json({ error: "Invalid ownerType" }, { status: 400 });
    }
    const result = await evaluateSession({ sessionId, ownerType, ownerId, model, dryRun: dryRun === true, force: force === true });
    if (result.error) return NextResponse.json(result, { status: 502 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error running memory evaluation:", error);
    return NextResponse.json({ error: "Failed to run memory evaluation" }, { status: 500 });
  }
}
