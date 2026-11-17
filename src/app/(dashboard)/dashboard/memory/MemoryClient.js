"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Badge, Toggle, Skeleton, Modal } from "@/shared/components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const OWNER_TYPES = ["user", "agent", "team", "project", "shared"];
const TYPES = ["working", "episodic", "semantic", "procedural", "preference", "shared"];
const TYPE_TONE = { working: "info", episodic: "primary", semantic: "default", procedural: "success", preference: "warning", shared: "default" };
const STATUS_TONE = { approved: "success", candidate: "warning", rejected: "error" };

const shortOwner = (id) => {
  const s = String(id ?? "");
  if (!s) return "";
  if (/^sk-/i.test(s)) return `${s.slice(0, 6)}…${s.slice(-4)}`;
  return s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s;
};

const timeAgo = (ts) => {
  const diff = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(diff)) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
};

const contentText = (c) => (Array.isArray(c) ? c.map((p) => (typeof p === "string" ? p : p?.text || "")).join("\n") : String(c ?? ""));
const splitTools = (text) => {
  const idx = text.indexOf("\n\nTools used:");
  return idx === -1 ? [text, ""] : [text.slice(0, idx), text.slice(idx + 2)];
};

const Th = ({ children, className = "" }) => (
  <th scope="col" className={`px-5 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground ${className}`}>{children}</th>
);

function FilterField({ label, children, className = "" }) {
  return (
    <label className={`flex flex-col gap-1 text-xs font-medium text-muted-foreground ${className}`}>
      {label}
      {children}
    </label>
  );
}

