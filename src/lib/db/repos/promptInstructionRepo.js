// Hourly per-instruction attribution counters (see promptInstructionHourly in
// schema.js). Kept forever, small rows, so stats survive restarts. Fire-and-
// forget: stats must never break the request path.

import { getAdapter } from "../driver.js";

const hourOf = (ms = Date.now()) => new Date(Math.floor(ms / 3600000) * 3600000).toISOString();

/**
 * Attribute one request to each named prompt instruction that was injected.
 * @param {string[]} ids matched instruction ids
 */
export function bumpPromptInstructions(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const hour = hourOf();
  getAdapter().then((a) => {
    a.transaction(() => {
      for (const id of ids) {
        a.run(
          `INSERT INTO promptInstructionHourly(hour, instructionId, total) VALUES(?,?,1)
           ON CONFLICT(hour, instructionId) DO UPDATE SET total = total + 1`,
          [hour, String(id)],
        );
      }
    });
  }).catch(() => { /* stats must not break requests */ });
}

/** Requests per instruction over the last `hours` whole-hour buckets (current included). */
export async function promptInstructionStats(hours = 24) {
  const a = await getAdapter();
  const h = Math.min(Math.max(Number(hours) || 24, 1), 24 * 90);
  const since = hourOf(Date.now() - (h - 1) * 3600000);
  const rows = a.all(
    `SELECT instructionId, SUM(total) AS total FROM promptInstructionHourly WHERE hour >= ? GROUP BY instructionId`,
    [since],
  );
  return Object.fromEntries(rows.map((r) => [r.instructionId, Number(r.total) || 0]));
}
