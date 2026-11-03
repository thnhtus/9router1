"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import { Card, Button, Badge } from "@/shared/components";

const PAGE = 100;
const fetchLogs = (before) => fetch(`/api/jev-logs?limit=${PAGE}${before ? `&before=${before}` : ""}`).then((r) => r.json());

function Json({ label, value }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs font-medium text-text-muted">{label}</p>
      <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{value ? JSON.stringify(value, null, 2) : "—"}</pre>
    </div>
  );
}

export default function JevLogsCard() {
  const [logs, setLogs] = useState(null);
  const [open, setOpen] = useState(null); // { id, detail }
  const [msg, setMsg] = useState("");
  const [more, setMore] = useState(false);

  const apply = useCallback((d) => {
    if (d.error) return setMsg(d.error);
    setLogs(d.logs);
    setMore(d.logs.length === PAGE);
  }, []);
  const loadMore = () => fetchLogs(logs.at(-1).id).then((d) => {
    if (d.error) return setMsg(d.error);
    setLogs((prev) => [...prev, ...d.logs]);
    setMore(d.logs.length === PAGE);
  }).catch((e) => setMsg(e.message));
  const reload = () => fetchLogs().then(apply).catch((e) => setMsg(e.message));

  useEffect(() => {
    let alive = true;
    fetchLogs().then((d) => alive && apply(d)).catch((e) => alive && setMsg(e.message));
    return () => { alive = false; };
  }, [apply]);

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
                <Fragment key={l.id}>
                  <tr
                    tabIndex={0} aria-expanded={open?.id === l.id}
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
                  {open?.id === l.id && (
                    <tr>
                      <td colSpan={6} className="pb-3">
                        {!open.detail ? <p className="text-sm text-text-muted">Loading…</p> : (
                          <div className="flex flex-col gap-2">
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
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {more && <div className="mt-3 flex justify-center"><Button size="sm" variant="secondary" onClick={loadMore}>Load more</Button></div>}
        </div>
      )}
    </Card>
  );
}
