import { NextResponse } from "next/server";
import { JEV_PROMPTS } from "@/sse/services/systemoneRouter.js";

export const dynamic = "force-dynamic";

// GET /api/jev/prompt → the Jev question instructions shown on the Jev Router page.
export async function GET() {
  return NextResponse.json(JEV_PROMPTS);
}
