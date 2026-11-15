"use client";

import { useState } from "react";
import { Card, Button } from "@/shared/components";

export default function KnowledgeGraphPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  const rebuild = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/knowledge-graph", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) setError(json.error || `HTTP ${res.status}`);
      else setVersion((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Knowledge Graph"
      subtitle="Code map built locally by graphify (tree-sitter AST, no LLM). Each dot is a cluster of related modules."
      action={
        <Button variant="outline" size="sm" onClick={rebuild} disabled={busy} loading={busy} icon="refresh">
          Rebuild graph
        </Button>
      }
    >
      {error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <iframe
        key={version}
        src="/api/knowledge-graph"
        title="Knowledge Graph"
        className="block h-[calc(100svh-17rem)] min-h-[28rem] w-full rounded-lg border border-border bg-background"
      />
    </Card>
  );
}
