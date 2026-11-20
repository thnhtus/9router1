"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Button, Modal, Input, Select, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import SkillPickStats from "./SkillPickStats";
import McpStats from "./McpStats";

const SKILL_DOT = {
  ok: "bg-green-500",
  "no-description": "bg-amber-500",
  "missing-SKILL.md": "bg-red-500",
};

const SKILL_HINT = {
  "no-description": "SKILL.md has no description frontmatter",
  "missing-SKILL.md": "No SKILL.md in this folder",
};

const STATE_DOT = {
  ready: "bg-green-500",
  installed: "bg-amber-500",
  "never connected": "bg-muted-foreground/40",
  missing: "bg-red-500",
};

const STATE_HINT = {
  ready: "Connected before — tools cached",
  installed: "Command found on PATH, not connected yet",
  "never connected": "Configured but never connected from Pi",
  missing: "Command not found on this machine",
};

// 80+ = A, 60-79 = B, <60 = C, empty = unrated
const gradeOf = (v) => (v === "" || v == null ? "" : Number(v) >= 80 ? "A" : Number(v) >= 60 ? "B" : "C");

const GRADE_TEXT = {
  A: "text-green-500",
  B: "text-amber-500",
  C: "text-red-500",
};

const TH = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap";
const TD = "px-3 py-1.5 align-middle";

