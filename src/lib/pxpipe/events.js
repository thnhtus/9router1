import { getAdapter } from "@/lib/db/driver.js";

// Same order of magnitude the old 2×5MB rotated JSONL held.
const MAX_ROWS = 50000;
const PRUNE_EVERY = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
let inserts = 0;

// Fire-and-forget: stats must never break the request path.
export function appendPxpipeEvent(event) {
  const ts = Date.now();
  getAdapter().then((a) => {
    a.run(`INSERT INTO pxpipeEvents(ts, data) VALUES(?, ?)`, [ts, JSON.stringify({ ts, ...event })]);
    if (++inserts % PRUNE_EVERY === 0) a.run(`DELETE FROM pxpipeEvents WHERE id <= (SELECT MAX(id) FROM pxpipeEvents) - ?`, [MAX_ROWS]);
  }).catch(() => { /* ignore */ });
}

export async function readPxpipeEvents({ sinceMs = null, limit = null } = {}) {
  const a = await getAdapter();
  const rows = limit
    ? a.all(`SELECT data FROM pxpipeEvents WHERE ts >= ? ORDER BY ts DESC, id DESC LIMIT ?`, [sinceMs || 0, limit]).reverse()
    : a.all(`SELECT data FROM pxpipeEvents WHERE ts >= ? ORDER BY ts, id`, [sinceMs || 0]);
  const events = [];
  for (const r of rows) {
    try { events.push(JSON.parse(r.data)); } catch { /* skip corrupt row */ }
  }
  return events;
}

function emptyTotals() {
  return {
    requests: 0, compressed: 0, bypassed: 0, errors: 0,
    tokensBeforeEst: 0, tokensAfterEst: 0, tokensSavedEst: 0, savedPct: 0,
    imagesGenerated: 0, compressionTimeMs: 0, avgCompressionMs: 0,
  };
}

function accumulate(totals, ev) {
  totals.requests++;
  if (ev.applied) {
    totals.compressed++;
    totals.tokensBeforeEst += ev.tokensBeforeEst || 0;
    totals.tokensAfterEst += ev.tokensAfterEst || 0;
    totals.tokensSavedEst += ev.tokensSavedEst || 0;
    totals.imagesGenerated += ev.imageCount || 0;
    totals.compressionTimeMs += ev.durationMs || 0;
  } else if (ev.reason === "transform_error" || ev.reason === "timeout") {
    totals.errors++;
  } else {
    totals.bypassed++;
  }
}

function finalize(totals) {
  totals.savedPct = totals.tokensBeforeEst > 0
    ? +((totals.tokensSavedEst / totals.tokensBeforeEst) * 100).toFixed(2)
    : 0;
  totals.avgCompressionMs = totals.compressed > 0
    ? Math.round(totals.compressionTimeMs / totals.compressed)
    : 0;
  return totals;
}

// Aggregated stats for the dashboard: all-time + windowed totals, a daily
// tokens-saved timeline (last `timelineDays`), and the most recent events.
export async function getPxpipeStats({ timelineDays = 30, recentLimit = 100 } = {}) {
  const events = await readPxpipeEvents();
  const now = Date.now();
  const startOfToday = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();

  const windows = {
    all: emptyTotals(),
    today: emptyTotals(),
    yesterday: emptyTotals(),
    last7d: emptyTotals(),
    last30d: emptyTotals(),
  };

  const timeline = new Map();
  for (let i = timelineDays - 1; i >= 0; i--) {
    const day = new Date(startOfToday - i * DAY_MS);
    timeline.set(day.toISOString().slice(0, 10), { date: day.toISOString().slice(0, 10), tokensSavedEst: 0, compressed: 0, requests: 0 });
  }

  for (const ev of events) {
    accumulate(windows.all, ev);
    if (ev.ts >= startOfToday) accumulate(windows.today, ev);
    else if (ev.ts >= startOfToday - DAY_MS) accumulate(windows.yesterday, ev);
    if (ev.ts >= now - 7 * DAY_MS) accumulate(windows.last7d, ev);
    if (ev.ts >= now - 30 * DAY_MS) accumulate(windows.last30d, ev);

    const key = new Date(ev.ts).toISOString().slice(0, 10);
    const bucket = timeline.get(key);
    if (bucket) {
      bucket.requests++;
      if (ev.applied) {
        bucket.compressed++;
        bucket.tokensSavedEst += ev.tokensSavedEst || 0;
      }
    }
  }

  for (const w of Object.values(windows)) finalize(w);

  return {
    windows,
    timeline: [...timeline.values()],
    recent: events.slice(-recentLimit).reverse(),
  };
}
