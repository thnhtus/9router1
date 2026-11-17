// Cross-harness capture for 9router agent memory.
//
// Pi's tool calls never touch 9router, so the router only ever sees prompts and
// responses. This extension POSTs each finished turn (prompt + assistant reply +
// tool names/args/results) to /api/v1/memory/ingest, where it is stored as a
// requestDetails row and scored by the existing Jev session evaluator.
//
// Install: copy or symlink into ~/.pi/agent/extensions/
//   ln -s "$PWD/extensions/pi/memory-ingest.ts" ~/.pi/agent/extensions/9r-memory-ingest.ts
// Config: NINEROUTER_URL (default http://127.0.0.1:20128). NINEROUTER_API_KEY is only
// needed when 9router is not on loopback; a local router accepts the request without it.
//
// ponytail: fire-and-forget POST per turn, no retry or disk queue.
// Ceiling: turns are lost while 9router is down. Upgrade: buffer to a file and
// flush on session_start when a dropped turn actually matters.

// No type import: pi resolves @earendil-works/pi-coding-agent at load time; the repo doesn't install it.
const BASE = (process.env.NINEROUTER_URL || "http://127.0.0.1:20128").replace(/\/$/, "");
  const INGEST = `${BASE}/v1/memory/ingest`;
const KEY = process.env.NINEROUTER_API_KEY || "";
const MAX_TOOLS = 50;

const text = (v: unknown, n = 2000): string => {
  if (typeof v === "string") return v.slice(0, n);
  if (v == null) return "";
  try { return JSON.stringify(v).slice(0, n); } catch { return ""; }
};

// Pi messages carry content as a string or as typed parts; keep only the text.
function messageText(message: any): string {
  const c = message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p: any) => p?.text ?? "").filter(Boolean).join("\n");
  return "";
}

export default function memoryIngest(pi: any) {
  pi.on("turn_end", async (event: any, ctx: any) => {
    const sessionId = ctx?.sessionManager?.getSessionId?.();
    if (!sessionId) return;

    const tools = (event.toolResults ?? []).slice(0, MAX_TOOLS).map((r: any) => ({
      name: r?.toolName ?? r?.name ?? "tool",
      input: text(r?.args ?? r?.input, 500),
      output: text(r?.content ?? r?.result ?? r?.output, 500),
    }));

    // The last user message on the branch is this turn's prompt.
    const branch = ctx?.sessionManager?.buildContextEntries?.() ?? [];
    const lastUser = [...branch].reverse().find((e: any) => e?.message?.role === "user");

    const body = {
      sessionId,
      harness: "pi",
      model: event?.message?.model ?? "",
      prompt: messageText(lastUser?.message),
      response: messageText(event?.message),
      tools,
      status: event?.outcome === "completed" ? "success" : "error",
    };
    if (!body.prompt && !body.response && tools.length === 0) return;

    try {
      await fetch(INGEST, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // telemetry is never worth failing a turn
    }
  });
}
