/**
 * Unit tests for gemini-web mode catalog + prompt builder (no browser).
 * Run: npx vitest run tests/unit/gemini-web-modes.test.js
 */
import { describe, it, expect } from "vitest";
import { GEMINI_WEB_MODEL_MODES, resolveGeminiModelMode, describeModeSelectionFailure } from "../../open-sse/executors/gemini-web/modeSelection.js";
import providerDef from "../../open-sse/providers/registry/gemini-web.js";
import { buildGeminiPrompt } from "../../open-sse/executors/gemini-web.js";

describe("gemini-web catalog ↔ mode map stay in sync", () => {
  it("every chat model advertised in the registry resolves to a UI mode", () => {
    const chatIds = providerDef.models.filter((m) => m.kind !== "image").map((m) => m.id);
    for (const id of chatIds) expect(resolveGeminiModelMode(id), id).not.toBeNull();
  });

  it("pre-calibration ids still resolve (saved combos / clients keep working)", () => {
    expect(resolveGeminiModelMode("gemini-3.1-pro").id).toBe("gemini-web-auto");
    expect(resolveGeminiModelMode("gemini-3.7-flash").id).toBe("gemini-web-hydrogen");
    expect(resolveGeminiModelMode("gemini-3.1-flash-lite").id).toBe("gemini-web-auto");
  });

  it("unknown model fails closed (null)", () => {
    expect(resolveGeminiModelMode("gemini-3.8-flash")).toBeNull();
  });

  it("each mode has an item matcher and an indicator pattern that agree on the same name", () => {
    // Real menu item innerText + aria "currently <X>" captured live 2026-11-19.
    const live = {
      "gemini-web-auto": ["Auto\nAdapts to your needs", "Auto"],
      "gemini-web-hydrogen": ["Everyday help\n4 Hydrogen", "Hydrogen"],
      "gemini-web-neon": ["Deeper analysis\n4 Neon", "Neon"],
    };
    const items = Object.values(live).map(([t]) => t).concat("Code & complex work\n4 Carbon");
    for (const [id, d] of Object.entries(GEMINI_WEB_MODEL_MODES)) {
      const [itemText, aria] = live[id];
      expect(d.indicatorPattern.test(aria), `indicator ${id}`).toBe(true);
      // matcher hits exactly its own row, never the Carbon upsell
      expect(items.filter((t) => d.itemText.test(t)), id).toEqual([itemText]);
    }
  });
});

describe("buildGeminiPrompt", () => {
  it("single user message is returned byte-for-byte", () => {
    expect(buildGeminiPrompt([{ role: "user", content: "hi" }])).toBe("hi");
  });

  it("system + single user prepends a System: block", () => {
    expect(buildGeminiPrompt([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ])).toBe("System:\nbe brief\n\nhi");
  });

  it("multi-turn emits Previous conversation + Current user message", () => {
    const out = buildGeminiPrompt([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ]);
    expect(out).toBe("Previous conversation:\nUser: a\n\nAssistant: b\n\nCurrent user message:\nc");
  });
});

describe("describeModeSelectionFailure", () => {
  it("names the model and the error code, never selector text", () => {
    const msg = describeModeSelectionFailure("gemini-web-neon", "indicator_mismatch");
    expect(msg).toContain('"gemini-web-neon"');
    expect(msg).toContain("unsupported_control_for_provider");
    expect(msg).not.toMatch(/gem-menu|data-test-id/);
  });
});
