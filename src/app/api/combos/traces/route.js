import { NextResponse } from "next/server";
import { listComboTraces } from "open-sse/services/comboTrace.js";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ runs: listComboTraces(), now: Date.now() });
}
