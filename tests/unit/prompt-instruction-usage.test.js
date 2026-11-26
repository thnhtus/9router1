import { describe, it, expect } from "vitest";
import { selectPromptInstructions } from "../../src/lib/promptInstructions.js";

describe("selectPromptInstructions (attribution)", () => {
  const list = [
    { id: "lang", name: "Language", text: "Reply in Vietnamese", scope: "global", enabled: true, priority: 0 },
    { id: "ev", name: "Evidence", text: "State the command", scope: "global", enabled: true, priority: 20 },
    { id: "off", name: "Off", text: "Disabled text", scope: "global", enabled: false, priority: 10 },
    { id: "p", name: "Provider", text: "Claude only", scope: "provider", target: "anthropic", enabled: true, priority: 5 },
  ];

  it("returns one entry per injected instruction, in priority order", () => {
    expect(selectPromptInstructions(list, "openai", "gpt-4o").map((e) => e.id)).toEqual(["lang", "ev"]);
  });

  it("includes scoped entries only on matching targets", () => {
    expect(selectPromptInstructions(list, "anthropic", "claude-3").map((e) => e.id)).toEqual(["lang", "p", "ev"]);
  });

  it("produces the same text as resolvePromptInstructions", () => {
    const { resolvePromptInstructions } = require("../../src/lib/promptInstructions.js");
    expect(selectPromptInstructions(list, "openai", "gpt-4o").map((e) => e.text.trim()).join("\n\n"))
      .toBe(resolvePromptInstructions(list, "openai", "gpt-4o"));
  });
});
