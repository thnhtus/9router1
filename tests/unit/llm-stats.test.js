import { describe, it, expect } from "vitest";
import { normalizeModelId, matchCatalog, costTier, buildProfile, isFreeModel, suggestRole } from "@/lib/llmStats.js";

const catalog = [
  { id: "claude-opus-4-5", name: "Claude Opus 4.5", scores: { coding: 80, reasoning: 70 }, inPrice: 5, outPrice: 25 },
  { id: "gpt-4o-mini", name: "GPT-4o mini", scores: { chat: 60 }, inPrice: 0.15, outPrice: 0.6 },
];

describe("llmStats", () => {
  it("normalizes routed ids", () => {
    expect(normalizeModelId("cc/claude-opus-4.5-20251101")).toBe("claude-opus-4-5");
    expect(normalizeModelId("oc/gpt-4o-mini:free")).toBe("gpt-4o-mini");
  });
  it("matches catalog by normalized id and prefix", () => {
    expect(matchCatalog("cc/claude-opus-4-5-20251101", catalog)?.name).toBe("Claude Opus 4.5");
    expect(matchCatalog("x/gpt-4o-mini-2024-07-18", catalog)?.id).toBe("gpt-4o-mini");
    expect(matchCatalog("x/unknown-model", catalog)).toBeNull();
  });
  it("tiers by price, free wins", () => {
    expect(costTier("a/claude-opus-4-5", catalog[0])).toBe("premium");
    expect(costTier("a/gpt-4o-mini", catalog[1])).toBe("cheap");
    expect(costTier("a/jev-1.13-free", null)).toBe("free");
    expect(isFreeModel("oc/x:free")).toBe(true);
  });
  it("builds a profile line Jev can read", () => {
    const p = buildProfile("cc/claude-opus-4-5", catalog[0], "coding");
    expect(p).toContain("role: coding");
    expect(p).toContain("cost: premium");
    expect(buildProfile("cc/claude-opus-4-5", catalog[0])).not.toContain("role:");
  });
  it("ranks mixed-scale scores within their category (no raw numbers)", () => {
    // productivity runs 0..2000, science 0..1: raw values are not comparable.
    const big = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, scores: { productivity: i * 50, science: i / 40 } }));
    const strong = { id: "x", scores: { productivity: 100, science: 0.99 } };
    const p = buildProfile("a/x", strong, null, [...big, strong]);
    expect(p).toBe("cost: unknown; rank science top 3%, productivity top 93%");
    expect(suggestRole(strong, [...big, strong])).toBe("science");
  });
});
