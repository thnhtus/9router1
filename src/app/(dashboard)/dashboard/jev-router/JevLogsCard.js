"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Badge, Modal } from "@/shared/components";

const PAGE = 50;
const fetchLogs = (page = 1) => fetch(`/api/jev-logs?limit=${PAGE}&page=${page}`).then((r) => r.json());

function Json({ label, value }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs font-medium text-text-muted">{label}</p>
      <pre className="max-h-[calc(85vh-180px)] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{value ? JSON.stringify(value, null, 2) : "—"}</pre>
    </div>
  );
}

// Last-24h health strip (hourly counters, kept beyond the 1000-row log): failure rate + latency + whether the circuit breaker paused Jev.
function JevHealth({ data }) {
  if (!data?.stats) return null;
  const { total, failed, avgLatencyMs } = data.stats;
  const rate = total ? Math.round(((failed || 0) / total) * 100) : 0;
  const b = data.breaker || {};
  return (
    <p className="mb-3 text-sm text-text-muted" role="status">
      Last 24h: <span className="tabular-nums text-text">{total}</span> decisions ·{" "}
      <span className={`tabular-nums ${rate >= 20 ? "text-red-500" : "text-text"}`}>{rate}%</span> failed ·{" "}
      avg <span className="tabular-nums text-text">{avgLatencyMs ?? "—"}</span> ms
      {b.open
        ? <> · <Badge variant="error">paused until {new Date(b.openUntil).toLocaleTimeString()}</Badge></>
        : b.failStreak > 0 && <> · {b.failStreak} failure(s) in a row</>}
      {b.skipped > 0 && <> · {b.skipped} request(s) skipped Jev while paused</>}
    </p>
  );
}

export default function JevLogsCard() {
  const [logs, setLogs] = useState(null);
  const [open, setOpen] = useState(null); // { id, detail }
  const [msg, setMsg] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [health, setHealth] = useState(null);
  const loadHealth = useCallback(() => fetch("/api/jev-logs?stats=1&hours=24").then((r) => r.json()).then(setHealth).catch(() => {}), []);

  const apply = useCallback((d) => {
    if (d.error) return setMsg(d.error);
    setLogs(d.logs);
    if (d.total != null) setTotal(d.total);
    if (d.page != null) setPage(d.page);
  }, []);
  const loadPage = (p) => fetchLogs(p).then(apply).catch((e) => setMsg(e.message));
  const reload = () => { loadHealth(); return loadPage(1); };

  useEffect(() => {
    let alive = true;
    fetchLogs(1).then((d) => alive && apply(d)).catch((e) => alive && setMsg(e.message));
    loadHealth();
    return () => { alive = false; };
  }, [apply, loadHealth]);

  const toggle = async (id) => {
    if (open?.id === id) return setOpen(null);
    setOpen({ id, detail: null });
    const detail = await fetch(`/api/jev-logs?id=${id}`).then((r) => r.json());
    setOpen((o) => (o?.id === id ? { id, detail } : o));
  };

  const clear = async () => {
    if (!window.confirm("Delete all Jev logs?")) return;
    await fetch("/api/jev-logs", { method: "DELETE" });
    setOpen(null);
    reload();
  };

  return (
    <Card
      title="Jev logs"
      subtitle="One row per routing decision (newest first, last 1000 kept). Click a row to see the request sent to Jev and its response."
      action={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={reload}>Refresh</Button>
          <Button size="sm" variant="secondary" onClick={clear} disabled={!logs?.length}>Clear</Button>
        </div>
      }
    >
      <JevHealth data={health} />
      {msg && <p className="mb-2 text-sm text-text-muted" role="status">{msg}</p>}
      {!logs ? <p className="text-sm text-text-muted">Loading…</p> : !logs.length ? (
        <p className="text-sm text-text-muted">No decisions yet. Turn on Jev for a combo above and send a request through it.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text-muted">
              <tr><th className="py-2 pr-3">Time</th><th className="pr-3">Combo</th><th className="pr-3">Chosen model</th><th className="pr-3">Confidence</th><th className="pr-3">Latency</th><th>Result</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}
                    tabIndex={0} aria-haspopup="dialog"
                    onClick={() => toggle(l.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(l.id))}
                    className="cursor-pointer border-t border-border hover:bg-muted/50 focus-visible:outline focus-visible:outline-2"
                  >
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{new Date(l.createdAt).toLocaleString()}</td>
                    <td className="pr-3 font-mono">{l.comboName || "—"}</td>
                    <td className="pr-3 font-mono">{l.choice || "—"}</td>
                    <td className="pr-3 tabular-nums">{l.confidence != null ? `${Math.round(l.confidence * 100)}%` : "—"}</td>
                    <td className="pr-3 tabular-nums">{l.latencyMs != null ? `${l.latencyMs} ms` : "—"}</td>
                    <td>{l.error ? <Badge variant="error" title={l.error}>failed</Badge> : <Badge variant="success">ok</Badge>}</td>
                  </tr>
              ))}
            </tbody>
          </table>
          {total > PAGE && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-text-muted">Page {page} of {Math.max(1, Math.ceil(total / PAGE))} ({total} total)</span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => loadPage(page - 1)} disabled={page <= 1}>Prev</Button>
                <Button size="sm" variant="secondary" onClick={() => loadPage(page + 1)} disabled={page >= Math.ceil(total / PAGE)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}
      <Modal isOpen={!!open} onClose={() => setOpen(null)} title="Jev request / response" size="full" className="sm:max-w-6xl">
        {!open?.detail ? <p className="text-sm text-text-muted">Loading…</p> : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-muted">
              Router: <span className="font-mono">{open.detail.routerModel || "—"}</span>
              {open.detail.status != null && ` · HTTP ${open.detail.status}`}
              {open.detail.error && ` · ${open.detail.error}`}
            </p>
            <div className="flex flex-col gap-3 lg:flex-row">
              <Json label="Request" value={open.detail.request} />
              <Json label="Response" value={open.detail.response} />
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
