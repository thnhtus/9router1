// Jev (System One) routing persistence: per-decision log (capped), hourly counters (kept),
// and circuit-breaker events. Tables are declared in src/lib/db/schema.js (auto-synced).
// Optional: aggregated counters are pushed to Supabase (see pushJevMetrics) — never prompts/responses.
import { getAdapter } from "@/lib/db/driver.js";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";
import { getMeta, setMeta } from "@/lib/db/helpers/metaStore.js";
import { getConsistentMachineId } from "@/shared/utils/machineId.js";

const MAX_ROWS = 1000;
const PRUNE_EVERY = 50; // trim on every Nth insert, not each one (table may briefly hold MAX_ROWS + N)
let inserts = 0;

const hourOf = (ms = Date.now()) => new Date(Math.floor(ms / 3600000) * 3600000).toISOString();

// Upsert-add into the current hour bucket.
function bumpHour(a, comboName, { total = 0, failed = 0, skipped = 0, latencyMs = null }) {
  const n = latencyMs == null ? 0 : 1;
  a.run(
    `INSERT INTO jevHourly(hour, comboName, total, failed, skipped, latencySum, latencyN) VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hour, comboName) DO UPDATE SET total = total + excluded.total, failed = failed + excluded.failed,
       skipped = skipped + excluded.skipped, latencySum = latencySum + excluded.latencySum, latencyN = latencyN + excluded.latencyN`,
    [hourOf(), comboName || "", total, failed, skipped, n ? Math.round(latencyMs) : 0, n],
  );
}

export async function appendJevLog(e) {
  const a = await getAdapter();
  a.transaction(() => {
    a.run(
      `INSERT INTO jevLogs(createdAt, comboName, routerModel, choice, confidence, latencyMs, status, error, request, response)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        new Date().toISOString(), e.comboName ?? null, e.routerModel ?? null, e.choice ?? null,
        e.confidence ?? null, e.latencyMs ?? null, e.status ?? null, e.error ?? null,
        e.request ? JSON.stringify(e.request) : null, e.response ? JSON.stringify(e.response) : null,
      ],
    );
    // Latency average counts successful calls only (failures are often timeouts and would skew it).
    bumpHour(a, e.comboName, { total: 1, failed: e.error ? 1 : 0, latencyMs: e.error ? null : e.latencyMs });
  });
  if (++inserts % PRUNE_EVERY === 0) a.run(`DELETE FROM jevLogs WHERE id <= (SELECT MAX(id) FROM jevLogs) - ?`, [MAX_ROWS]);
  scheduleJevPush();
}

/** A request skipped Jev because the breaker was open. */
export async function countJevSkip(comboName) {
  const a = await getAdapter();
  bumpHour(a, comboName, { skipped: 1 });
}

export async function recordBreakerEvent({ kind, failStreak = 0, reason = null, until = null }) {
  const a = await getAdapter();
  a.run(`INSERT INTO jevBreakerEvents(at, kind, failStreak, reason, until) VALUES(?, ?, ?, ?, ?)`,
    [new Date().toISOString(), kind, failStreak, reason, until ? new Date(until).toISOString() : null]);
  scheduleJevPush();
}

/** Epoch ms the breaker stays open until, if the latest event is a still-valid 'open' (survives restarts). */
export async function loadOpenBreaker() {
  const a = await getAdapter();
  const row = a.get(`SELECT kind, until FROM jevBreakerEvents WHERE kind IN ('open', 'close') ORDER BY id DESC LIMIT 1`);
  const until = row?.kind === "open" && row.until ? Date.parse(row.until) : 0;
  return until > Date.now() ? until : 0;
}

/** Newest first. List rows omit bodies; pass id to get one row with request/response. */
export async function listJevLogs({ limit = 100, before, page } = {}) {
  const a = await getAdapter();
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  if (page) {
    const p = Math.max(Number(page) || 1, 1);
    const offset = (p - 1) * lim;
    return a.all(
      `SELECT id, createdAt, comboName, routerModel, choice, confidence, latencyMs, status, error FROM jevLogs
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [lim, offset],
    );
  }
  return a.all(
    `SELECT id, createdAt, comboName, routerModel, choice, confidence, latencyMs, status, error FROM jevLogs
     ${before ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ?`,
    before ? [before, lim] : [lim],
  );
}

export async function countJevLogs() {
  const a = await getAdapter();
  const row = a.get(`SELECT COUNT(*) AS n FROM jevLogs`);
  return row?.n ?? 0;
}

export async function getJevLog(id) {
  const a = await getAdapter();
  const row = a.get(`SELECT * FROM jevLogs WHERE id = ?`, [id]);
  return row ? { ...row, request: parseJson(row.request, null), response: parseJson(row.response, null) } : null;
}

/** Members Jev auto-removed from combos (newest first). reason = "combo: model". */
export async function listJevDrops(limit = 20) {
  const a = await getAdapter();
  return a.all(`SELECT at, failStreak, reason FROM jevBreakerEvents WHERE kind = 'drop' ORDER BY id DESC LIMIT ?`, [limit]);
}

/** Clears the per-request log only; hourly counters and breaker history are kept. */
export async function clearJevLogs() {
  const a = await getAdapter();
  a.run(`DELETE FROM jevLogs`);
}

/** combo → chosen model counts over the kept window; null choice = Jev gave no decision (fallback order). */
export async function jevFlows() {
  const a = await getAdapter();
  return a.all(`SELECT comboName AS combo, choice, COUNT(*) AS n FROM jevLogs GROUP BY comboName, choice`);
}

/** Totals over the last `hours` (whole hour buckets, current included) plus the per-hour series. */
export async function jevStats(hours = 1) {
  const a = await getAdapter();
  const since = hourOf(Date.now() - (hours - 1) * 3600000);
  const series = a.all(
    `SELECT hour, SUM(total) AS total, SUM(failed) AS failed, SUM(skipped) AS skipped,
            SUM(latencySum) AS latencySum, SUM(latencyN) AS latencyN
     FROM jevHourly WHERE hour >= ? GROUP BY hour ORDER BY hour`,
    [since],
  );
  const sum = (k) => series.reduce((s, r) => s + (r[k] || 0), 0);
  const latencyN = sum("latencyN");
  return {
    total: sum("total"), failed: sum("failed"), skipped: sum("skipped"),
    avgLatencyMs: latencyN ? Math.round(sum("latencySum") / latencyN) : null,
    series: series.map((r) => ({ hour: r.hour, total: r.total, failed: r.failed, skipped: r.skipped })),
  };
}

// ─── Optional Supabase push (aggregates only) ───────────────────────────
// Enabled when JEV_SUPABASE_URL + JEV_SUPABASE_SECRET_KEY are set (server-side secret key;
// tables have RLS on with no policies, so anon/publishable keys can't read or write).
const PUSH_DELAY_MS = 60 * 1000;
let pushTimer = null;

function scheduleJevPush() {
  if (pushTimer || !process.env.JEV_SUPABASE_URL || !process.env.JEV_SUPABASE_SECRET_KEY) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushJevMetrics().catch((e) => console.warn(`[JEV] supabase push failed: ${e.message}`));
  }, PUSH_DELAY_MS);
  pushTimer.unref?.();
}

