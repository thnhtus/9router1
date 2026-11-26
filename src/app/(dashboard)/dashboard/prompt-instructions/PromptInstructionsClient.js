"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Button, Input, Toggle, Modal, ConfirmModal } from "@/shared/components";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CAVEMAN_PROMPTS } from "../../../../../open-sse/rtk/cavemanPrompts";
import { PONYTAIL_PROMPTS } from "../../../../../open-sse/rtk/ponytailPrompt";
import { buildPromptSources } from "@/lib/promptSources";
import { buildSampleRequest } from "@/lib/sampleRequest";

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const SCOPES = [
  { id: "global", label: "All providers" },
  { id: "provider", label: "Specific provider" },
  { id: "model", label: "Specific model" },
];

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(diff)) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  if (days < 7) return days + "d ago";
  return new Date(ts).toLocaleDateString();
}

const emptyForm = {
  id: null,
  name: "",
  text: "",
  scope: "global",
  target: "",
  priority: 0,
  enabled: true,
};

export default function PromptInstructionsClient() {
  const [items, setItems] = useState([]);
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [settings, setSettings] = useState(null);
  const [jevPrompts, setJevPrompts] = useState(null);
  const [sourceDetail, setSourceDetail] = useState(null);
  const [sampleFormat, setSampleFormat] = useState("openai");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        headers: { "Cache-Control": "no-store" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data && data.error ? data.error : "Failed to load");
      let list = Array.isArray(data.promptInstructions) ? data.promptInstructions : [];
      if (
        list.length === 0 &&
        data.customPromptEnabled &&
        typeof data.customPrompt === "string" &&
        data.customPrompt.trim()
      ) {
        list = [
          {
            id: uid(),
            name: "Custom system prompt",
            text: data.customPrompt,
            scope: "global",
            target: "",
            priority: 0,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ];
      }
      const migrated = list.length > 0 && (!Array.isArray(data.promptInstructions) || data.promptInstructions.length === 0) && !!data.customPromptEnabled && typeof data.customPrompt === "string" && data.customPrompt.trim();
      setItems(list);
      setMasterEnabled(migrated ? true : !!data.promptInstructionsEnabled);
      setSettings(data);
      try {
        const jr = await fetch("/api/jev/prompt", { headers: { "Cache-Control": "no-store" } });
        if (jr.ok) setJevPrompts(await jr.json());
      } catch {
        // optional source
      }
      if (migrated) {
        try {
          await fetch("/api/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              promptInstructions: list,
              promptInstructionsEnabled: true,
              customPromptEnabled: false,
            }),
          });
        } catch {
          // ignore; client still shows seeded list
        }
      }
    } catch (e) {
      setError((e && e.message) || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const patchSettings = useCallback(async (patch) => {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data && data.error ? data.error : "Save failed");
    }
    return res.json();
  }, []);

  const saveItems = useCallback(
    async (next) => {
      setSaving(true);
      setError("");
      try {
        await patchSettings({ promptInstructions: next });
        setItems(next);
        return true;
      } catch (e) {
        setError((e && e.message) || "Save failed");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [patchSettings]
  );

  const toggleMaster = useCallback(
    async (v) => {
      setMasterEnabled(v);
      try {
        await patchSettings({ promptInstructionsEnabled: v });
      } catch (e) {
        setMasterEnabled(!v);
        setError((e && e.message) || "Save failed");
      }
    },
    [patchSettings]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      (it.name || "").toLowerCase().includes(q) ||
      (it.text || "").toLowerCase().includes(q) ||
      (it.scope || "").toLowerCase().includes(q) ||
      (it.target || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const openNew = () => {
    setForm({ ...emptyForm, id: uid() });
    setEditing("new");
  };

  const openEdit = (item) => {
    setForm({
      id: item.id,
      name: item.name || "",
      text: item.text || "",
      scope: item.scope || "global",
      target: item.target || "",
      priority: item.priority != null ? item.priority : 0,
      enabled: !!item.enabled,
    });
    setEditing(item.id);
  };

  const closeEditor = () => {
    setEditing(null);
    setForm(emptyForm);
  };

  const saveForm = useCallback(async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    if (!form.text.trim()) {
      setError("Text is required");
      return;
    }
    const now = new Date().toISOString();
    const prev = items.find((i) => i.id === form.id);
    const nextItem = {
      id: form.id || uid(),
      name: form.name.trim(),
      text: form.text,
      scope: form.scope,
      target: form.scope === "global" ? "" : form.target.trim(),
      priority: Number.isFinite(Number(form.priority)) ? Number(form.priority) : 0,
      enabled: !!form.enabled,
      createdAt: prev ? prev.createdAt : now,
      updatedAt: now,
    };
    const next = items.some((i) => i.id === nextItem.id)
      ? items.map((i) => (i.id === nextItem.id ? nextItem : i))
      : [...items, nextItem];
    try {
      const ok = await saveItems(next);
      if (ok) closeEditor();
    } catch {
      // error already set
    }
  }, [form, items, saveItems]);

  const toggleItem = useCallback(
    async (id, value) => {
      const next = items.map((i) =>
        i.id === id ? { ...i, enabled: value, updatedAt: new Date().toISOString() } : i
      );
      await saveItems(next);
    },
    [items, saveItems]
  );

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    const next = items.filter((i) => i.id !== id);
    await saveItems(next);
  }, [confirmDelete, items, saveItems]);

  const sources = useMemo(() => buildPromptSources(settings, items), [settings, items]);
  const sample = useMemo(() => buildSampleRequest(settings, items, { format: sampleFormat, provider: "openai", model: "gpt-4o", userText: "Fix the login bug in src/app/auth.js" }), [settings, items, sampleFormat]);

  const scopeLabel = (item) => {
    if (item.scope === "global") return "Global";
    if (item.scope === "provider") return "Provider: " + (item.target || "?");
    if (item.scope === "model") return "Model: " + (item.target || "?");
    return item.scope || "—";
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]! text-muted-foreground">
              edit_note
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Prompt instructions</h2>
              <p className="text-[13px] text-muted-foreground">
                Named instructions injected into requests. Enabled items are appended to every matching request.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
            <Toggle label="Enable" checked={masterEnabled} onChange={toggleMaster} aria-label="Enable prompt instructions" />
            <Button size="sm" onClick={openNew}>New instruction</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b">
          <Input className="max-w-sm" placeholder="Search name, text, scope…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="text-xs text-muted-foreground">{filtered.length} of {items.length}</span>
        </div>
        {error && <div className="px-5 py-2 text-xs text-destructive">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] table-fixed text-sm">
            <colgroup>
              <col className="w-[14rem]" />
              <col className="w-[12rem]" />
              <col className="w-[7rem]" />
              <col className="w-[8rem]" />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b">
                <th scope="col" className="px-5 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">Name</th>
                <th scope="col" className="px-5 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">Scope</th>
                <th scope="col" className="px-5 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">Priority</th>
                <th scope="col" className="px-5 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">Updated</th>
                <th scope="col" className="px-5 py-2.5 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">No prompt instructions yet.</td></tr>
              )}
              {filtered.map((item) => (
                <tr key={item.id} className="border-b last:border-0 hover:bg-secondary/40 cursor-pointer" onClick={() => openEdit(item)}>
                  <td className="px-5 py-3 font-medium truncate">{item.name}</td>
                  <td className="px-5 py-3 text-muted-foreground truncate">{scopeLabel(item)}</td>
                  <td className="px-5 py-3 tabular-nums">{item.priority != null ? item.priority : 0}</td>
                  <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">{timeAgo(item.updatedAt)}</td>
                  <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <Toggle checked={!!item.enabled} onChange={(v) => toggleItem(item.id, v)} aria-label={"Toggle " + item.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]! text-muted-foreground">
              source
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Prompt sources</h2>
              <p className="text-[13px] text-muted-foreground">
                Every prompt source the proxy can inject into requests, and where each is configured.
              </p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] table-fixed text-sm">
            <colgroup>
              <col className="w-[14rem]" />
              <col className="w-[10rem]" />
              <col className="w-[12rem]" />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b">
                <th scope="col" className="px-5 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">Source</th>
                <th scope="col" className="px-5 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">Status</th>
                <th scope="col" className="px-5 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">Summary</th>
                <th scope="col" className="px-5 py-2.5 text-right text-xs font-medium whitespace-nowrap text-muted-foreground" aria-label="Open detail"><span className="sr-only">Open detail</span></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => (
                <tr key={src.id} className="border-b last:border-0 hover:bg-secondary/40 cursor-pointer" onClick={() => setSourceDetail(src.id)}>
                  <td className="px-5 py-3 font-medium truncate">
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]! text-muted-foreground mr-2 align-middle">
                      {src.icon}
                    </span>
                    {src.name}
                    {src.readOnly && <span className="ml-1 text-xs text-muted-foreground">(read-only)</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-xs " + (src.active ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                      {src.active ? "Active" : "Off"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground truncate">{src.summary}</td>
                  <td className="px-5 py-3 text-right text-muted-foreground">
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]!">chevron_right</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]! text-muted-foreground">
              data_object
            </span>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Sample request</h2>
              <p className="text-[13px] text-muted-foreground">
                How the outgoing request body looks after all active prompt sources are injected.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Format</span>
            <NativeSelect value={sampleFormat} onChange={(e) => setSampleFormat(e.target.value)}>
              <NativeSelectOption value="openai">OpenAI (chat)</NativeSelectOption>
              <NativeSelectOption value="claude">Claude</NativeSelectOption>
              <NativeSelectOption value="gemini">Gemini</NativeSelectOption>
              <NativeSelectOption value="responses">OpenAI Responses</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b text-xs text-muted-foreground">
          <span>Injected:</span>
          {sample.injected.length === 0 ? (
            <span>none</span>
          ) : (
            sample.injected.map((x) => (
              <span key={x.source} className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                {x.source}
              </span>
            ))
          )}
          <span className="ml-auto">model openai/gpt-4o · user message &quot;Fix the login bug…&quot;</span>
        </div>
        <pre className="max-h-[32rem] overflow-auto px-5 py-4 text-xs font-mono whitespace-pre-wrap break-words">
{JSON.stringify(sample.body, null, 2)}
        </pre>
      </Card>

      <Modal isOpen={!!sourceDetail} onClose={() => setSourceDetail(null)} title={(() => { const s = sources.find((x) => x.id === sourceDetail); return s ? s.name : "Source detail"; })()} size="lg">
        {(() => {
          const src = sources.find((x) => x.id === sourceDetail);
          if (!src) return null;
          const d = src.detail;
          if (d.kind === "instructions") {
            const list = items || [];
            return (
              <div className="flex flex-col gap-3">
                {list.length === 0 && <p className="text-sm text-muted-foreground">No entries.</p>}
                {list.map((it) => (
                  <div key={it.id} className="border rounded p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{it.name}</span>
                      <span className="text-xs text-muted-foreground">{it.scope}{it.target ? " · " + it.target : ""}</span>
                      <span className={"ml-auto text-xs " + (it.enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{it.enabled ? "Enabled" : "Disabled"}</span>
                    </div>
                    <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto">{it.text}</pre>
                  </div>
                ))}
              </div>
            );
          }
          if (d.kind === "text") {
            return (
              <div className="flex flex-col gap-3">
                {d.text ? <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-64 overflow-auto">{d.text}</pre> : <p className="text-sm text-muted-foreground">Empty.</p>}
                {d.note ? <p className="text-xs text-muted-foreground">{d.note}</p> : null}
              </div>
            );
          }
          if (d.kind === "builtin") {
            const prompts = d.key === "caveman" ? CAVEMAN_PROMPTS : PONYTAIL_PROMPTS;
            const text = prompts && prompts[d.level] ? prompts[d.level] : (prompts && Object.values(prompts)[0]) || "";
            return (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">Level: {d.level}. Actual injection also requires the request-level Token Saver switch not to be disabled.</p>
                <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-64 overflow-auto">{text}</pre>
              </div>
            );
          }
          if (d.kind === "jev") {
            const jp = jevPrompts || {};
            return (
              <div className="flex flex-col gap-3">
                {Object.keys(jp).length === 0 && <p className="text-sm text-muted-foreground">Loading…</p>}
                {Object.entries(jp).map(([k, v]) => (
                  <div key={k} className="border rounded p-3">
                    <p className="font-medium text-sm mb-1">{k}</p>
                    <pre className="text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-auto">{String(v)}</pre>
                  </div>
                ))}
              </div>
            );
          }
          return null;
        })()}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={() => setSourceDetail(null)}>Close</Button>
        </div>
      </Modal>

      <Modal isOpen={!!editing} onClose={closeEditor} title={editing === "new" ? "New prompt instruction" : "Edit prompt instruction"} size="lg">
        <div className="flex flex-col gap-4">
          <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Prefer editing existing files" />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-foreground">Scope</label>
            <NativeSelect value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}>
              {SCOPES.map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>{s.label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {form.scope !== "global" && (
            <Input
              label={form.scope === "provider" ? "Provider id" : "Model id (provider/model)"}
              value={form.target}
              onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
              placeholder={form.scope === "provider" ? "openai" : "openai/gpt-4o"}
            />
          )}
          <Input label="Priority" type="number" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} hint="Lower runs first" />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-foreground">Text</label>
            <textarea value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} rows={8} className="w-full rounded border border-border bg-transparent p-2 text-xs font-mono" placeholder="Instruction text injected into the system message…" />
          </div>
          <Toggle label="Enabled" checked={!!form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
        </div>
        <div className="mt-4 flex justify-between">
          {editing !== "new" && (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete({ id: form.id, name: form.name })}>Delete</Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={closeEditor} disabled={saving}>Cancel</Button>
            <Button onClick={saveForm} loading={saving}>Save</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={doDelete}
        title="Delete instruction"
        message={"Delete \"" + (confirmDelete && confirmDelete.name) + "\"?"}
        confirmText="Delete"
        variant="danger"
        loading={saving}
      />
    </div>
  );
}
