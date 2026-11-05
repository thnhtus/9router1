"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Card from "@/shared/components/Card";

const ByAgentChart = dynamic(() => import("@/app/(dashboard)/dashboard/usage/components/ByAgentChart"), { ssr: false });

// Standalone monitor: live requests tagged with x-rig/x-seat (from pi-openrig seats), separate from the general Usage page.
export default function AgentsPage() {
  const [byAgent, setByAgent] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/usage/stats?period=today")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setByAgent(d.byAgent || {}))
      .finally(() => setLoading(false));

    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.byAgent) setByAgent(data.byAgent);
      } catch {}
    };
    es.onerror = () => setLoading(false);
    return () => es.close();
  }, []);

  const hasAny = Object.keys(byAgent).length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Agents (Rig / Seat)</h1>
        <p className="text-sm text-muted-foreground">Requests tagged with x-rig / x-seat headers (e.g. pi-openrig seats), live.</p>
      </div>

      {!loading && !hasAny && (
        <Card padding="md"><p className="text-sm text-muted-foreground">No tagged rig/seat traffic yet. Requests sent with x-rig and x-seat headers will show up here in real time.</p></Card>
      )}

      {hasAny && (
        <div className="min-w-0">
          <ByAgentChart byAgent={byAgent} />
        </div>
      )}
    </div>
  );
}
