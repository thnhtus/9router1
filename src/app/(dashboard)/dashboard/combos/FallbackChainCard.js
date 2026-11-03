"use client";

import { useEffect, useState } from "react";
import { Card, Badge } from "@/shared/components";

// Live view of recent combo runs, modelled on affectUI's Fallback Chain: the request
// branches to each member in try order, failed branches break red, the answering one
// runs on to the response. Data: GET /api/combos/traces (in-memory, last 50 runs).
const ROW = 52, GAP = 8, WIRE = 40;
const TONE = { waiting: "text-muted-foreground/40", trying: "text-primary", failed: "text-red-500", answered: "text-emerald-500", skipped: "text-muted-foreground/25" };
const LABEL = { waiting: "Waiting", trying: "Trying…", answered: "Answered", skipped: "Not needed" };

const fmtMs = (ms) => (ms == null ? "–" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const fmtCost = (c) => (c == null ? "–" : c === 0 ? "$0" : c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(3)}`);
const BAR = { trying: "bg-primary motion-safe:animate-pulse", failed: "bg-red-500", answered: "bg-emerald-500" };

// Per-model bar: width = that attempt's time as a share of the whole run.
function ModelBar({ a, ms, elapsed }) {
  if (!BAR[a.status]) return null;
  const pct = Math.max(2, Math.min(100, (ms / (elapsed || 1)) * 100));
  return (
    <div role="progressbar" aria-label={`${a.model} time`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
      className="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full bg-muted">
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
            className={`${tone} ${a.status === "trying" ? "motion-safe:animate-pulse" : ""}`} />
        );
      })}
    </svg>
  );
}

function Chain({ run, now }) {
  const tryingIdx = run.attempts.findIndex((a) => a.status === "trying");
  const winner = run.attempts.find((a) => a.status === "answered");
  const elapsed = (run.endedAt || now) - run.startedAt;
  const summary = run.status === "answered" ? `Answered in ${fmtMs(elapsed)}` : run.status === "failed" ? "Every model failed" : `Attempt ${tryingIdx + 1} of ${run.attempts.length}`;
  const n = run.attempts.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="font-medium text-foreground">{run.combo}</span>
        <span role="status" className="flex items-center gap-3 text-muted-foreground">
          <Badge size="sm" dot variant={run.status === "answered" ? "success" : run.status === "failed" ? "error" : "default"}>{summary}</Badge>
          <span className="tabular-nums">{fmtMs(elapsed)}</span>
          <span className="tabular-nums" title="Request cost (from usage pricing)">{fmtCost(run.cost)}</span>
        </span>
      </div>
      <div className="flex items-center overflow-x-auto rounded-lg border border-border bg-muted/30 p-3 [background-image:radial-gradient(currentColor_0.5px,transparent_0.5px)] [background-size:12px_12px] text-border">
        <div className="hidden shrink-0 rounded-md border border-border bg-card px-3 py-2 text-foreground sm:block">
          <p className="text-[13px] font-medium">Request</p>
          <p className="font-mono text-[11px] text-muted-foreground">{run.strategy}</p>
        </div>
        <Wires n={n} side="in" attempts={run.attempts} />
        <ol aria-label="Models, in the order they're tried" className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP }}>
          {run.attempts.map((a, i) => (
            <li key={i} title={a.reason || undefined} style={{ height: ROW }}
              className={`relative flex items-center gap-3 rounded-md border bg-card px-3 pb-1.5 text-foreground ${a.status === "failed" ? "border-red-500/40" : a.status === "answered" ? "border-emerald-500/40" : "border-border"} ${a.status === "skipped" ? "opacity-50" : ""}`}>
              <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[12px]">{a.model}</p>
                <p className={`truncate text-[11px] ${TONE[a.status]}`}>
                  {stateText(a)}{a.status === "failed" && a.reason ? <span className="text-muted-foreground"> — {a.reason}</span> : null}
                </p>
              </div>
              <span className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {a.status === "trying" ? fmtMs(now - a.at) : fmtMs(a.ms)}
                {a.cost != null && <span className="block" title={a.tokens ? `${a.tokens.in} in · ${a.tokens.out} out` : undefined}>{fmtCost(a.cost)}</span>}
              </span>
              <ModelBar a={a} ms={a.status === "trying" ? now - a.at : a.ms || 0} elapsed={elapsed} />
            </li>
          ))}
        </ol>
        <Wires n={n} side="out" attempts={run.attempts} />
        <div className={`hidden shrink-0 rounded-md border bg-card px-3 py-2 sm:block ${winner ? "border-emerald-500/40 text-foreground" : run.status === "failed" ? "border-red-500/40 text-foreground" : "border-border text-muted-foreground"}`}>
          <p className="text-[13px] font-medium">Response</p>
          <p className="max-w-[140px] truncate font-mono text-[11px] text-muted-foreground">{winner ? winner.model : run.status === "failed" ? "No answer" : "Waiting…"}</p>
        </div>
      </div>
    </div>
  );
}

export default function FallbackChainCard() {
  const [data, setData] = useState({ runs: [], now: 0 });
  const [selected, setSelected] = useState(null);
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

  return (
    <Card title="Combo monitor" subtitle="Live fallback chain for recent combo requests (last 50, kept in memory until restart). Hover a failed model for the error.">
      {error && <p className="text-[13px] text-red-500">{error}</p>}
      {!run ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">No combo requests yet. Send a request to a combo and it shows up here.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Chain run={run} now={data.now} />
          {data.runs.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Recent combo runs">
              {data.runs.slice(0, 20).map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={r.id === run.id} onClick={() => setSelected(r.id)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${r.id === run.id ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  <span className={`size-1.5 rounded-full ${r.status === "answered" ? "bg-emerald-500" : r.status === "failed" ? "bg-red-500" : "bg-primary motion-safe:animate-pulse"}`} />
                  <span className="font-mono">{r.combo}</span>
                  <span className="tabular-nums">{new Date(r.startedAt).toLocaleTimeString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
