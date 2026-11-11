"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Badge } from "@/shared/components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import ModelCharts from "./ModelCharts";

const fetchStats = () => fetch("/api/llm-stats").then(async (res) => ({ ok: res.ok, json: await res.json() }));

function RoleTags({ value, placeholder, ariaLabel, onChange }) {
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  const add = (text) => onChange([...items, text].join(", "));
  const remove = (i) => onChange(items.filter((_, j) => j !== i).join(", "));
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((t, i) => (
        <span key={`${t}-${i}`} className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs text-text-muted">
          {t}
          <button type="button" aria-label={`Remove ${t}`} className="leading-none hover:text-text-primary" onClick={() => remove(i)}>×</button>
        </span>
      ))}
      <input
        aria-label={ariaLabel} placeholder={items.length ? "" : placeholder}
        className="min-w-[5rem] flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted"
        onKeyDown={(e) => {
          const text = e.currentTarget.value.trim();
          if ((e.key === "Enter" || e.key === ",") && text) { e.preventDefault(); add(text); e.currentTarget.value = ""; }
          else if (e.key === "Backspace" && !e.currentTarget.value && items.length) { remove(items.length - 1); }
        }}
        onBlur={(e) => { const text = e.currentTarget.value.trim(); if (text) { add(text); e.currentTarget.value = ""; } }}
      />
    </div>
  );
}

const TIER_VARIANT = { free: "success", cheap: "success", mid: "warning", premium: "error", unknown: "default" };

function ThCell({ k, className = "", children, sort, onSort }) {
  return (
    <th className={`pr-3 ${className}`} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-text-primary" onClick={() => onSort(k)}>
        {children}{sort.key === k && <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export default function ModelStatsPage() {
  const [data, setData] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [roles, setRoles] = useState({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("");
  const [tier, setTier] = useState("");
  const [usedOnly, setUsedOnly] = useState(false);
  const [sort, setSort] = useState({ key: "usage", dir: -1 });

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

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === "id" ? 1 : -1 }));
  const SORT_VAL = {
    id: (m) => m.id.toLowerCase(),
    tier: (m) => ["free", "cheap", "mid", "premium", "unknown"].indexOf(m.tier),
    price: (m) => m.stats?.inPrice ?? Infinity,
    usage: (m) => m.usage7d || 0,
    score: (m) => Math.max(0, ...Object.values(m.ranks || {})),
  };
  const models = (data?.models || [])
    .filter((m) => !filter || m.id.toLowerCase().includes(filter.toLowerCase()))
    .filter((m) => !tier || m.tier === tier)
    .filter((m) => !usedOnly || m.usage7d > 0)
    .sort((a, b) => { const x = SORT_VAL[sort.key](a), y = SORT_VAL[sort.key](b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });

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
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Input placeholder="Filter models" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter models" />
          <NativeSelect aria-label="Filter by tier" value={tier} onChange={(e) => setTier(e.target.value)} className="[&_select]:h-8 [&_select]:text-sm">
            <NativeSelectOption value="">All tiers</NativeSelectOption>
            {["free", "cheap", "mid", "premium", "unknown"].map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}
          </NativeSelect>
          <label className="flex h-8 cursor-pointer items-center gap-2 text-sm text-text-muted">
            <input type="checkbox" checked={usedOnly} onChange={(e) => setUsedOnly(e.target.checked)} className="accent-primary" />
            Used in 7d
          </label>
          <span className="ml-auto text-xs text-text-muted tabular-nums">{models.length} / {data?.models?.length ?? 0}</span>
          <Button onClick={() => post("Save roles", { roles })} disabled={!!busy}>Save roles</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-text-muted">
              <tr><ThCell k="id" sort={sort} onSort={toggleSort} className="py-2">Model</ThCell><ThCell k="tier" sort={sort} onSort={toggleSort}>Cost</ThCell><ThCell k="price" sort={sort} onSort={toggleSort}>Price in/out per 1M</ThCell><ThCell k="usage" sort={sort} onSort={toggleSort} className="text-right">Requests 7d</ThCell><ThCell k="score" sort={sort} onSort={toggleSort}>Top scores</ThCell><th className="pr-3">Role</th></tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="border-t border-border align-middle">
                  <td className="py-2 pr-3 font-mono break-all">{m.id}{m.stats && <div className="text-xs text-text-muted">{m.stats.name}</div>}
                    {m.combos?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{m.combos.map((c) => <Badge key={c}>{c}</Badge>)}</div>}</td>
                  <td className="pr-3"><Badge variant={TIER_VARIANT[m.tier]}>{m.tier}</Badge></td>
                  <td className="pr-3 whitespace-nowrap tabular-nums">{m.stats?.inPrice != null ? `$${m.stats.inPrice} / $${m.stats.outPrice ?? "?"}` : "—"}</td>
                  <td className="pr-3 text-right tabular-nums">{m.usage7d ? m.usage7d.toLocaleString() : "—"}</td>
                  <td className="pr-3 text-xs whitespace-nowrap tabular-nums">
                    {Object.entries(m.ranks || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, p]) => `${k} top ${101 - p}%`).join(", ") || "—"}
                  </td>
                  <td className="py-2 min-w-[14rem]">
                    <RoleTags
                      value={roles[m.id] || ""} placeholder={m.suggestedRole} ariaLabel={`Role for ${m.id}`}
                      onChange={(v) => setRoles((r) => ({ ...r, [m.id]: v }))}
                    />
                  </td>
                </tr>
              ))}
              {!models.length && <tr><td colSpan={6} className="py-6 text-center text-text-muted">{filter || tier || usedOnly ? `No models match the current filters.` : "No models from active providers."}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
