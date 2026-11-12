"use client";

import { useEffect, useState } from "react";
import { Card, Badge } from "@/shared/components";

// Live view of recent combo runs, modelled on affectUI's Fallback Chain: the request
// branches to each member in try order, failed branches break red, the answering one
// runs on to the response. Data: GET /api/combos/traces (in-memory, last 50 runs).
const ROW = 46, GAP = 6, WIRE = 36, INITIAL_VISIBLE_SKIPPED = 1, INITIAL_RUNS = 8;
const TONE = { waiting: "text-muted-foreground/50", trying: "text-primary", failed: "text-red-500", answered: "text-emerald-500", skipped: "text-muted-foreground/40" };
const LABEL = { waiting: "Waiting", trying: "Trying...", answered: "Answered", skipped: "Not needed" };

const fmtMs = (ms) => (ms == null ? "-" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const fmtCost = (c) => (c == null ? "-" : c === 0 ? "$0" : c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(3)}`);
const BAR = { trying: "bg-primary", failed: "bg-red-500", answered: "bg-emerald-500" };

// Per-model bar: width = that attempt's time as a share of the whole run.
function ModelBar({ a, ms, elapsed }) {
  if (!BAR[a.status]) return null;
  const pct = Math.max(2, Math.min(100, (ms / (elapsed || 1)) * 100));
  return (
    <div role="progressbar" aria-label={`${a.model} time`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
      className="absolute inset-x-3 bottom-1 h-1 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${BAR[a.status]} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const stateText = (a) => (a.status === "failed" ? `Failed${a.code ? ` · ${a.code}` : ""}` : LABEL[a.status]);

function Wires({ n, side, attempts }) {
  const h = n * ROW + (n - 1) * GAP, mid = h / 2;
  return (
    <svg width={WIRE} height={h} className="hidden shrink-0 sm:block" aria-hidden="true">
      {attempts.map((a, i) => {
        const y = i * (ROW + GAP) + ROW / 2;
        const [x0, y0, x1, y1] = side === "in" ? [0, mid, WIRE, y] : [0, y, WIRE, mid];
        const live = side === "in" ? a.status !== "waiting" && a.status !== "skipped" : a.status === "answered";
        const tone = side === "out" && !live ? TONE.skipped : TONE[a.status];
        return (
          <path key={i} d={`M${x0},${y0} C${WIRE / 2},${y0} ${WIRE / 2},${y1} ${x1},${y1}`} fill="none" stroke="currentColor"
            strokeWidth={live ? 1.5 : 1} strokeDasharray={live && a.status !== "failed" ? undefined : "3 3"}
            className={tone} />
        );
      })}
    </svg>
  );
}

function Chain({ run, now }) {
  const [showAllAttempts, setShowAllAttempts] = useState(false);
  const tryingIdx = run.attempts.findIndex((a) => a.status === "trying");
  const winner = run.attempts.find((a) => a.status === "answered");
  const elapsed = (run.endedAt || now) - run.startedAt;
  const summary = run.status === "answered" ? `Answered in ${fmtMs(elapsed)}` : run.status === "failed" ? "Every model failed" : `Attempt ${tryingIdx + 1} of ${run.attempts.length}`;

  // Keep active/failed/answered rows + 1 skipped neighbor by default so large combos stay compact.
  const indexedAttempts = run.attempts.map((a, idx) => ({ ...a, originalIndex: idx }));
  const totalSkipped = indexedAttempts.filter((a) => a.status === "skipped").length;
  const canCollapse = run.attempts.length > 4 && totalSkipped > INITIAL_VISIBLE_SKIPPED;
  let seenSkipped = 0;
  const visibleAttempts = (!canCollapse || showAllAttempts)
    ? indexedAttempts
    : indexedAttempts.filter((a) => {
        if (a.status !== "skipped") return true;
        seenSkipped += 1;
        return seenSkipped <= INITIAL_VISIBLE_SKIPPED;
      });
  const hiddenCount = indexedAttempts.length - visibleAttempts.length;
  const n = visibleAttempts.length;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <code className="rounded bg-black/5 px-2 py-0.5 font-mono text-[13px] font-semibold text-foreground dark:bg-white/[0.06]">{run.combo}</code>
          <span className="text-muted-foreground tabular-nums">{run.attempts.length} models in chain</span>
        </div>
        <span role="status" className="flex flex-wrap items-center gap-2.5 text-muted-foreground">
          {canCollapse && (
            <button
              type="button"
              onClick={() => setShowAllAttempts((v) => !v)}
              className="rounded border border-black/10 bg-black/[0.02] px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground dark:border-white/10 dark:bg-white/[0.03]"
            >
              {showAllAttempts ? `Hide ${ totalSkipped - INITIAL_VISIBLE_SKIPPED } skipped` : `+${hiddenCount} not needed`}
            </button>
          )}
          <Badge size="md" dot variant={run.status === "answered" ? "success" : run.status === "failed" ? "error" : "default"} className="text-xs">
            {summary}
          </Badge>
          <span className="tabular-nums font-medium text-foreground">{fmtMs(elapsed)}</span>
          <span className="tabular-nums" title="Request cost (from usage pricing)">{fmtCost(run.cost)}</span>
        </span>
      </div>
      <div className="flex items-center overflow-x-auto rounded-lg border border-black/5 bg-black/[0.015] p-3 text-border dark:border-white/[0.06] dark:bg-white/[0.015]">
        <div className="hidden shrink-0 rounded-md border border-black/10 bg-card px-3 py-2 text-foreground dark:border-white/10 sm:block">
          <p className="text-xs font-medium">Request</p>
          <code className="block font-mono text-xs text-muted-foreground">{run.strategy}</code>
        </div>
        <Wires n={n} side="in" attempts={visibleAttempts} />
        <ol aria-label="Models, in the order they're tried" className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP }}>
          {visibleAttempts.map((a) => (
            <li key={a.originalIndex} title={a.reason || undefined} style={{ height: ROW }}
              className={`relative flex items-center gap-3 rounded-md border bg-card px-3 pb-1 text-foreground ${a.status === "failed" ? "border-red-500/40" : a.status === "answered" ? "border-emerald-500/40" : "border-black/10 dark:border-white/10"} ${a.status === "skipped" ? "opacity-55" : ""}`}>
              <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{a.originalIndex + 1}</span>
              <div className="min-w-0 flex-1">
                <code className="block truncate font-mono text-xs">{a.model}</code>
                <p className={`truncate text-xs ${TONE[a.status]}`}>
                  {stateText(a)}{a.status === "failed" && a.reason ? <span className="text-muted-foreground"> · {a.reason}</span> : null}
                </p>
              </div>
              <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {a.status === "trying" ? fmtMs(now - a.at) : fmtMs(a.ms)}
                {a.cost != null && <span className="block" title={a.tokens ? `${a.tokens.in} in · ${a.tokens.out} out` : undefined}>{fmtCost(a.cost)}</span>}
              </span>
              <ModelBar a={a} ms={a.status === "trying" ? now - a.at : a.ms || 0} elapsed={elapsed} />
            </li>
          ))}
        </ol>
        <Wires n={n} side="out" attempts={visibleAttempts} />
        <div className={`hidden shrink-0 rounded-md border bg-card px-3 py-2 sm:block ${winner ? "border-emerald-500/40 text-foreground" : run.status === "failed" ? "border-red-500/40 text-foreground" : "border-black/10 text-muted-foreground dark:border-white/10"}`}>
          <p className="text-xs font-medium">Response</p>
          <code className="block max-w-[160px] truncate font-mono text-xs text-muted-foreground">{winner ? winner.model : run.status === "failed" ? "No answer" : "Waiting..."}</code>
        </div>
      </div>
    </div>
  );
}

export default function FallbackChainCard() {
  const [data, setData] = useState({ runs: [], now: 0 });
  const [selected, setSelected] = useState(null);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      fetch("/api/combos/traces").then((r) => r.json())
        .then((d) => { if (alive) { setData({ runs: d.runs || [], now: d.now }); setError(""); } })
        .catch((e) => alive && setError(e.message));
    };
    load();
    const t = setInterval(load, 1500);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const run = data.runs.find((r) => r.id === selected) || data.runs[0];
  const visibleRuns = showAllRuns ? data.runs.slice(0, 20) : data.runs.slice(0, INITIAL_RUNS);
  const hiddenRunsCount = Math.min(20, data.runs.length) - visibleRuns.length;

  return (
    <Card padding="sm" title="Combo monitor" subtitle="Live fallback chain for recent combo requests (last 50, kept in memory until restart). Hover a failed model for the error.">
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!run ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No combo requests yet. Send a request to a combo and it shows up here.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Chain key={run.id} run={run} now={data.now} />
          {data.runs.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Recent combo runs">
              {visibleRuns.map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={r.id === run.id} onClick={() => setSelected(r.id)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${r.id === run.id ? "border-primary/50 bg-primary/10 text-foreground" : "border-black/10 text-muted-foreground hover:text-foreground dark:border-white/10"}`}>
                  <span className={`size-1.5 rounded-full ${r.status === "answered" ? "bg-emerald-500" : r.status === "failed" ? "bg-red-500" : "bg-primary"}`} />
                  <code className="font-mono text-xs">{r.combo}</code>
                  <span className="tabular-nums text-muted-foreground">{new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                </button>
              ))}
              {data.runs.length > INITIAL_RUNS && (
                <button
                  type="button"
                  onClick={() => setShowAllRuns((v) => !v)}
                  className="rounded-md border border-black/10 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground dark:border-white/10"
                >
                  {showAllRuns ? "Show fewer" : `+${hiddenRunsCount} older`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
