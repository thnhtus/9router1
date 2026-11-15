"use client";

import { useState, useEffect } from "react";
import { Card } from "@/shared/components";

// Read-only view of the instructions sent to Jev on every route decision.
export default function JevPromptCard() {
  const [prompts, setPrompts] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/jev/prompt")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setPrompts)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <Card title="Jev prompt" subtitle="Instructions sent to Jev with each request. Candidate models and their profiles are appended as criteria.">
      {error && <p className="text-sm text-text-muted" role="status">{error}</p>}
      {!prompts && !error && <p className="text-sm text-text-muted">Loading…</p>}
      {prompts && (
        <div className="flex flex-col gap-4">
          {Object.entries(prompts).map(([name, text]) => (
            <div key={name}>
              <p className="mb-1 text-sm font-medium">{name}</p>
              <pre className="whitespace-pre-wrap break-words rounded border border-border bg-black/5 p-3 font-mono text-xs dark:bg-white/5">{text}</pre>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
