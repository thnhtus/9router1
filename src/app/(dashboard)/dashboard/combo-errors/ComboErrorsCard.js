"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Badge, Modal } from "@/shared/components";

export default function ComboErrorsCard() {
  const [combos, setCombos] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null); // { member, traces }

  useEffect(() => {
    if (document.hidden) return;
    Promise.all([fetch("/api/combos").then((r) => r.json()), fetch("/api/jev-logs?stats=1&hours=24").then((r) => r.json())])
      .then(([c, s]) => { setCombos(c); setStats(s); })
      .catch((e) => setError(e.message || "Failed to load"));
  }, []);

  const members = useMemo(() => {
    if (!combos?.health) return [];
    return Object.entries(combos.health).flatMap(([combo, ms]) =>
      Object.entries(ms || {})
        .filter(([, st]) => st?.failStreak > 0 || st?.removedAt)
        .map(([model, st]) => ({ combo, model, ...st }))
    )
      // Sort: removed first, then highest fail-streak first.
      .sort((a, b) => {
        if (Boolean(b.removedAt) !== Boolean(a.removedAt)) return Number(b.removedAt) - Number(a.removedAt);
        if (b.failStreak !== a.failStreak) return b.failStreak - a.failStreak;
        return b.model.localeCompare(a.model);
      });
  }, [combos]);

  const drops = stats?.drops || [];

  const openDetail = async (member) => {
    setSelected({ member, traces: null });
    try {
      const res = await fetch("/api/combos/traces").then((r) => r.json());
      const traces = (res.runs || []).flatMap((run) =>
        (run.attempts || [])
          .filter((a) => a.model === member.model)
          .map((a) => ({ ...a, combo: run.combo, strategy: run.strategy, runAt: run.startedAt }))
      );
      setSelected((cur) => (cur?.member?.model === member.model ? { member, traces } : cur));
    } catch {
      setSelected((cur) => (cur?.member?.model === member.model ? { member, traces: [] } : cur));
    }
  };

  const memberDrops = selected ? drops.filter((d) => d.reason === `${selected.member.combo}: ${selected.member.model}`) : [];

  return (
    <Card padding="sm" title="Combo health & drops" subtitle="Members failing in fallback/combos, their classified kind, and recent auto-removals. Restore removed members from the Combos page.">
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !combos && !stats ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-2 text-sm font-medium text-text">Unhealthy members</h3>
            {members.length === 0 ? (
              <p className="text-sm text-text-muted">No failing or removed members.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-black/10 dark:border-white/10">
                    <tr>
                      <th className="pb-2 pr-3 font-medium">Combo</th>
                      <th className="pb-2 pr-3 font-medium">Model</th>
                      <th className="pb-2 pr-3 font-medium">State</th>
                      <th className="pb-2 pr-3 font-medium">Kind</th>
                      <th className="pb-2 pr-3 font-medium">Fail streak</th>
                      <th className="pb-2 pr-3 font-medium">Removed at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m, i) => (
                      <tr key={i} onClick={() => openDetail(m)} title="Click for details"
                        className="cursor-pointer border-b border-black/5 transition-colors last:border-none hover:bg-black/[0.03] dark:border-white/5 dark:hover:bg-white/[0.04]">
                        <td className="py-2 pr-3"><code className="font-mono text-xs break-all">{m.combo}</code></td>
                        <td className="py-2 pr-3"><code className="font-mono text-xs break-all">{m.model}</code></td>
                        <td className="py-2 pr-3">
                          {m.removedAt ? <Badge variant="error">removed</Badge> : <Badge variant="warning">failing</Badge>}
                        </td>
                        <td className="py-2 pr-3">
                          {m.removedKind ? (
                            <span className="inline-flex rounded bg-red-500/10 px-1 py-0.5 text-[10px] font-mono uppercase text-red-600 dark:text-red-400" title={`Jev classified this drop as ${m.removedKind}`}>
                              {m.removedKind}
                            </span>
                          ) : m.failStreak > 0 && m.removedAt ? (
                            <span className="text-xs tabular-nums text-text-muted">·</span>
                          ) : (
                            <span className="text-xs tabular-nums text-text-muted">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-text-muted whitespace-nowrap">{m.failStreak ?? 0}</td>
                        <td className="py-2 text-xs text-text-muted tabular-nums whitespace-nowrap">{m.removedAt ? new Date(m.removedAt).toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-medium text-text">Recent auto-removals</h3>
            {drops.length === 0 ? (
              <p className="text-sm text-text-muted">No drop events recorded.</p>
            ) : (
              <ul className="space-y-1">
                {drops.map((d, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-black/5 pb-1 last:border-0 dark:border-white/5">
                    <code className="font-mono text-xs text-red-600 dark:text-red-400 break-all">{d.reason}</code>
                    <span className="text-xs text-text-muted tabular-nums shrink-0">
                      fail streak {d.failStreak} · {new Date(d.at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title="Unhealthy member detail" className="sm:max-w-4xl">
        {selected && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-sm break-all">{selected.member.model}</code>
              {selected.member.removedAt ? <Badge variant="error">removed</Badge> : <Badge variant="warning">failing</Badge>}
              {selected.member.removedKind && <Badge variant="default">{selected.member.removedKind}</Badge>}
            </div>
            {(() => {
              // Persisted by combo health (survives restart); falls back to the in-memory trace.
              const failedAttempts = (selected.traces || []).filter((a) => a.status === "failed");
              const trace = failedAttempts[failedAttempts.length - 1];
              const reason = selected.member.lastError || trace?.reason;
              if (!reason) return null;
              const at = selected.member.lastErrorAt || trace?.runAt;
              return (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs">
                  <span className="font-medium text-red-600 dark:text-red-400">Latest error</span>{" "}
                  {at && <span className="tabular-nums text-text-muted">{new Date(at).toLocaleString()}</span>}
                  {trace?.code ? <span className="tabular-nums"> · HTTP {trace.code}</span> : null}
                  {trace?.kind ? <span className="tabular-nums"> · kind {trace.kind}</span> : null}
                  <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-black/5 p-2 font-mono text-[11px] dark:bg-white/5">{reason}</pre>
                </div>
              );
            })()}
            <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-xs">
              <dt className="text-text-muted">Combo</dt><dd className="font-mono break-all">{selected.member.combo}</dd>
              <dt className="text-text-muted">Model</dt><dd className="font-mono break-all">{selected.member.model}</dd>
              <dt className="text-text-muted">State</dt><dd>{selected.member.removedAt ? "removed from combo" : "failing (not yet removed)"}</dd>
              <dt className="text-text-muted">Kind</dt><dd>{selected.member.removedKind || "—"}</dd>
              <dt className="text-text-muted">Fail streak</dt><dd className="tabular-nums">{selected.member.failStreak ?? 0}</dd>
              <dt className="text-text-muted">Removed at</dt><dd className="tabular-nums">{selected.member.removedAt ? new Date(selected.member.removedAt).toLocaleString() : "—"}</dd>
            </dl>

            <section>
              <h4 className="mb-1.5 text-xs font-medium text-text">Drop events ({memberDrops.length})</h4>
              {memberDrops.length === 0 ? (
                <p className="text-xs text-text-muted">No drop event recorded (still failing, or removed before event logging).</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {memberDrops.map((d, i) => (
                    <li key={i} className="flex flex-wrap gap-x-2 text-text-muted">
                      <span className="tabular-nums">{new Date(d.at).toLocaleString()}</span>
                      <span>fail streak {d.failStreak}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-1.5 text-xs font-medium text-text">Recent attempts ({selected.traces?.length ?? "…"})</h4>
              {selected.traces === null ? (
                <p className="text-xs text-text-muted">Loading…</p>
              ) : selected.traces.length === 0 ? (
                <p className="text-xs text-text-muted">No attempt in the last 50 combo runs (in-memory, reset on restart).</p>
              ) : (
                <div className="max-h-72 overflow-auto rounded-md border border-black/10 dark:border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-black/10 dark:border-white/10">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">When</th>
                        <th className="px-2 py-1.5 font-medium">Combo</th>
                        <th className="px-2 py-1.5 font-medium">Status</th>
                        <th className="px-2 py-1.5 font-medium">Code</th>
                        <th className="px-2 py-1.5 font-medium">Kind</th>
                        <th className="px-2 py-1.5 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.traces.map((t, i) => (
                        <tr key={i} className="border-b border-black/5 last:border-none dark:border-white/5">
                          <td className="px-2 py-1.5 tabular-nums whitespace-nowrap text-text-muted">{new Date(t.runAt).toLocaleTimeString()}</td>
                          <td className="px-2 py-1.5 font-mono break-all">{t.combo}</td>
                          <td className="px-2 py-1.5">{t.status}</td>
                          <td className="px-2 py-1.5 tabular-nums">{t.code ?? "—"}</td>
                          <td className="px-2 py-1.5">{t.kind ?? "—"}</td>
                          <td className="px-2 py-1.5 max-w-[24rem] break-all text-text-muted">{t.reason || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>
    </Card>
  );
}
