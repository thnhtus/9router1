import { describe, it, expect } from "vitest";
import { resolvePromptInstructions } from "../../src/lib/promptInstructions.js";

const e = (o) => ({ id: o.name, enabled: true, scope: "global", target: "", priority: 0, ...o });

describe("resolvePromptInstructions", () => {
  it("returns empty string for missing or empty lists", () => {
    expect(resolvePromptInstructions(undefined, "openai", "gpt-4o")).toBe("");
    expect(resolvePromptInstructions([], "openai", "gpt-4o")).toBe("");
    expect(resolvePromptInstructions(null, "openai", "gpt-4o")).toBe("");
  });

  it("ignores disabled and blank entries", () => {
    const list = [
      e({ name: "off", text: "OFF", enabled: false }),
      e({ name: "blank", text: "   " }),
      e({ name: "on", text: "ON" }),
    ];
    expect(resolvePromptInstructions(list, "openai", "gpt-4o")).toBe("ON");
  });

  it("orders global entries by priority then name", () => {
    const list = [
      e({ name: "b", text: "B", priority: 1 }),
      e({ name: "a", text: "A", priority: 1 }),
      e({ name: "z", text: "Z", priority: -5 }),
    ];
    expect(resolvePromptInstructions(list, "openai", "gpt-4o")).toBe("Z\n\nA\n\nB");
  });

  it("scopes provider entries to the matching provider only", () => {
    const list = [
      e({ name: "g", text: "GLOBAL" }),
      e({ name: "p", text: "OPENAI-ONLY", scope: "provider", target: "openai" }),
    ];
    expect(resolvePromptInstructions(list, "openai", "gpt-4o")).toBe("GLOBAL\n\nOPENAI-ONLY");
    expect(resolvePromptInstructions(list, "anthropic", "claude-3")).toBe("GLOBAL");
  });

  it("scopes model entries to provider/model or bare model", () => {
    const list = [
      e({ name: "m1", text: "FULL", scope: "model", target: "openai/gpt-4o" }),
      e({ name: "m2", text: "BARE", scope: "model", target: "claude-3" }),
    ];
    expect(resolvePromptInstructions(list, "openai", "gpt-4o")).toBe("FULL");
    expect(resolvePromptInstructions(list, "anthropic", "claude-3")).toBe("BARE");
    expect(resolvePromptInstructions(list, "openai", "gpt-4o-mini")).toBe("");
  });

  it("drops scoped entries with no target", () => {
    const list = [e({ name: "p", text: "X", scope: "provider", target: "  " })];
    expect(resolvePromptInstructions(list, "openai", "gpt-4o")).toBe("");
  });

  it("is case-insensitive on provider and model targets", () => {
    const list = [e({ name: "p", text: "X", scope: "provider", target: "OpenAI" })];
    expect(resolvePromptInstructions(list, "openai", "gpt-4o")).toBe("X");
  });
});
