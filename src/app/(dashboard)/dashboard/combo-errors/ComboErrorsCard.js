"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Badge } from "@/shared/components";

export default function ComboErrorsCard() {
  const [combos, setCombos] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

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
                      <tr key={i} className="border-b border-black/5 last:border-none dark:border-white/5">
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
    </Card>
  );
}
