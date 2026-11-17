// Cross-harness capture: harnesses that don't route their model calls through
// 9router (or that want tool/file activity recorded) POST one turn here. The turn
// is stored as a requestDetails row so evaluateSession() can score it unchanged.
//
// Auth: lives under /api/v1 so dashboardGuard requires a 9router API key.
// ponytail: one row per turn, no OTel event model; ceiling = no approvals/token
// accounting; upgrade = a real event table when a harness needs replay.

import { NextResponse } from "next/server";
import { saveRequestDetail } from "@/lib/db/repos/requestDetailsRepo.js";
import { redact } from "@/lib/memory/evaluate.js";

export const dynamic = "force-dynamic";

const MAX_TEXT = 8000;
const MAX_TOOLS = 50;
function str(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return JSON.stringify(v);
}
const clip = (v, n = MAX_TEXT) => redact(str(v)).slice(0, n);

export function buildTurnDetail({ sessionId, harness, model, prompt, response, tools, status, timestamp }) {
  const list = (Array.isArray(tools) ? tools : []).slice(0, MAX_TOOLS);
  const toolLines = list
    .map((t) => `- ${clip(t?.name, 120) || "tool"}(${clip(t?.input, 400)}) -> ${clip(t?.output, 400)}`)
    .join("\n");
  return {
    provider: `harness:${clip(harness, 40) || "unknown"}`,
    model: clip(model, 120) || "harness-turn",
    sessionId,
    status: status === "error" ? "error" : "success",
    timestamp: timestamp || new Date().toISOString(),
    request: { messages: [{ role: "user", content: clip(prompt) }] },
    response: { content: [clip(response), toolLines && `Tools used:\n${toolLines}`].filter(Boolean).join("\n\n") },
  };
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { body = null; }
  const sessionId = body?.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (!body?.prompt && !body?.response && !Array.isArray(body?.tools)) {
    return NextResponse.json({ error: "prompt, response or tools is required" }, { status: 400 });
  }
  try {
    const detail = buildTurnDetail({ ...body, sessionId: sessionId.trim().slice(0, 200) });
    await saveRequestDetail(detail);
    return NextResponse.json({ ok: true, sessionId: detail.sessionId, id: detail.id ?? null });
  } catch (error) {
    console.error("Error ingesting harness turn:", error);
    return NextResponse.json({ error: "Failed to ingest turn" }, { status: 500 });
  }
}
