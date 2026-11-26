import { describe, it, expect } from "vitest";
import { buildPromptSources, countSmartCombos } from "../../src/lib/promptSources.js";

const byId = (list) => Object.fromEntries(list.map((s) => [s.id, s]));

describe("countSmartCombos", () => {
  it("counts per-combo smart strategies plus the global strategy", () => {
    expect(countSmartCombos({})).toBe(0);
    expect(countSmartCombos({ comboStrategy: "smart" })).toBe(1);
    expect(countSmartCombos({ comboStrategies: { a: { fallbackStrategy: "smart" }, b: { fallbackStrategy: "fallback" } } })).toBe(1);
    expect(countSmartCombos({ comboStrategy: "smart", comboStrategies: { a: { smartPolicy: "smart" } } })).toBe(2);
  });
});

describe("buildPromptSources", () => {
  it("always returns the same seven sources in order", () => {
    const ids = buildPromptSources(null).map((s) => s.id);
    expect(ids).toEqual(["instructions", "custom", "caveman", "ponytail", "memory", "skills", "jev"]);
  });

  it("marks instructions active only when the master toggle is on and an entry has text", () => {
    const off = byId(buildPromptSources({ promptInstructionsEnabled: false }, [{ enabled: true, text: "x" }]));
    expect(off.instructions.active).toBe(false);
    const blank = byId(buildPromptSources({ promptInstructionsEnabled: true }, [{ enabled: true, text: "   " }]));
    expect(blank.instructions.active).toBe(false);
    expect(blank.instructions.summary).toBe("0 enabled instructions");
    const on = byId(buildPromptSources({ promptInstructionsEnabled: true }, [{ enabled: true, text: "x" }, { enabled: false, text: "y" }]));
    expect(on.instructions.active).toBe(true);
    expect(on.instructions.summary).toBe("1 enabled instruction");
  });

  it("treats the legacy custom prompt as active only when non-empty", () => {
    expect(byId(buildPromptSources({ customPromptEnabled: true, customPrompt: "  " })).custom.active).toBe(false);
    expect(byId(buildPromptSources({ customPromptEnabled: true, customPrompt: "  " })).custom.summary).toBe("Enabled but empty");
    expect(byId(buildPromptSources({ customPromptEnabled: true, customPrompt: "abc" })).custom.active).toBe(true);
  });

  it("reports token-saver levels", () => {
    const s = byId(buildPromptSources({ cavemanEnabled: true, cavemanLevel: "lite", ponytailEnabled: false }));
    expect(s.caveman.active).toBe(true);
    expect(s.caveman.summary).toBe("Level: lite");
    expect(s.ponytail.active).toBe(false);
    expect(s.ponytail.detail).toEqual({ kind: "builtin", key: "ponytail", level: "full" });
  });

  it("reflects memory and skill toggles", () => {
    const s = byId(buildPromptSources({ memoryEnabled: true, skillAutoInject: true, skillPickMode: "embedding", skillMaxSkills: 3 }));
    expect(s.memory.active).toBe(true);
    expect(s.skills.active).toBe(true);
    expect(s.skills.summary).toBe("Mode: embedding, max 3");
  });

  it("marks the built-in Jev prompt active only when a smart combo exists", () => {
    expect(byId(buildPromptSources({})).jev.active).toBe(false);
    expect(byId(buildPromptSources({})).jev.summary).toBe("No smart combo — not used");
    const on = byId(buildPromptSources({ comboStrategies: { c: { fallbackStrategy: "smart" } } })).jev;
    expect(on.active).toBe(true);
    expect(on.summary).toBe("Used by 1 smart combo");
  });
});
