// Lists every prompt source the proxy can inject, derived from live settings, so the
// Prompt Instructions page shows what is actually active instead of a static list.
// Pure: no React, no fetch — the "detail" payload is a small descriptor the UI renders.

export function countSmartCombos(settings = {}) {
  const strategies = settings.comboStrategies || {};
  const fromCombos = Object.values(strategies).filter(
    (c) => c && (c.fallbackStrategy === "smart" || c.smartPolicy === "smart")
  ).length;
  return fromCombos + (settings.comboStrategy === "smart" ? 1 : 0);
}

export function buildPromptSources(settings, items = []) {
  const st = settings || {};
  const instrCount = items.filter((i) => i.enabled && (i.text || "").trim()).length;
  const smartCombos = countSmartCombos(st);

  return [
    {
      id: "instructions",
      name: "Prompt instructions",
      icon: "edit_note",
      active: !!st.promptInstructionsEnabled && instrCount > 0,
      summary: st.promptInstructionsEnabled
        ? `${instrCount} enabled instruction${instrCount === 1 ? "" : "s"}`
        : "Master toggle off",
      detail: { kind: "instructions" },
    },
    {
      id: "custom",
      name: "Custom system prompt (legacy)",
      icon: "subject",
      active: !!st.customPromptEnabled && !!(st.customPrompt || "").trim(),
      summary: st.customPromptEnabled
        ? ((st.customPrompt || "").trim() ? `${(st.customPrompt || "").length} chars` : "Enabled but empty")
        : "Disabled",
      detail: {
        kind: "text",
        text: st.customPrompt || "",
        note: "Injected only while the legacy toggle is on. Re-create it as a Prompt instruction entry to manage it here.",
      },
    },
    {
      id: "caveman",
      name: "Caveman (token saver)",
      icon: "skull",
      active: !!st.cavemanEnabled && !!st.cavemanLevel,
      summary: st.cavemanEnabled ? `Level: ${st.cavemanLevel || "full"}` : "Disabled",
      detail: { kind: "builtin", key: "caveman", level: st.cavemanLevel || "full" },
    },
    {
      id: "ponytail",
      name: "Ponytail (token saver)",
      icon: "cut",
      active: !!st.ponytailEnabled && !!st.ponytailLevel,
      summary: st.ponytailEnabled ? `Level: ${st.ponytailLevel || "full"}` : "Disabled",
      detail: { kind: "builtin", key: "ponytail", level: st.ponytailLevel || "full" },
    },
    {
      id: "memory",
      name: "Memory recall",
      icon: "memory",
      active: !!st.memoryEnabled,
      summary: st.memoryEnabled ? "Retrieved per request" : "Disabled",
      detail: { kind: "text", text: "", note: "Recalled memories are appended per request from the memory store (see /dashboard/memory). The text depends on the request, so it cannot be shown statically." },
    },
    {
      id: "skills",
      name: "Pi skills auto-inject",
      icon: "extension",
      active: !!st.skillAutoInject,
      summary: st.skillAutoInject
        ? `Mode: ${st.skillPickMode || "llm"}, max ${st.skillMaxSkills || 2}`
        : "Disabled",
      detail: { kind: "text", text: "", note: `When enabled, the top matching skill bodies from ~/.pi/agent/skills, ~/.claude/skills and ~/.agents/skills are injected per request. Pick mode: ${st.skillPickMode || "llm"}, max chars ${st.skillMaxChars || 8000}.` },
    },
    {
      id: "jev",
      name: "Jev router prompts (built-in)",
      icon: "psychology",
      active: smartCombos > 0,
      readOnly: true,
      summary: smartCombos > 0
        ? `Used by ${smartCombos} smart combo${smartCombos === 1 ? "" : "s"}`
        : "No smart combo — not used",
      detail: { kind: "jev" },
    },
  ];
}
