"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Badge } from "@/shared/components";
import ModelCharts from "./ModelCharts";

const fetchStats = () => fetch("/api/llm-stats").then(async (res) => ({ ok: res.ok, json: await res.json() }));

const TIER_VARIANT = { free: "success", cheap: "success", mid: "warning", premium: "error", unknown: "default" };

export default function ModelStatsPage() {
  const [data, setData] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [roles, setRoles] = useState({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("");

  const apply = useCallback(({ ok, json }) => {
    if (!ok) return setMsg(json.error || "Load failed");
    setData(json);
    setRoles(Object.fromEntries(json.models.filter((m) => m.role).map((m) => [m.id, m.role])));
  }, []);
  const load = () => fetchStats().then(apply);

  useEffect(() => {
    let alive = true;
    fetchStats().then((r) => alive && apply(r));
    return () => { alive = false; };
  }, [apply]);

  const post = async (label, body) => {
    setBusy(label); setMsg("");
    try {
      const res = await fetch("/api/llm-stats", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      setMsg(res.ok
        ? `${label}: done${json.catalogSize ? ` (${json.catalogSize} models via ${json.source}${json.mcpError ? ", MCP failed so REST was used" : ""})` : ""}`
        : json.error);
      if (res.ok) await load();
    } finally { setBusy(""); }
  };

  const models = (data?.models || []).filter((m) => !filter || m.id.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex flex-col gap-6">
      <Card title="LLM Stats" subtitle="Benchmarks and prices from llm-stats.com (MCP). Smart combos send these profiles to Jev so it picks the cheapest model that fits.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label={`API key ${data?.hasKey ? "(saved — enter a new one to replace)" : ""}`}
              type="password" autoComplete="off" placeholder="sk_ze_..."
              value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <Button onClick={() => post("Save key", { apiKey }).then(() => setApiKey(""))} disabled={!apiKey || !!busy}>Save key</Button>
          <Button variant="secondary" onClick={() => post("Sync", { action: "sync" })} disabled={!data?.hasKey || !!busy}>
            {busy === "Sync" ? "Syncing…" : "Sync catalog"}
          </Button>
        </div>
        <p className="mt-3 text-sm text-text-muted" role="status">
          {data?.fetchedAt ? `Catalog: ${data.catalogSize} models${data.source ? ` (${data.source})` : ""}, synced ${new Date(data.fetchedAt).toLocaleString()}` : "Catalog not synced yet."}
          {msg && ` · ${msg}`}
        </p>
      </Card>

      <ModelCharts models={data?.models || []} />

      <Card title="Available models and roles" subtitle="Role is a short label Jev reads (e.g. coding, reasoning, chat, cheap-fast). Empty = suggested from the top benchmark.">
        <div className="mb-3 flex gap-3">
          <Input placeholder="Filter models" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter models" />
          <Button onClick={() => post("Save roles", { roles })} disabled={!!busy}>Save roles</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text-muted">
              <tr><th className="py-2 pr-3">Model</th><th className="pr-3">Cost</th><th className="pr-3">Price in/out per 1M</th><th className="pr-3">Top scores</th><th>Role</th></tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="border-t border-border align-top">
                  <td className="py-2 pr-3 font-mono">{m.id}{m.stats && <div className="text-xs text-text-muted">{m.stats.name}</div>}</td>
                  <td className="pr-3"><Badge variant={TIER_VARIANT[m.tier]}>{m.tier}</Badge></td>
                  <td className="pr-3 tabular-nums">{m.stats?.inPrice != null ? `$${m.stats.inPrice} / $${m.stats.outPrice ?? "?"}` : "—"}</td>
                  <td className="pr-3 text-xs">
                    {Object.entries(m.stats?.scores || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round(v * 10) / 10}`).join(", ") || "—"}
                  </td>
                  <td>
                    <Input
                      aria-label={`Role for ${m.id}`} placeholder={m.suggestedRole}
                      value={roles[m.id] || ""} onChange={(e) => setRoles((r) => ({ ...r, [m.id]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
              {!models.length && <tr><td colSpan={5} className="py-6 text-center text-text-muted">No models from active providers.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