async function postRows(table, onConflict, rows, prefer) {
  if (!rows.length) return;
  const url = `${process.env.JEV_SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?on_conflict=${onConflict}`;
  const key = process.env.JEV_SUPABASE_SECRET_KEY;
  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: `resolution=${prefer},return=minimal` },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/**
 * Push hourly counters touched since the last push (re-sending whole buckets, so it is an
 * idempotent overwrite) and breaker events not yet sent. Cursors live in _meta.
 */
export async function pushJevMetrics() {
  const a = await getAdapter();
  const instanceId = await getConsistentMachineId(); // salted hash, not the raw machine id
  const fromHour = (await getMeta("jevPushedHour")) || "";
  const lastEventId = Number(await getMeta("jevPushedEventId")) || 0;
  const nowHour = hourOf();

  const hourly = a.all(`SELECT * FROM jevHourly WHERE hour >= ? ORDER BY hour`, [fromHour]);
  await postRows("jev_hourly", "instance_id,hour,combo_name", hourly.map((r) => ({
    instance_id: instanceId, hour: r.hour, combo_name: r.comboName, total: r.total, failed: r.failed,
    skipped: r.skipped, latency_sum: r.latencySum, latency_n: r.latencyN, updated_at: new Date().toISOString(),
  })), "merge-duplicates");
  // Current hour keeps changing → next push re-sends from it.
  await setMeta("jevPushedHour", nowHour);

  const events = a.all(`SELECT * FROM jevBreakerEvents WHERE id > ? ORDER BY id LIMIT 500`, [lastEventId]);
  await postRows("jev_breaker_events", "instance_id,local_id", events.map((e) => ({
    instance_id: instanceId, local_id: e.id, at: e.at, kind: e.kind, fail_streak: e.failStreak, reason: e.reason,
  })), "ignore-duplicates");
  if (events.length) await setMeta("jevPushedEventId", events.at(-1).id);
  return { hourly: hourly.length, events: events.length };
}
