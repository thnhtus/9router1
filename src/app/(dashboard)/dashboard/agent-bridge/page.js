"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";

const Badge = ({ ok, yes, no }) => (
  <span className={ok ? "text-success" : "text-muted-foreground"}>{ok ? yes : no}</span>
);

export default function AgentBridgePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/api/agent-bridge")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="mx-auto flex w-full flex-col gap-6">
      <h1 className="text-lg font-semibold text-foreground">Agent Bridge</h1>
      <Card padding="md">
        {error && <p className="text-sm text-destructive">Could not load status.</p>}
        {!error && !data && "Loading..."}
        {data && (
          <div className="flex flex-col gap-4 text-sm">
            <p>
              MITM server: <Badge ok={data.running} yes="running" no="stopped" />
              {data.running && data.pid ? ` (pid ${data.pid})` : ""} · Root CA:{" "}
              <Badge ok={data.certTrusted} yes="trusted" no={data.certExists ? "not trusted" : "missing"} />
            </p>
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-2">IDE agent</th>
                  <th>Domain</th>
                  <th>DNS</th>
                  <th>Aliases</th>
                </tr>
              </thead>
              <tbody>
                {data.tools.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-2 font-medium">{t.name}</td>
                    <td className="font-mono">{t.domain}</td>
                    <td><Badge ok={t.dnsActive} yes="on" no="off" /></td>
                    <td>{t.aliasCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
