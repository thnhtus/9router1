"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";

export default function CLIAgentsPage() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/cli-agents")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setAgents(d.agents || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="mx-auto flex w-full flex-col gap-6">
      <h1 className="text-lg font-semibold text-foreground">CLI Agents</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {agents.map((a) => (
          <Card key={a.id} padding="md">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">{a.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${a.installed ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"}`}>
                {a.installed ? "Installed" : a.status === "gui-only" ? "GUI" : "Not found"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">{a.bin || "—"}</div>
            {a.version && <div className="text-xs text-muted-foreground mt-1 font-mono">{a.version}</div>}
            <div className="text-[10px] text-muted-foreground mt-1">protocol: {a.protocol}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
