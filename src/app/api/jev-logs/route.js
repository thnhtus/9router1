import { NextResponse } from "next/server";
import { listJevLogs, getJevLog, clearJevLogs } from "@/lib/jevLogs.js";

export const dynamic = "force-dynamic";

// GET ?id=N → one log with request/response; else list (?limit=, ?before=)
export async function GET(request) {
  try {
    const q = new URL(request.url).searchParams;
    const id = Number(q.get("id"));
    if (id) {
      const row = await getJevLog(id);
      return row ? NextResponse.json(row) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const limit = Math.min(Math.max(Number(q.get("limit")) || 100, 1), 500);
    const before = Number(q.get("before")) || undefined;
    return NextResponse.json({ logs: await listJevLogs({ limit, before }) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await clearJevLogs();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