export default function PiInventoryCards() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [ratings, setRatings] = useState({});
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [query, setQuery] = useState("");
  const [llmOpen, setLlmOpen] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmMode, setLlmMode] = useState("route");
  const [llmResult, setLlmResult] = useState(null);
  const [llmError, setLlmError] = useState(null);
  const { copy } = useCopyToClipboard();
  const [copiedKey, setCopiedKey] = useState(null);
  const [detail, setDetail] = useState(null);
  const [skillDoc, setSkillDoc] = useState(null);
  const [skillCfg, setSkillCfg] = useState({ skillAutoInject: false, skillPickMode: "llm", skillMaxSkills: 2, skillMaxChars: 8000, skillMinConfidence: 0.3 });

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      setSkillCfg((c) => Object.fromEntries(Object.keys(c).map((k) => [k, d[k] ?? c[k]])));
    }).catch(() => {});
  }, []);

  // Persist one skill setting. Numbers are clamped so a bad value never reaches the router.
  const saveSkillField = (key, value, [min, max] = []) => {
    let v = value;
    if (min != null) v = Math.min(max, Math.max(min, Number(value) || min));
    setSkillCfg((c) => ({ ...c, [key]: v }));
    fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: v }) }).catch(() => {});
  };

  const openDetail = (kind, item) => {
    setDetail({ kind, item });
    setSkillDoc(null);
    if (kind !== "skill") return;
    setSkillDoc({ loading: true });
    fetch(`/api/cli-tools/pi-settings/skill-content?path=${encodeURIComponent(`${item.root}/${item.name}`)}`)
      .then(async (res) => {
        const d = await res.json();
        if (!res.ok) throw new Error(d?.error?.message || `HTTP ${res.status}`);
        setSkillDoc((cur) => (cur?.loading ? d : cur));
      })
      .catch((err) => setSkillDoc((cur) => (cur?.loading ? { error: err.message } : cur)));
  };

  useEffect(() => {
    let active = true;
    fetch("/api/cli-tools/pi-settings")
      .then((res) => res.json())
      .then((d) => {
        if (active) setData(d);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    fetch("/api/cli-tools/pi-settings/skill-ratings")
      .then((res) => res.json())
      .then((d) => {
        if (active) setRatings(d?.ratings || {});
      })
      .catch(() => {
        /* ratings optional */
      });
    return () => {
      active = false;
    };
  }, []);

  const mcpServers = data?.mcpServers || [];
  const mcpRequestTotals = data?.mcpCallTotals || {};
  const duplicates = data?.duplicates || {};
  const sameNameRoots = new Map((duplicates.sameName || []).map((g) => [g.name, g.roots]));
  const closeWith = duplicates.closeWith || {};

  const allSkills = useMemo(() => {
    const roots = data?.skills || [];
    return roots.flatMap((root) =>
      (root.skills || []).map((s) => ({ ...s, root: root.path, key: `${root.path}:${s.name}` }))
    );
  }, [data?.skills]);

  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allSkills;
    return allSkills.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q)
    );
  }, [allSkills, query]);

  const valueOf = (key, s) => {
    const stored = ratings[key]?.score ?? null;
    if (key in draft) return draft[key];
    return stored == null ? (s.autoScore == null ? "" : String(s.autoScore)) : String(stored);
  };

  const dirtyKeys = Object.keys(draft).filter((k) => draft[k] !== (ratings[k]?.score == null ? "" : String(ratings[k].score)));

  const runLlm = async (mode, targets) => {
    setLlmMode(mode);
    setLlmBusy(true);
    setLlmError(null);
    setLlmResult(null);
    try {
      const res = await fetch("/api/cli-tools/pi-settings/skill-llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          skills: targets.map((s) => ({ key: s.key, name: s.name, description: s.description })),
          catalog: [...new Map(allSkills.map((s) => [s.name, { name: s.name, description: s.description }])).values()],
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message || d?.error || `HTTP ${res.status}`);
      setLlmResult(d);
    } catch (err) {
      setLlmError(err.message);
    } finally {
      setLlmBusy(false);
    }
  };

  const copyText = (text, key) => {
    copy(text, key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSaveRatings = async () => {
    if (dirtyKeys.length === 0) return;
    const payload = {};
    for (const key of dirtyKeys) {
      const raw = (draft[key] ?? "").trim();
      payload[key] = raw === "" ? null : Number(raw);
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/cli-tools/pi-settings/skill-ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratings: payload }),
      });
      const d = await res.json();
      if (res.ok) {
        setRatings(d?.ratings || {});
        setDraft({});
        setSaveMsg(`Saved ${dirtyKeys.length} rating(s)`);
        setTimeout(() => setSaveMsg(null), 2500);
      } else {
        setSaveMsg(d?.error?.message || "Failed to save ratings.");
      }
    } catch (err) {
      setSaveMsg(err.message || "Failed to save ratings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card padding="md" title="Pi skill auto-inject" subtitle="Adds the best-matching local SKILL.md to each request. Smart combos: Jev picks the skill." icon="auto_awesome">
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium">Enabled</span>
            <Toggle checked={skillCfg.skillAutoInject} onChange={(v) => saveSkillField("skillAutoInject", v)} aria-label="Auto-inject Pi skills" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Select
              label="Pick mode"
              value={skillCfg.skillPickMode}
              onChange={(e) => saveSkillField("skillPickMode", e.target.value)}
              options={[{ value: "llm", label: "LLM" }, { value: "embedding", label: "Embedding" }]}
            />
            <Input
              label="Max skills"
              type="number"
              min={1}
              max={5}
              value={skillCfg.skillMaxSkills}
              onChange={(e) => setSkillCfg((c) => ({ ...c, skillMaxSkills: e.target.value }))}
              onBlur={(e) => saveSkillField("skillMaxSkills", e.target.value, [1, 5])}
            />
            <Input
              label="Max chars"
              type="number"
              min={500}
              max={50000}
              value={skillCfg.skillMaxChars}
              onChange={(e) => setSkillCfg((c) => ({ ...c, skillMaxChars: e.target.value }))}
              onBlur={(e) => saveSkillField("skillMaxChars", e.target.value, [500, 50000])}
            />
            {skillCfg.skillPickMode === "embedding" && (
              <Input
                label="Min similarity"
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={skillCfg.skillMinConfidence}
                onChange={(e) => setSkillCfg((c) => ({ ...c, skillMinConfidence: e.target.value }))}
                onBlur={(e) => saveSkillField("skillMinConfidence", e.target.value, [0, 1])}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            LLM mode costs one extra model call per request. Embedding mode is local and needs a memory embedding model. Skipped when the client already sends its own skill catalog.
          </p>
        </div>
      </Card>
      <SkillPickStats />
      {mcpServers.length > 0 && <McpStats servers={mcpServers} requests={mcpRequestTotals} />}
      <Card
        padding="none"
        title="Pi MCP servers"
        subtitle={`From ~/.pi/agent/mcp-adapter.json — ${mcpServers.length} configured`}
        icon="extension"
        className="[&>div:first-child]:px-5 [&>div:first-child]:pt-5 [&>div:first-child]:pb-3"
        action={<span className="text-[11px] tabular-nums text-muted-foreground">{mcpServers.length} servers</span>}
      >
        {error && <p className="px-5 pb-5 text-sm text-muted-foreground">Failed to load: {error}</p>}
        {!error && !data && <p className="px-5 pb-5 text-sm text-muted-foreground">Loading…</p>}
        {!error && data && mcpServers.length === 0 && (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No MCP servers configured.</p>
        )}
        {!error && mcpServers.length > 0 && (
          <div className="max-h-80 overflow-auto border-t border-black/[0.06] dark:border-white/[0.07]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className={TH}>Server</th>
                  <th className={TH}>Category</th>
                  <th className={TH}>Transport</th>
                  <th className={TH}>State</th>
                  <th className={`${TH} text-right`}>Tools</th>
                  <th className={TH}>Target</th>
                </tr>
              </thead>
              <tbody>
                {mcpServers.map((s) => (
                  <tr
                    key={s.name}
                    onClick={() => openDetail("mcp", s)}
                    className="cursor-pointer border-t border-black/[0.04] hover:bg-black/[0.03] dark:border-white/[0.05] dark:hover:bg-white/[0.04]"
                  >
                    <td className={`${TD} font-medium text-foreground whitespace-nowrap`}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[s.state] || "bg-muted-foreground/40"}`}
                        />
                        {s.name}
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-white/10">{s.category || "Other"}</span>
                    </td>
                    <td className={TD}>
                      <span className="rounded bg-black/5 px-1 text-[10px] uppercase text-muted-foreground dark:bg-white/10">
                        {s.transport}
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`} title={STATE_HINT[s.state] || s.state}>
                      {s.state}
                    </td>
                    <td className={`${TD} text-right tabular-nums text-muted-foreground`}>{s.tools ?? "—"}</td>
                    <td className={`${TD} max-w-0`}>
                      <span className="block truncate text-muted-foreground/70" title={s.target}>
                        {s.target}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        padding="none"
        title="Pi skills"
        subtitle={`From .pi/agent/skills, .claude/skills, .agents/skills — ${allSkills.length} total`}
        icon="school"
        className="[&>div:first-child]:px-5 [&>div:first-child]:pt-5 [&>div:first-child]:pb-3"
        action={
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="h-7 w-36 rounded border border-black/10 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
            />
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {dirtyKeys.length ? `${dirtyKeys.length} unsaved` : saveMsg || "saved"}
            </span>
            <Button size="sm" onClick={handleSaveRatings} disabled={saving || dirtyKeys.length === 0}>
              {saving ? "Saving…" : "Save ratings"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLlmOpen(true)}>
              LLM routing check
            </Button>
          </div>
        }
      >
        {error && <p className="px-5 pb-5 text-sm text-muted-foreground">Failed to load: {error}</p>}
        {!error && !data && <p className="px-5 pb-5 text-sm text-muted-foreground">Loading…</p>}
        {!error && data && allSkills.length === 0 && (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No skills found.</p>
        )}
        {!error && (duplicates.sameName?.length || duplicates.closePairs?.length) ? (
          <p className="px-5 pb-2 text-xs text-amber-500">
            {duplicates.sameName?.length ? `${duplicates.sameName.length} skill names appear in multiple roots` : ""}
            {duplicates.sameName?.length && duplicates.closePairs?.length ? " · " : ""}
            {duplicates.closePairs?.length ? `${duplicates.closePairs.length} description pairs look similar` : ""}
            {" — Pi may load or pick the wrong one."}
          </p>
        ) : null}
        {!error && allSkills.length > 0 && (
          <div className="max-h-[32rem] overflow-auto border-t border-black/[0.06] dark:border-white/[0.07]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className={TH}>Skill</th>
                  <th className={TH}>Source</th>
                  <th className={TH}>Category</th>
                  <th className={TH}>Status</th>
                  <th className={`${TH} text-center`}>Score</th>
                  <th className={TH}>Grade</th>
                  <th className={TH}>Description</th>
                </tr>
              </thead>
              <tbody>
                {visibleSkills.map((s) => {
                  const value = valueOf(s.key, s);
                  const dirty = s.key in draft && draft[s.key] !== (ratings[s.key]?.score == null ? "" : String(ratings[s.key].score));
                  return (
                    <tr
                      key={s.key}
                      onClick={() => openDetail("skill", s)}
                      className="cursor-pointer border-t border-black/[0.04] hover:bg-black/[0.03] dark:border-white/[0.05] dark:hover:bg-white/[0.04]"
                    >
                      <td className={`${TD} font-medium whitespace-nowrap`}>
                        <span className={`flex items-center gap-2 ${s.link ? "text-muted-foreground" : "text-foreground"}`}>
                          <span
                            aria-hidden="true"
                            className={`size-1.5 shrink-0 rounded-full ${SKILL_DOT[s.status] || "bg-muted-foreground/40"}`}
                          />
                          {s.name}
                          {s.link ? (
                            <span className="rounded bg-black/5 px-1 text-[10px] font-normal text-muted-foreground dark:bg-white/10">
                              link
                            </span>
                          ) : null}
                          {sameNameRoots.has(s.name) ? (
                            <span
                              className="rounded bg-red-500/15 px-1 text-[10px] font-normal text-red-500"
                              title={`Same skill loaded from ${sameNameRoots.get(s.name).length} roots: ${sameNameRoots.get(s.name).join(", ")}. Pi sees it twice.`}
                            >
                              duplicate
                            </span>
                          ) : null}
                          {closeWith[s.key]?.length ? (
                            <span
                              className="rounded bg-amber-500/15 px-1 text-[10px] font-normal text-amber-500"
                              title={`Description close to: ${[...new Set(closeWith[s.key])].join(", ")}. LLM may pick the wrong one.`}
                            >
                              similar
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-muted-foreground/80`} title={s.root}>
                        {s.root.replace(/^\/Users\/[^/]+/, "~")}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {s.category ? (
                          <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-white/10">{s.category}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className={`${TD} whitespace-nowrap text-muted-foreground`} title={SKILL_HINT[s.status] || "SKILL.md OK"}>
                        {s.status}
                      </td>
                      <td className={`${TD} text-center`}>
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            inputMode="numeric"
                            aria-label={`Rating for ${s.name}`}
                            value={value}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const v = (e.target.value ?? "").replace(/[^0-9]/g, "");
                              setDraft((prev) => ({ ...prev, [s.key]: v }));
                            }}
                            placeholder="–"
                            className="w-12 rounded border border-black/10 bg-background px-1 py-0.5 text-right tabular-nums text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary/50"
                          />
                          {dirty ? <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" /> : null}
                        </span>
                      </td>
                      <td className={`${TD} w-12 font-semibold ${GRADE_TEXT[gradeOf(value)] || "text-muted-foreground/40"}`}>
                        {gradeOf(value) || "—"}
                      </td>
                      <td className={`${TD} max-w-0`}>
                        <span className="block truncate text-muted-foreground/80" title={s.description || SKILL_HINT[s.status]}>
                          {s.description || SKILL_HINT[s.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail?.kind === "mcp" ? "MCP server detail" : "Skill detail"} className="sm:max-w-3xl">
        {detail?.kind === "mcp" && (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden="true" className={`size-2 rounded-full ${STATE_DOT[detail.item.state] || "bg-muted-foreground/40"}`} />
              <span className="text-base font-semibold">{detail.item.name}</span>
              <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground dark:bg-white/10">{detail.item.transport}</span>
              <span className="text-xs text-muted-foreground" title={STATE_HINT[detail.item.state] || detail.item.state}>{detail.item.state}</span>
            </div>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-xs">
              <dt className="text-muted-foreground">Target</dt>
              <dd className="break-all rounded bg-secondary/40 px-2 py-1 font-mono">{detail.item.target}</dd>
              <dt className="text-muted-foreground">Tools</dt><dd className="tabular-nums">{detail.item.tools ?? "—"}</dd>
            </dl>
            {detail.item.toolList?.length > 0 && (
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Available tools</div>
            )}
            {detail.item.toolList?.length > 0 && (
              <div className="max-h-96 overflow-auto rounded-md border border-border">
                {detail.item.toolList.map((t) => (
                  <div key={t.name} className="border-t border-border px-3 py-2 text-xs first:border-t-0">
                    <p className="font-mono font-medium">{t.name}</p>
                    {t.description && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{t.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {detail?.kind === "skill" && (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden="true" className={`size-2 rounded-full ${SKILL_DOT[detail.item.status] || "bg-muted-foreground/40"}`} />
              <span className="text-base font-semibold">{detail.item.name}</span>
              <span className="text-xs text-muted-foreground" title={SKILL_HINT[detail.item.status] || "SKILL.md OK"}>{detail.item.status}</span>
              {sameNameRoots.has(detail.item.name) && <span className="rounded bg-red-500/15 px-1 text-[10px] text-red-500">duplicate</span>}
              {closeWith[detail.item.key]?.length ? <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-500">similar</span> : null}
            </div>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-xs">
              <dt className="text-muted-foreground">Path</dt><dd className="break-all font-mono">{detail.item.root.replace(/^\/Users\/[^/]+/, "~")}/{detail.item.name}</dd>
              <dt className="text-muted-foreground">Auto score</dt><dd className="tabular-nums">{detail.item.autoScore ?? "—"} ({detail.item.autoGrade ?? "—"})</dd>
              <dt className="text-muted-foreground">Your rating</dt><dd className="tabular-nums">{ratings[detail.item.key]?.score ?? "—"}</dd>
              {detail.item.link && (<><dt className="text-muted-foreground">Link</dt><dd className="break-all font-mono">→ {detail.item.link}</dd></>)}
              {closeWith[detail.item.key]?.length ? (<><dt className="text-muted-foreground">Similar to</dt><dd>{[...new Set(closeWith[detail.item.key])].join(", ")}</dd></>) : null}
              {sameNameRoots.has(detail.item.name) && (<><dt className="text-muted-foreground">Loaded from</dt><dd className="break-all font-mono">{sameNameRoots.get(detail.item.name).join(", ")}</dd></>)}
            </dl>
            {detail.item.signals?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {detail.item.signals.map((g) => (
                  <span key={g} className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] text-muted-foreground dark:bg-white/10">{g}</span>
                ))}
              </div>
            )}
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Description</div>
            <p className="whitespace-pre-wrap break-words rounded-md bg-secondary/40 p-3 text-xs leading-5">{detail.item.description || SKILL_HINT[detail.item.status] || "—"}</p>
            <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>SKILL.md</span>
              {skillDoc?.resources?.length ? <span className="normal-case tracking-normal font-normal">{skillDoc.resources.join(" · ")}</span> : null}
            </div>
            {skillDoc?.loading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {skillDoc?.error && <p className="text-xs text-muted-foreground">{skillDoc.error}</p>}
            {skillDoc?.raw != null && (
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border p-3 font-mono text-[11px] leading-5">
                {skillDoc.raw}
                {skillDoc.truncated ? "\n… (truncated)" : ""}
              </pre>
            )}
          </div>
        )}
      </Modal>

      <Modal isOpen={llmOpen} onClose={() => setLlmOpen(false)} title="LLM routing check" size="lg">
        <div className="flex flex-col gap-3 text-xs">
          <p className="text-muted-foreground">
            Sends the first 5 visible skills&apos; descriptions through 9router (model <code>auto</code>) against the full catalog of {allSkills.length} skills and checks whether the LLM picks the same skill back.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={llmBusy} onClick={() => runLlm("route", visibleSkills.slice(0, 5))}>
              {llmBusy && llmMode === "route" ? "Running…" : "Run routing test"}
            </Button>
            <Button size="sm" variant="ghost" disabled={llmBusy || !visibleSkills[0]} onClick={() => runLlm("suggest", visibleSkills.slice(0, 1))}>
              {llmBusy && llmMode === "suggest" ? "Running…" : `Suggest description for ${visibleSkills[0]?.name || "—"}`}
            </Button>
          </div>
          {llmError && <p className="text-red-500">{llmError}</p>}
          {llmResult?.action === "route" && (
            <>
              <p className="tabular-nums">
                Correct {llmResult.summary.correct}/{llmResult.summary.scored ?? llmResult.summary.total}
                {llmResult.summary.rate == null ? "" : ` (${Math.round(llmResult.summary.rate * 100)}%)`}
                {llmResult.summary.errors ? ` · ${llmResult.summary.errors} model error(s), not counted` : ""}
              </p>
              <table className="w-full">
                <tbody>
                  {llmResult.results.map((r) => (
                    <tr key={r.key} className="border-t border-black/[0.06] dark:border-white/[0.07]">
                      <td className="py-1 pr-2 font-medium">{r.name}</td>
                      <td className="py-1 pr-2 text-muted-foreground">picked: {r.picked ?? r.error}</td>
                      <td className={`py-1 font-semibold ${r.error ? "text-muted-foreground" : r.ok ? "text-green-500" : "text-red-500"}`}>
                        {r.error ? "ERR" : r.ok ? "OK" : "MISS"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {llmResult?.action === "suggest" && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground">Current: {llmResult.original || "(empty)"}</p>
              <pre className="whitespace-pre-wrap break-words rounded bg-black/5 p-2 dark:bg-white/5">{llmResult.suggested}</pre>
              <div>
                <Button size="sm" variant="ghost" onClick={() => copyText(llmResult.suggested, "suggest")}>
                  {copiedKey === "suggest" ? "Copied!" : "Copy suggestion"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
