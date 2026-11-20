// Hourly MCP tool-call counters (see mcpCallHourly in schema.js). Kept forever,
// small rows, so stats survive restarts. Fire-and-forget: stats must never break
// the response path.

import { getAdapter } from "../driver.js";

const hourOf = (ms = Date.now()) => new Date(Math.floor(ms / 3600000) * 3600000).toISOString();

/**
 * Persist the MCP calls collected from one response.
 * @param {Map<string, number>} calls keyed `"server\ntool"` → count
 */
export function bumpMcpCalls(calls) {
  if (!calls?.size) return;
  const hour = hourOf();
  const rows = [...calls.entries()].map(([k, n]) => {
    const [server, tool = ""] = k.split("\n");
    return [hour, server, tool, n];
  });
  getAdapter().then((a) => {
    a.transaction(() => {
      for (const [h, server, tool, n] of rows) {
        a.run(
          `INSERT INTO mcpCallHourly(hour, server, tool, calls) VALUES(?,?,?,?)
           ON CONFLICT(hour, server, tool) DO UPDATE SET calls = calls + excluded.calls`,
          [h, server, tool, n],
        );
      }
    });
  }).catch(() => { /* stats must not break requests */ });
}

/** Total calls per server over the last `hours` whole-hour buckets (current included). */
export async function mcpCallsByServer(hours = 24) {
  const a = await getAdapter();
  const h = Math.min(Math.max(Number(hours) || 24, 1), 24 * 90);
  const since = hourOf(Date.now() - (h - 1) * 3600000);
  const rows = a.all(
    `SELECT server, SUM(calls) AS calls FROM mcpCallHourly WHERE hour >= ? GROUP BY server`,
    [since],
  );
  return Object.fromEntries(rows.map((r) => [r.server, Number(r.calls) || 0]));
}
