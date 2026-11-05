"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Select, Toggle, Badge } from "@/shared/components";

const JEV_MODELS = ["jev-latest", "jev-preview", "jev-1.13.0"].map((m) => ({ value: `typesafe/${m}`, label: m }));

async function loadAll() {
  const [p, c, s] = await Promise.all(["/api/providers", "/api/combos", "/api/settings"].map((u) => fetch(u).then((r) => r.json())));
  return {
    connected: (p.connections || []).some((x) => x.provider === "typesafe" && x.isActive !== false),
    combos: c.combos || [],
    strategies: s.comboStrategies || {},
  };
}

// One place to wire Jev: TypeSafe key → router model → which combos Jev routes.
export default function JevRouterCard() {
  const [state, setState] = useState(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(JEV_MODELS[0].value);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = useCallback((s) => {
    setState(s);
    const used = Object.values(s.strategies).find((x) => x.fallbackStrategy === "smart" && x.routerModel?.startsWith("typesafe/"));
    if (used) setModel(used.routerModel);
  }, []);

  useEffect(() => {
    let alive = true;
    loadAll().then((s) => alive && apply(s)).catch((e) => alive && setMsg(e.message));
    return () => { alive = false; };
  }, [apply]);

  const run = async (fn) => {
    setBusy(true); setMsg("");
    try { await fn(); apply(await loadAll()); } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };

  const saveKey = () => run(async () => {
    const res = await fetch("/api/providers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "typesafe", name: "TypeSafe Jev", apiKey: key.trim() }),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Save failed");
    setKey(""); setMsg("TypeSafe key saved");
  });

  const saveStrategies = (strategies) => run(async () => {
    const res = await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comboStrategies: strategies }),
    });
    if (!res.ok) throw new Error("Save failed");
  });

  const isJev = (name) => state?.strategies[name]?.fallbackStrategy === "smart";

  // fusion/orchestrate combos run several models on purpose; Jev must not flatten them to one pick.
  const isMulti = (name) => ["fusion", "orchestrate"].includes(state?.strategies[name]?.fallbackStrategy);

  const toggle = (name, on) => {
    if (isMulti(name)) return;
    const next = { ...state.strategies };
    if (on) next[name] = { ...(next[name] || {}), fallbackStrategy: "smart", routerModel: model };
    else delete next[name]; // back to default "fallback"
    saveStrategies(next);
  };

  // Changing the model re-points every combo Jev already routes.
  const changeModel = (value) => {
    setModel(value);
    const next = { ...state.strategies };
    for (const [n, s] of Object.entries(next)) if (s.fallbackStrategy === "smart") next[n] = { ...s, routerModel: value };
    saveStrategies(next);
  };

  return (
    <Card title="Jev Router" subtitle="TypeSafe Jev picks one model per request inside a combo, using the roles and costs set in Model Stats.">
      {!state ? <p className="text-sm text-text-muted">Loading…</p> : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="TypeSafe API key" type="password" autoComplete="off"
                placeholder={state.connected ? "Connected — paste a key to add another" : "ts_..."}
                value={key} onChange={(e) => setKey(e.target.value)}
              />
            </div>
            <Button onClick={saveKey} disabled={!key.trim() || busy}>Save key</Button>
            <Badge variant={state.connected ? "success" : "warning"}>{state.connected ? "Connected" : "Not connected"}</Badge>
          </div>

          <div className="max-w-xs">
            <Select label="Router model" options={JEV_MODELS} value={model} onChange={(e) => changeModel(e.target.value)} disabled={busy} />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Combos routed by Jev</p>
            {!state.combos.length && <p className="text-sm text-text-muted">No combos yet — create one in Combos.</p>}
            <ul className="flex flex-col gap-2">
              {state.combos.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 border-b border-border pb-2">
                  <span className="font-mono text-sm">{c.name} <span className="text-text-muted">({(c.models || []).length} models)</span></span>
                  {isMulti(c.name)
                    ? <Badge>{state.strategies[c.name].fallbackStrategy}</Badge>
                    : <Toggle checked={isJev(c.name)} onChange={(on) => toggle(c.name, on)} disabled={busy || !state.connected} aria-label={`Jev routing for ${c.name}`} />}
                </li>
              ))}
            </ul>
          </div>
          {msg && <p className="text-sm text-text-muted" role="status">{msg}</p>}
        </div>
      )}
    </Card>
  );
}
