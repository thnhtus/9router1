// Per-request log of Jev (System One) routing decisions: full request sent to Jev and its raw response.
// Stored in SQLite (own table, created lazily); capped so it never grows unbounded.
import { getAdapter } from "@/lib/db/driver.js";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";

const MAX_ROWS = 1000;
let ready = false;

async function db() {
  const a = await getAdapter();
  if (!ready) {
    a.exec(`CREATE TABLE IF NOT EXISTS jevLogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAt TEXT NOT NULL,
      comboName TEXT,
      routerModel TEXT,
      choice TEXT,
      confidence REAL,
      latencyMs INTEGER,
      status INTEGER,
      error TEXT,
      request TEXT,
      response TEXT
    )`);
    ready = true;
  }
  return a;
}

export async function appendJevLog(e) {
  const a = await db();
  a.run(
    `INSERT INTO jevLogs(createdAt, comboName, routerModel, choice, confidence, latencyMs, status, error, request, response)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(), e.comboName ?? null, e.routerModel ?? null, e.choice ?? null,
      e.confidence ?? null, e.latencyMs ?? null, e.status ?? null, e.error ?? null,
      e.request ? JSON.stringify(e.request) : null, e.response ? JSON.stringify(e.response) : null,
    ],
  );
  a.run(`DELETE FROM jevLogs WHERE id <= (SELECT MAX(id) FROM jevLogs) - ?`, [MAX_ROWS]);
}

/** Newest first. List rows omit bodies; pass id to get one row with request/response. */
export async function listJevLogs({ limit = 100, before } = {}) {
  const a = await db();
  return a.all(
    `SELECT id, createdAt, comboName, routerModel, choice, confidence, latencyMs, status, error FROM jevLogs
     ${before ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ?`,
    before ? [before, limit] : [limit],
  );
}

export async function getJevLog(id) {
  const a = await db();
  const row = a.get(`SELECT * FROM jevLogs WHERE id = ?`, [id]);
  return row ? { ...row, request: parseJson(row.request, null), response: parseJson(row.response, null) } : null;
}

export async function clearJevLogs() {
  const a = await db();
  a.run(`DELETE FROM jevLogs`);
}
