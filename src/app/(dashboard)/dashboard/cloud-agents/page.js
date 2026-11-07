"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";

export default function CloudAgentsPage() {
  const [tasks, setTasks] = useState([]);
  const [provider, setProvider] = useState("codex");
  const [prompt, setPrompt] = useState("");
  const [providers, setProviders] = useState([]);

  const load = () => fetch("/api/cloud-agents").then((r) => r.ok ? r.json() : null).then((d) => { if (d) { setTasks(d.tasks || []); setProviders(d.providers || []); } });

  useEffect(() => { load(); }, []);

  const submit = async () => {
    await fetch("/api/cloud-agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, prompt }) });
    setPrompt("");
    load();
  };

  return (
    <div className="mx-auto flex w-full flex-col gap-6">
      <h1 className="text-lg font-semibold text-foreground">Cloud Agents</h1>
      <Card padding="md">
        <div className="flex gap-2">
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="border rounded px-2 py-1 text-sm">
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Task prompt" className="flex-1 border rounded px-2 py-1 text-sm" />
          <button onClick={submit} className="px-3 py-1 bg-primary text-white rounded text-sm">Dispatch</button>
        </div>
      </Card>
      <div className="flex flex-col gap-2">
        {tasks.map((t) => (
          <Card key={t.id} padding="sm">
            <div className="text-sm font-medium">{t.provider} — {t.status}</div>
            <div className="text-xs text-muted-foreground">{t.prompt}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
