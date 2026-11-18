"use client";

import { useEffect, useState } from "react";
import { Card, Button } from "@/shared/components";

const SKILL_DOT = {
  ok: "bg-green-500",
  "no-description": "bg-amber-500",
  "missing-SKILL.md": "bg-red-500",
};

const SKILL_HINT = {
  "no-description": "SKILL.md has no description frontmatter",
  "missing-SKILL.md": "No SKILL.md in this folder",
};

// 80+ = A, 60-79 = B, <60 = C, empty = unrated
const gradeOf = (v) => (v === "" || v == null ? "" : Number(v) >= 80 ? "A" : Number(v) >= 60 ? "B" : "C");

const GRADE_TEXT = {
  A: "text-green-500",
  B: "text-amber-500",
  C: "text-red-500",
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



export default function PiInventoryCards() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [ratings, setRatings] = useState({});
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

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
  const skills = data?.skills || [];

  const dirtyCount = Object.keys(draft).filter((k) => (draft[k] ?? "") !== (String(ratings[k]?.score ?? "") ?? "")).length;

  const handleSaveRatings = async () => {
    const payload = {};
    for (const key of Object.keys(draft)) {
      const raw = (draft[key] ?? "").trim();
      const score = raw === "" ? null : Number(raw);
      if (score === null || !Number.isFinite(score)) continue;
      if (score < 0 || score > 100) continue;
      payload[key] = score;
    }
    const deleted = Object.keys(draft).filter((k) => (draft[k] ?? "").trim() === "" && ratings[k]?.score != null);
    const delPayload = {};
    for (const key of deleted) delPayload[key] = null;
    const finalPayload = Object.keys(payload).length ? payload : delPayload;
    if (Object.keys(finalPayload).length === 0) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/cli-tools/pi-settings/skill-ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratings: finalPayload }),
      });
      const d = await res.json();
      if (res.ok) {
        setRatings(d?.ratings || {});
        setDraft({});
        setSaveMsg("Saved");
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

  const skillRow = (r, s) => {
    const key = `${r.path}:${s.name}`;
    const stored = ratings[key]?.score ?? null;
    const value = draft[key] ?? (stored == null ? "" : String(stored));
    const dirty = key in draft && draft[key] !== (stored == null ? "" : String(stored));
    return (
      <li key={key} className="flex min-w-0 items-center gap-2 leading-5">
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${SKILL_DOT[s.status] || "bg-muted-foreground/40"}`}
        />
        <span className="w-40 shrink-0 truncate font-medium text-foreground" title={s.name}>{s.name}</span>
        {s.link ? (
          <span className="rounded bg-black/5 dark:bg-white/10 px-1 text-[10px] text-muted-foreground shrink-0">link</span>
        ) : null}
        <input
          type="number"
          min={0}
          max={100}
          inputMode="numeric"
          aria-label={`Rating for ${s.name}`}
          value={value}
          onChange={(e) => {
            const v = (e.target.value ?? "").replace(/[^0-9]/g, "");
            setDraft((prev) => ({ ...prev, [key]: v }));
          }}
          placeholder="–"
          className="w-14 shrink-0 rounded border border-black/10 bg-background px-1.5 py-0.5 text-right text-xs tabular-nums text-foreground outline-none focus:border-primary/50"
        />
        <span className={`w-3 shrink-0 text-[10px] font-semibold ${GRADE_TEXT[gradeOf(value)] || ""}`}>
          {gradeOf(value)}
        </span>
        <span className="min-w-0 truncate text-muted-foreground/80" title={s.description || SKILL_HINT[s.status]}>
          {s.description || SKILL_HINT[s.status]}
        </span>
        {dirty ? <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" /> : null}
      </li>
    );
  };

  return (
    <>
      <Card
        padding="md"
        title="Pi MCP servers"
        subtitle={`From ~/.pi/agent/mcp-adapter.json — ${mcpServers.length} configured`}
        icon="extension"
        action={
          <span className="text-[11px] text-muted-foreground tabular-nums">{mcpServers.length} servers</span>
        }
      >
        {error && <p className="text-sm text-muted-foreground">Failed to load: {error}</p>}
        {!error && !data && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!error && data && mcpServers.length === 0 && (
          <p className="text-sm text-muted-foreground">No MCP servers configured.</p>
        )}
        {!error && mcpServers.length > 0 && (
          <ul className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-1 text-xs">
            {mcpServers.map((s) => (
              <li key={s.name} className="flex min-w-0 items-baseline gap-2 leading-5">
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[s.state] || "bg-muted-foreground/40"}`}
                />
                <span className="font-medium text-foreground shrink-0">{s.name}</span>
                <span className="rounded bg-black/5 dark:bg-white/10 px-1 text-[10px] uppercase text-muted-foreground shrink-0">{s.transport}</span>
                <span className="shrink-0 text-muted-foreground" title={STATE_HINT[s.state] || s.state}>
                  {s.state}{s.tools != null ? ` · ${s.tools} tools` : ""}
                </span>
                <span className="min-w-0 truncate text-muted-foreground/70" title={s.target}>{s.target}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        padding="md"
        title="Pi skills"
        subtitle="From .pi/agent/skills, .claude/skills, .agents/skills"
        icon="school"
        action={
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {dirtyCount ? `${dirtyCount} unsaved` : "saved"}
            </span>
            <Button size="sm" onClick={handleSaveRatings} disabled={saving || dirtyCount === 0}>
              {saving ? "Saving…" : "Save ratings"}
            </Button>
          </div>
        }
      >
        {error && <p className="text-sm text-muted-foreground">Failed to load: {error}</p>}
        {!error && !data && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!error && data && skills.length === 0 && (
          <p className="text-sm text-muted-foreground">No skills found.</p>
        )}
        {!error && skills.length > 0 && (
          <div className="flex flex-col gap-3 text-xs">
            {skills.map((r) => (
              <div key={r.path}>
                <p className="text-muted-foreground">
                  <span className="font-medium tabular-nums text-foreground">{r.count}</span>{" "}
                  <span className="break-all">{r.path}</span>
                  {r.linked ? (
                    <span className="ml-1 text-[10px] text-muted-foreground/70">({r.local} local, {r.linked} linked)</span>
                  ) : null}
                </p>
                <ul className="mt-1 flex flex-col gap-1 max-h-72 overflow-y-auto pr-1">
                  {(r.skills || []).map((s) => skillRow(r, s))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {saveMsg ? <p className="mt-2 text-xs text-muted-foreground">{saveMsg}</p> : null}
      </Card>
    </>
  );
}
