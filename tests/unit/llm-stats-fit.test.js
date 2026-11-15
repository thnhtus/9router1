import { describe, it, expect } from "vitest";
import { fitScore, buildProfile } from "@/lib/llmStats.js";

// Two categories for L1-L2 (general, language), two for L3-L4 (code, reasoning); top % = rank.
const pool = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, scores: { general: i, language: i, code: i, reasoning: i } }));
const strong = { id: "x", scores: { general: 30, language: 30, code: 100, reasoning: 100 } };
const all = [...pool, strong];

describe("fitScore", () => {
  it("scores each band from its own categories only", () => {
    expect(fitScore(strong, all, "L1-L2")).toBeGreaterThan(90);
    // best of 31 → top ceil(1/31)=4% → 96 (percentile, not absolute)
    expect(fitScore(strong, all, "L3-L4")).toBe(96);
  });
  it("returns null when no band category is ranked", () => {
    expect(fitScore({ id: "y", scores: { vision: 5 } }, all, "L3-L4")).toBeNull();
    expect(fitScore(null, all, "L1-L2")).toBeNull();
  });
});

describe("buildProfile fit", () => {
  it("adds fit lines and flags unmatched models", () => {
    const p = buildProfile("a/x", strong, null, all);
    expect(p).toContain("fit L3-L4: 96/100");
    expect(buildProfile("a/none", null, null, all)).toContain("no catalog match");
  });
});
