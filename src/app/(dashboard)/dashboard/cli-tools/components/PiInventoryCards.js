"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";

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

export default function PiInventoryCards() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    fetch("/api/cli-tools/pi-settings")
      .then((res) => res.json())
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, []);

  const mcpServers = data?.mcpServers || [];
  const skills = data?.skills || [];

  return (
    <>
      <Card
        padding="md"
        title="Pi MCP servers"
        subtitle={`From ~/.pi/agent/mcp-adapter.json — ${mcpServers.length} configured`}
        icon="extension"
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
                  {(r.skills || []).map((s) => (
                    <li key={s.name} className="flex min-w-0 items-baseline gap-2">
                      <span
                        aria-hidden="true"
                        className={`size-1.5 shrink-0 rounded-full ${SKILL_DOT[s.status] || "bg-muted-foreground/40"}`}
                      />
                      <span className={`font-medium shrink-0 ${s.link ? "text-muted-foreground" : "text-foreground"}`}>{s.name}</span>
                    {s.link ? (
                      <span className="rounded bg-black/5 dark:bg-white/10 px-1 text-[10px] text-muted-foreground shrink-0">link</span>
                    ) : null}
                      <span className="min-w-0 truncate text-muted-foreground/80" title={s.description || SKILL_HINT[s.status]}>
                        {s.description || SKILL_HINT[s.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
