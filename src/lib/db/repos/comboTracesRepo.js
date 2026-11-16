import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// Same cap as the in-memory ring in open-sse/services/comboTrace.js.
export const MAX_COMBO_TRACES = 50;

// Persist one finished combo run. Idempotent per id so a re-ended run updates.
export async function saveComboTrace(run) {
  try {
    if (!run?.id) return;
    const db = await getAdapter();
    const startedAt = new Date(run.startedAt).toISOString();
    db.run(
      `INSERT INTO comboTraces(id, combo, strategy, startedAt, endedAt, status, cost, attempts)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET endedAt = excluded.endedAt, status = excluded.status, cost = excluded.cost, attempts = excluded.attempts`,
      [
        String(run.id),
        run.combo || null,
        run.strategy || null,
        startedAt,
        run.endedAt ? new Date(run.endedAt).toISOString() : null,
        run.status || null,
        Number.isFinite(run.cost) ? run.cost : null,
        stringifyJson(run.attempts || []),
      ]
    );
    const cnt = db.get(`SELECT COUNT(*) as c FROM comboTraces`);
    if (cnt && cnt.c > MAX_COMBO_TRACES) {
      db.run(
        `DELETE FROM comboTraces WHERE id IN (SELECT id FROM comboTraces ORDER BY startedAt ASC LIMIT ?)`,
        [cnt.c - MAX_COMBO_TRACES]
      );
    }
  } catch (e) {
    console.error("[comboTracesRepo] save failed:", e?.message || e);
  }
}

// Newest first, shaped like the in-memory runs (startedAt/endedAt in epoch ms).
export async function getComboTraces(limit = MAX_COMBO_TRACES) {
  try {
    const db = await getAdapter();
    const rows = db.all(
      `SELECT id, combo, strategy, startedAt, endedAt, status, cost, attempts FROM comboTraces ORDER BY startedAt DESC LIMIT ?`,
      [limit]
    );
    return rows.map((r) => ({
      id: r.id,
      combo: r.combo,
      strategy: r.strategy,
      startedAt: Date.parse(r.startedAt),
      endedAt: r.endedAt ? Date.parse(r.endedAt) : null,
      status: r.status,
      cost: r.cost,
      attempts: parseJson(r.attempts, []),
      persisted: true,
    }));
  } catch {
    return [];
  }
}

export async function clearComboTraces() {
  const db = await getAdapter();
  db.run(`DELETE FROM comboTraces`);
}
