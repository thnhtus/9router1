import { NextResponse } from "next/server";
import { listJevLogs, getJevLog, clearJevLogs, jevFlows, jevStats, countJevLogs } from "@/lib/jevLogs.js";
import { getJevBreakerState } from "@/sse/services/systemoneRouter.js";

export const dynamic = "force-dynamic";

// GET ?id=N → one log with request/response; ?flows=1 → combo→model counts; ?stats=1[&hours=N] → health + hourly series + breaker; else list (?limit=, ?before=)
export async function GET(request) {
  try {
    const q = new URL(request.url).searchParams;
    const id = Number(q.get("id"));
    if (id) {
      const row = await getJevLog(id);
      return row ? NextResponse.json(row) : NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (q.get("stats")) {
      const hours = Math.min(Math.max(Number(q.get("hours")) || 1, 1), 24 * 30);
      return NextResponse.json({ stats: await jevStats(hours), breaker: getJevBreakerState() });
    }
    if (q.get("flows")) return NextResponse.json({ flows: await jevFlows() });
    const limit = Math.min(Math.max(Number(q.get("limit")) || 100, 1), 500);
    const page = Number(q.get("page")) || undefined;
    const before = Number(q.get("before")) || undefined;
    if (page) {
      const [logs, total] = await Promise.all([listJevLogs({ limit, page }), countJevLogs()]);
      return NextResponse.json({ logs, total, page, limit });
    }
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