export default function MemoryClient() {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ownerType, setOwnerType] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
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
      if (status) qs.set("status", status);
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
  }, [ownerType, ownerId, type, status, limit]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const [cfg, setCfg] = useState({ memoryEnabled: false, memoryEmbeddingModel: "", memoryEvalEnabled: false, memoryEvalModel: "", memoryAutoApprove: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((s) => {
      setCfg({ memoryEnabled: !!s.memoryEnabled, memoryEmbeddingModel: s.memoryEmbeddingModel || "", memoryEvalEnabled: !!s.memoryEvalEnabled, memoryEvalModel: s.memoryEvalModel || "", memoryAutoApprove: !!s.memoryAutoApprove });
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

  const handleReview = async (id, nextStatus) => {
    try {
      const res = await fetch(`/api/memory/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
      if (!res.ok) throw new Error("Review failed");
      setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, metadata: { ...m.metadata, status: nextStatus } } : m)));
    } catch (e) {
      setError(e.message || "Review failed");
    }
  };

  const [sessionDetail, setSessionDetail] = useState(null);
  const [memDetail, setMemDetail] = useState(null);
  const openSession = async (s) => {
    setSessionDetail({ sessionId: s.sessionId, harness: s.harness, loading: true, turns: [] });
    try {
      const res = await fetch(`/api/memory/harness-turns/${encodeURIComponent(s.sessionId)}`);
      const data = await res.json();
      setSessionDetail({ sessionId: s.sessionId, harness: s.harness, loading: false, turns: data.turns || [], error: data.error });
    } catch (e) {
      setSessionDetail({ sessionId: s.sessionId, harness: s.harness, loading: false, turns: [], error: e.message });
    }
  };
  const openMemory = async (id) => {
    setMemDetail({ loading: true });
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(id)}`);
      const data = await res.json();
      setMemDetail(res.ok ? data : { error: data.error || "Failed to load" });
    } catch (e) {
      setMemDetail({ error: e.message || "Failed to load" });
    }
  };

  const [harness, setHarness] = useState([]);
  const [evaluating, setEvaluating] = useState("");
  const [evalMsg, setEvalMsg] = useState("");

  useEffect(() => {
    fetch("/api/memory/harness-turns").then((r) => r.json()).then((d) => setHarness(d.sessions || [])).catch(() => {});
  }, [reloadKey]);

  const evaluate = async (s) => {
    setEvaluating(s.sessionId);
    setEvalMsg("");
    try {
      const res = await fetch("/api/memory/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: s.sessionId, ownerType: "agent", ownerId: `harness:${s.harness}` }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Evaluate failed");
      setEvalMsg(data.candidateCreated ? `Candidate filed for ${s.sessionId}` : data.skipped || `Not filed (mean=${data.scores?.mean ?? "?"}, passed=${data.passed})`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setEvalMsg(e.message || "Evaluate failed");
    } finally {
      setEvaluating("");
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

  const filtersActive = Boolean(ownerType || ownerId || type || status);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]! text-muted-foreground">tune</span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Memory pipeline</h2>
              <p className="text-[13px] text-muted-foreground">Recall past work, then file what Jev judges worth keeping.</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => saveCfg({})} disabled={saving}>Save</Button>
        </div>
        <div className="grid gap-x-8 gap-y-4 px-5 py-4 sm:grid-cols-2">
          <Toggle label="Enable memory" description="Inject recalled memories and capture after each chat" checked={cfg.memoryEnabled} disabled={saving} onChange={(v) => saveCfg({ memoryEnabled: v })} />
          <Input label="Embedding model" hint="Empty = auto" value={cfg.memoryEmbeddingModel} onChange={(e) => setCfg((c) => ({ ...c, memoryEmbeddingModel: e.target.value }))} placeholder="gemini/gemini-embedding-001" />
          <Toggle label="Auto-file session candidates" description="Jev scores every session and files candidates for review" checked={cfg.memoryEvalEnabled} disabled={saving} onChange={(v) => saveCfg({ memoryEvalEnabled: v })} />
          <Toggle label="Auto-approve strong sessions" description="Jev task ≥ 0.90 and mean ≥ 0.85 skip review; everything else stays a candidate. Auto-approved rows can still be rejected." checked={cfg.memoryAutoApprove} disabled={saving || !cfg.memoryEvalEnabled} onChange={(v) => saveCfg({ memoryAutoApprove: v })} />
          <Input label="Evaluator model" hint="Empty = typesafe/jev-latest" value={cfg.memoryEvalModel} onChange={(e) => setCfg((c) => ({ ...c, memoryEvalModel: e.target.value }))} placeholder="typesafe/jev-latest" />
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]! text-muted-foreground">memory</span>
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">Harness sessions</h2>
              <p className="text-[13px] text-muted-foreground">Captured from coding agents through the ingest API.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {evalMsg && <span role="status" className="max-w-md truncate text-xs text-muted-foreground">{evalMsg}</span>}
            <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>Refresh</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] table-fixed text-sm">
            <colgroup>
              <col className="w-[7rem]" />
              <col />
              <col className="w-[5.5rem]" />
              <col className="w-[5.5rem]" />
              <col className="w-[8rem]" />
              <col className="w-[7rem]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b">
                <Th>Harness</Th>
                <Th>Session</Th>
                <Th className="text-right">Turns</Th>
                <Th className="text-right">Errors</Th>
                <Th>Last turn</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {harness.map((s) => (
                <tr key={s.sessionId} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-5 py-3"><Badge variant="info" size="sm">{s.harness}</Badge></td>
                  <td className="max-w-[14rem] truncate px-5 py-3 font-mono text-xs">
                    <button type="button" onClick={() => openSession(s)} className="rounded-sm break-all text-left underline-offset-2 hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring" title={s.sessionId}>{s.sessionId}</button>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{s.count}</td>
                  <td className={`px-5 py-3 text-right tabular-nums ${s.errors ? "font-medium text-destructive" : ""}`}>{s.errors}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{timeAgo(s.lastAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => openSession(s)}>View</Button>
                      <Button size="sm" variant="outline" onClick={() => evaluate(s)} loading={evaluating === s.sessionId}>Evaluate</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && harness.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-muted-foreground/50">terminal</span>
                    <p className="mt-2 text-sm font-medium">No harness sessions yet</p>
                    <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                      Coding agents post turns to <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">/api/v1/memory/ingest</code>, then appear here for evaluation.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]! text-muted-foreground">psychology</span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Memories</h2>
              <p className="text-[13px] text-muted-foreground">Reviewed knowledge, newest first.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <FilterField label="Owner type">
              <NativeSelect size="sm" aria-label="Owner type" className="min-w-[7rem]" value={ownerType} onChange={(e) => setOwnerType(e.target.value)}>
                <NativeSelectOption value="">all</NativeSelectOption>
                {OWNER_TYPES.map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}
              </NativeSelect>
            </FilterField>
            <FilterField label="Owner id" className="min-w-[12rem]">
              <Input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="agent id / user id" className="h-8" />
            </FilterField>
            <FilterField label="Status">
              <NativeSelect size="sm" aria-label="Status" className="min-w-[7rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
                <NativeSelectOption value="">all</NativeSelectOption>
                {["approved", "candidate", "rejected"].map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}
              </NativeSelect>
            </FilterField>
            <FilterField label="Type">
              <NativeSelect size="sm" aria-label="Type" className="min-w-[8rem]" value={type} onChange={(e) => setType(e.target.value)}>
                <NativeSelectOption value="">all</NativeSelectOption>
                {TYPES.map((t) => <NativeSelectOption key={t} value={t}>{t}</NativeSelectOption>)}
              </NativeSelect>
            </FilterField>
            <FilterField label="Limit" className="w-20">
              <Input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 100)} className="h-8" />
            </FilterField>
            <Button size="sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>Apply</Button>
          </div>
        </div>
        {error && (
          <div role="alert" className="mx-5 mt-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span aria-hidden="true" className="material-symbols-outlined text-[16px]">error</span>
            {error}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] table-fixed text-sm">
            <colgroup>
              <col />
              <col className="w-[13rem]" />
              <col className="w-[9rem]" />
              <col className="w-[7rem]" />
              <col className="w-[7rem]" />
              <col className="w-[5rem]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b">
                <Th>Memory</Th>
                <Th>Owner</Th>
                <Th>Status</Th>
                <Th className="text-right">Score</Th>
                <Th>Created</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td colSpan={6} className="px-5 py-3"><Skeleton className="h-4 w-2/3" /></td>
                </tr>
              ))}
              {!loading && memories.map((m) => {
                const status = m.metadata?.status ?? "approved";
                return (
                  <tr key={m.id} className={`border-b last:border-0 hover:bg-secondary/40 ${status === "candidate" ? "bg-amber-500/[0.05]" : ""}`}>
                    <td className="px-5 py-3 align-top">
                      <Badge size="sm" variant={TYPE_TONE[m.type] || "default"}>{m.type}</Badge>
                      <button
                        type="button"
                        onClick={() => openMemory(m.id)}
                        title={m.content}
                        className="mt-1 line-clamp-2 w-full rounded-sm text-left text-sm leading-5 break-words underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {m.content}
                      </button>
                    </td>
                    <td className="max-w-0 px-5 py-3 align-top">
                      <span className="font-mono text-xs break-all text-muted-foreground" title={m.ownerId}>{m.ownerType}:{shortOwner(m.ownerId)}</span>
                    </td>
                    <td className="px-5 py-3 align-top whitespace-nowrap">
                      {status === "candidate" ? (
                        <div className="flex gap-1.5">
                          <Button size="sm" onClick={() => handleReview(m.id, "approved")}>Approve</Button>
                          <Button size="sm" variant="outline" onClick={() => handleReview(m.id, "rejected")}>Reject</Button>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge size="sm" variant={STATUS_TONE[status] || "default"} dot>{status}</Badge>
                          {m.metadata?.autoApproved && status === "approved" && <Badge size="sm" variant="info" title={m.metadata.autoApproveReason}>auto</Badge>}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right align-top tabular-nums text-muted-foreground" title="Confidence · Importance · Version">
                      {Number(m.confidence).toFixed(2)} · {Number(m.importance).toFixed(2)}
                      <span className="block text-xs">v{m.version}</span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 align-top text-muted-foreground" title={new Date(m.createdAt).toLocaleString()}>{timeAgo(m.createdAt)}</td>
                    <td className="px-5 py-3 text-right align-top">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => openMemory(m.id)}>View</Button>
                        <Button size="sm" variant="ghost" icon="delete_outline" aria-label="Delete memory" onClick={() => handleDelete(m.id)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && memories.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-muted-foreground/50">library_books</span>
                    <p className="mt-2 text-sm font-medium">{filtersActive ? "No memories match these filters" : "No memories yet"}</p>
                    <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                      Chat sessions scored by Jev land here as candidates you can approve or reject.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={!!sessionDetail} onClose={() => setSessionDetail(null)} size="full"
        title={sessionDetail ? `Harness turn detail — ${sessionDetail.harness}` : ""}>
        {sessionDetail?.loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {sessionDetail?.error && <p role="alert" className="text-sm text-red-500">{sessionDetail.error}</p>}
        {!sessionDetail?.loading && !sessionDetail?.error && sessionDetail?.turns?.length === 0 && (
          <p className="text-sm text-muted-foreground">No turns captured for this session.</p>
        )}
        {sessionDetail?.turns?.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-xs break-all text-muted-foreground">Session {sessionDetail.sessionId}</p>
              <Badge size="sm" variant="info">{sessionDetail.turns.length} turn{sessionDetail.turns.length === 1 ? "" : "s"}</Badge>
            </div>
            {sessionDetail.turns.map((t, i) => {
              const prompt = t.request?.messages?.[0]?.content || "";
              const response = contentText(t.response?.content);
              const [answer, tools] = splitTools(response);
              return (
                <details key={i} className="rounded-md border border-border" open={sessionDetail.turns.length === 1 || i === sessionDetail.turns.length - 1}>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-secondary/40">
                    <Badge size="sm" variant={t.status === "error" ? "error" : "success"} dot>{t.status || "ok"}</Badge>
                    <span className="font-mono">{t.model || "harness-turn"}</span>
                    <span className="text-muted-foreground">· {timeAgo(t.timestamp)}</span>
                    <span className="ml-auto max-w-[60ch] truncate text-muted-foreground">{prompt.slice(0, 140)}</span>
                  </summary>
                  <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-secondary/40 p-3 text-xs leading-5">{prompt}</pre>
                    {answer && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-secondary/40 p-3 text-xs leading-5">{answer}</pre>}
                    {tools && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border p-3 text-xs leading-5 text-muted-foreground">{tools}</pre>}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal isOpen={!!memDetail} onClose={() => setMemDetail(null)} title="Memory detail" className="sm:max-w-5xl">
        {memDetail?.loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {memDetail?.error && <p role="alert" className="text-sm text-red-500">{memDetail.error}</p>}
        {!memDetail?.loading && !memDetail?.error && memDetail && (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge size="sm" variant={TYPE_TONE[memDetail.type] || "default"}>{memDetail.type}</Badge>
              <Badge size="sm" variant={STATUS_TONE[memDetail.metadata?.status] || "default"} dot>{memDetail.metadata?.status || "approved"}</Badge>
              <span className="text-xs text-muted-foreground tabular-nums">
                conf {Number(memDetail.confidence ?? 0).toFixed(2)} · imp {Number(memDetail.importance ?? 0).toFixed(2)} · v{memDetail.version}
              </span>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-secondary/40 p-3 text-xs leading-5">{memDetail.content}</pre>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Owner</dt><dd className="break-all font-mono">{memDetail.ownerType}:{memDetail.ownerId}</dd>
              <dt className="text-muted-foreground">Scope</dt><dd>{memDetail.scope || "—"}</dd>
              {(memDetail.keywords || []).length > 0 && (<><dt className="text-muted-foreground">Keywords</dt><dd>{memDetail.keywords.join(", ")}</dd></>)}
              {(memDetail.tags || []).length > 0 && (<><dt className="text-muted-foreground">Tags</dt><dd>{memDetail.tags.join(", ")}</dd></>)}
              {memDetail.metadata?.sessionId && (<><dt className="text-muted-foreground">Session</dt><dd className="break-all font-mono">{memDetail.metadata.sessionId}</dd></>)}
              {memDetail.metadata?.taskSuccess !== undefined && (<><dt className="text-muted-foreground">Scores</dt><dd className="tabular-nums">task {Number(memDetail.metadata.taskSuccess).toFixed(2)} · reusable {Number(memDetail.metadata.reusable).toFixed(2)} · evidence {Number(memDetail.metadata.evidence).toFixed(2)}{memDetail.metadata.mean !== undefined ? ` · mean ${Number(memDetail.metadata.mean).toFixed(2)}` : ""}</dd></>)}
              {memDetail.metadata?.providers?.length > 0 && (<><dt className="text-muted-foreground">Providers</dt><dd>{memDetail.metadata.providers.join(", ")}</dd></>)}
              {memDetail.metadata?.models?.length > 0 && (<><dt className="text-muted-foreground">Models</dt><dd>{memDetail.metadata.models.join(", ")}</dd></>)}
              {memDetail.metadata?.autoApproved && (<><dt className="text-muted-foreground">Approval</dt><dd>Auto-approved by Jev — {memDetail.metadata.autoApproveReason}</dd></>)}
              {memDetail.metadata?.evaluator && (<><dt className="text-muted-foreground">Evaluator</dt><dd>{memDetail.metadata.evaluator}</dd></>)}
              <dt className="text-muted-foreground">Created</dt><dd title={new Date(memDetail.createdAt).toLocaleString()}>{timeAgo(memDetail.createdAt)}</dd>
              <dt className="text-muted-foreground">Updated</dt><dd title={new Date(memDetail.updatedAt).toLocaleString()}>{memDetail.updatedAt ? timeAgo(memDetail.updatedAt) : "—"}</dd>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  );
}
