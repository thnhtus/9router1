"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Badge } from "@/shared/components";

const OWNER_TYPES = ["user", "agent", "team", "project", "shared"];
const TYPES = ["working", "episodic", "semantic", "procedural", "preference", "shared"];

export default function MemoryClient() {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ownerType, setOwnerType] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [type, setType] = useState("");
  const [limit, setLimit] = useState(100);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (ownerType) qs.set("ownerType", ownerType);
      if (ownerId) qs.set("ownerId", ownerId);
      if (type) qs.set("type", type);
      qs.set("limit", String(limit));
      const res = await fetch(`/api/memory?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setMemories(data.memories || []);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [ownerType, ownerId, type, limit]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const [cfg, setCfg] = useState({ memoryEnabled: false, memoryEmbeddingModel: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((s) => {
      setCfg({ memoryEnabled: !!s.memoryEnabled, memoryEmbeddingModel: s.memoryEmbeddingModel || "" });
    }).catch(() => {});
  }, []);

  const saveCfg = async (patch) => {
    const next = { ...cfg, ...patch };
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      if (!res.ok) throw new Error("Save failed");
      setCfg(next);
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this memory?")) return;
    try {
      const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setError(e.message || "Delete failed");
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Agent Memory</h1>
        <Button onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>Refresh</Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.memoryEnabled} disabled={saving} onChange={(e) => saveCfg({ memoryEnabled: e.target.checked })} />
            Enable memory (inject recalled memories + capture after each chat)
          </label>
          <div>
            <label htmlFor="mem-embed-model" className="block text-xs mb-1">Embedding model (empty = auto)</label>
            <Input id="mem-embed-model" value={cfg.memoryEmbeddingModel} onChange={(e) => setCfg((c) => ({ ...c, memoryEmbeddingModel: e.target.value }))} placeholder="gemini/gemini-embedding-001" className="w-72" />
          </div>
          <Button onClick={() => saveCfg({})} disabled={saving}>Save</Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs mb-1">Owner type</label>
            <select className="border rounded px-2 py-1 text-sm" value={ownerType} onChange={(e) => setOwnerType(e.target.value)}>
              <option value="">all</option>
              {OWNER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1">Owner id</label>
            <Input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="agent id / user id" className="w-48" />
          </div>
          <div>
            <label className="block text-xs mb-1">Type</label>
            <select className="border rounded px-2 py-1 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">all</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1">Limit</label>
            <Input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 100)} className="w-20" />
          </div>
          <Button onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>Apply</Button>
        </div>
      </Card>

      {error && <div className="text-red-500 text-sm">{error}</div>}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2">Owner</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Content</th>
                <th className="text-left p-2">Confidence</th>
                <th className="text-left p-2">Importance</th>
                <th className="text-left p-2">Version</th>
                <th className="text-left p-2">Created</th>
                <th className="text-left p-2"></th>
              </tr>
            </thead>
            <tbody>
              {memories.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{m.ownerType}:{m.ownerId}</td>
                  <td className="p-2"><Badge>{m.type}</Badge></td>
                  <td className="p-2 max-w-md truncate" title={m.content}>{m.content}</td>
                  <td className="p-2">{Number(m.confidence).toFixed(2)}</td>
                  <td className="p-2">{Number(m.importance).toFixed(2)}</td>
                  <td className="p-2">{m.version}</td>
                  <td className="p-2 whitespace-nowrap">{new Date(m.createdAt).toLocaleString()}</td>
                  <td className="p-2">
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(m.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
              {memories.length === 0 && !loading && (
                <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No memories</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}