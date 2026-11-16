// Trace of combo runs for the dashboard's Fallback Chain monitor.
// Live state lives in an in-memory ring (fast for the 1s poll); each finished run
// is also written to SQLite (src/lib/db/repos/comboTracesRepo.js) so history
// survives restarts and can be read from another instance.
import { AsyncLocalStorage } from "node:async_hooks";
import { exportComboRun } from "./langfuseExport.js";

const MAX = 50;
// Carries the attempted run so saveRequestUsage can attach its cost + traceId.
const als = (globalThis.__comboTraceAls ??= new AsyncLocalStorage());
const store = (globalThis.__comboTraces ??= { seq: 0, runs: [] });

let persisting = Promise.resolve();

function persist(run) {
  // A test that never set DATA_DIR would otherwise write into the developer's real DB.
  if (process.env.VITEST && !process.env.DATA_DIR) return;
  persisting = persisting
    .then(async () => {
      const { saveComboTrace } = await import("@/lib/db/repos/comboTracesRepo.js");
      await saveComboTrace(run);
      // No-op unless LANGFUSE_* env is set; failures never reach the caller.
      await exportComboRun(run).catch(() => {});
    })
    .catch(() => {});
}

export function startComboTrace(combo, strategy, models) {
  const startedAt = Date.now();
  const run = {
    // String id (time-based) so ids stay unique across restarts and DB rows.
    id: `${startedAt.toString(36)}-${++store.seq}`,
    combo,
    strategy,
    startedAt,
    endedAt: null,
    status: "trying",
    cost: null,
    attempts: models.map((model) => ({ model, status: "waiting", code: null, reason: null, ms: null, cost: null, tokens: null })),
  };
  store.runs.unshift(run);
  if (store.runs.length > MAX) store.runs.length = MAX;

  let t0 = 0;
  const end = (status) => {
    if (run.endedAt) return;
    run.status = status;
    run.endedAt = Date.now();
    for (const a of run.attempts) if (a.status === "waiting") a.status = "skipped";
    persist(run);
  };
  return {
    id: run.id,
    // Run fn with attempt i as the usage target (cost lands even after the stream ends).
    run(i, fn) { return als.run({ run, i }, fn); },
    // model: the attempt switched to another model (orchestrate worker failover).
    trying(i, model) { t0 = Date.now(); Object.assign(run.attempts[i], { status: "trying", at: t0 }, model ? { model } : {}); },
    failed(i, code, reason) {
      Object.assign(run.attempts[i], { status: "failed", code: code ?? null, reason: reason ? String(reason).slice(0, 200) : null, ms: Date.now() - (run.attempts[i].at ?? t0) });
    },
    // keepOpen: parallel attempts (orchestrate) where one answer does not end the run.
    answered(i, keepOpen) { Object.assign(run.attempts[i], { status: "answered", ms: Date.now() - (run.attempts[i].at ?? t0) }); if (!keepOpen) end("answered"); },
    // Close a run whose attempts ran in parallel (orchestrate).
    end,
    // Returned without a usable answer from i (no-fallback error / all failed).
    finish(i, code, reason) { if (i != null && run.attempts[i]?.status === "trying") this.failed(i, code, reason); end("failed"); },
  };
}

// Called from saveRequestUsage; no-op outside a combo attempt.
export function recordComboCost(cost, tokens) {
  const ctx = als.getStore();
  if (!ctx || !Number.isFinite(cost)) return;
  const a = ctx.run.attempts[ctx.i];
  a.cost = (a.cost || 0) + cost;
  a.tokens = { in: tokens?.prompt_tokens || tokens?.input_tokens || 0, out: tokens?.completion_tokens || tokens?.output_tokens || 0 };
  ctx.run.cost = (ctx.run.cost || 0) + cost;
  // Usage is written after the answer settles, so the row persisted by end() has
  // no cost yet — upsert again once it lands (idempotent per run id).
  if (ctx.run.endedAt) persist(ctx.run);
}

// Merge live ring with persisted runs (newest first, no duplicates).
export async function listComboTraces(limit = MAX) {
  let persisted = [];
  try {
    const { getComboTraces } = await import("@/lib/db/repos/comboTracesRepo.js");
    persisted = await getComboTraces(limit);
  } catch {}
  const seen = new Set(store.runs.map((r) => r.id));
  return [...store.runs, ...persisted.filter((r) => !seen.has(r.id))].slice(0, limit);
}

export function getCurrentCombo() { const ctx = als.getStore(); return ctx?.run?.combo || null; }

// Trace id of the combo run carrying the current request (null outside a combo).
export function getCurrentTraceId() { const ctx = als.getStore(); return ctx?.run?.id || null; }
