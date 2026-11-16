// In-memory ring of recent combo runs for the dashboard's Fallback Chain monitor.
// ponytail: process-local, last MAX runs, lost on restart; persist to SQLite if history is needed.
import { AsyncLocalStorage } from "node:async_hooks";

const MAX = 50;
// Carries the attempt being tried so saveRequestUsage can attach its cost.
const als = (globalThis.__comboTraceAls ??= new AsyncLocalStorage());
const store = (globalThis.__comboTraces ??= { seq: 0, runs: [] });

export function startComboTrace(combo, strategy, models) {
  const run = {
    id: ++store.seq,
    combo,
    strategy,
    startedAt: Date.now(),
    endedAt: null,
    status: "trying",
    cost: null,
    attempts: models.map((model) => ({ model, status: "waiting", code: null, reason: null, ms: null, cost: null, tokens: null })),
  };
  store.runs.unshift(run);
  if (store.runs.length > MAX) store.runs.length = MAX;

  let t0 = 0;
  const end = (status) => {
    run.status = status;
    run.endedAt = Date.now();
    for (const a of run.attempts) if (a.status === "waiting") a.status = "skipped";
  };
  return {
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
}

export const listComboTraces = () => store.runs;
export function getCurrentCombo() { const ctx = als.getStore(); return ctx?.run?.combo || null; }
