import { describe, it, expect } from "vitest";
import { buildSampleRequest } from "../../src/lib/sampleRequest.js";

const opts = { format: "openai", provider: "openai", model: "gpt-4o", userText: "Fix the login bug" };

describe("buildSampleRequest", () => {
  it("returns a user-only request when nothing is enabled", () => {
    const r = buildSampleRequest({}, [], opts);
    expect(r.body.messages).toEqual([{ role: "user", content: "Fix the login bug" }]);
  });

  it("injects caveman before ponytail before custom before instructions", () => {
    const r = buildSampleRequest(
      { cavemanEnabled: true, cavemanLevel: "lite", ponytailEnabled: true, ponytailLevel: "lite", customPromptEnabled: true, customPrompt: "Be terse.", promptInstructionsEnabled: true },
      [{ enabled: true, text: "Prefer editing existing files.", scope: "global" }],
      opts
    );
    expect(r.injected.map((x) => x.source)).toEqual(["caveman", "ponytail", "custom", "instructions"]);
  });

  it("uses the format-specific system field for claude", () => {
    const r = buildSampleRequest({ customPromptEnabled: true, customPrompt: "Be terse." }, [], { ...opts, format: "claude" });
    expect(r.body.system).toBe("Be terse.");
    expect(r.body.messages[0].content[0].text).toBe("Fix the login bug");
  });

  it("uses systemInstruction.parts for gemini", () => {
    const r = buildSampleRequest({ customPromptEnabled: true, customPrompt: "Be terse." }, [], { ...opts, format: "gemini" });
    expect(r.body.systemInstruction.parts).toEqual([{ text: "Be terse." }]);
  });

  it("prepends a system message for responses", () => {
    const r = buildSampleRequest({ customPromptEnabled: true, customPrompt: "Be terse." }, [], { ...opts, format: "responses" });
    expect(r.body.input[0]).toEqual({ type: "message", role: "system", content: [{ type: "input_text", text: "Be terse." }] });
  });

  it("applies provider/model scoping to instructions", () => {
    const r = buildSampleRequest(
      { promptInstructionsEnabled: true },
      [{ enabled: true, scope: "model", target: "openai/gpt-4o", text: "MODEL ONLY" }],
      opts
    );
    expect(r.injected.map((x) => x.source)).toEqual(["instructions"]);
  });

  it("skips scoped instructions that do not match", () => {
    const r = buildSampleRequest(
      { promptInstructionsEnabled: true },
      [{ enabled: true, scope: "provider", target: "anthropic", text: "NOPE" }],
      opts
    );
    expect(r.injected).toEqual([]);
  });
});
