import { describe, it, expect } from "vitest";
import { pickByLevel } from "@/lib/llmStats.js";

const catalog = [
  { id: "free-1", scores: { general: 80, language: 80 }, inPrice: 0 },
  { id: "free-2", scores: { general: 70, language: 70 }, inPrice: 0 },
  { id: "mid-1", scores: { code: 90, reasoning: 90 }, inPrice: 2, outPrice: 8 },
  { id: "prem-1", scores: { code: 95, reasoning: 95 }, inPrice: 10, outPrice: 40 },
];

describe("pickByLevel (Option C formula)", () => {
  it("picks free/cheap for L1-L2, ignoring expensive models", () => {
    const res = pickByLevel(["free-1", "prem-1"], 1, catalog);
    expect(res.choice).toBe("free-1");
  });

  it("allows mid/premium for L3-L4", () => {
    const res = pickByLevel(["free-1", "mid-1", "prem-1"], 4, catalog);
    expect(["mid-1", "prem-1"]).toContain(res.choice);
  });

  it("returns null when fewer than 2 candidates are catalogued", () => {
    expect(pickByLevel(["unknown-a", "unknown-b"], 2, catalog)).toBeNull();
    expect(pickByLevel(["free-1"], 1, catalog)).toBeNull();
  });
});
