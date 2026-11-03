import { describe, it, expect, beforeEach } from "vitest";
import { handleComboChat, getStickyComboModel } from "../../open-sse/services/combo.js";
import { groupRouteByTier, resetStickyComboStore } from "../../open-sse/services/systemoneRouter.js";

const log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
const tiers = {
  "cc/claude-opus-5-5": "premium", "cc/claude-opus-5": "premium",
  "cc/claude-sonnet-5": "mid", "cc/claude-sonnet-5-5": "mid",
  "cmc/stealth/glyph-cluster:free": "free", "cmc/reflection/beam:free": "free", "cmc/poolside/laguna-s-2.1-free": "free",
};
const p = (o5, o, s, s5, g, b, l) => ({
  "cc/claude-opus-5-5": o5, "cc/claude-opus-5": o, "cc/claude-sonnet-5": s, "cc/claude-sonnet-5-5": s5,
  "cmc/stealth/glyph-cluster:free": g, "cmc/reflection/beam:free": b, "cmc/poolside/laguna-s-2.1-free": l,
});

describe("groupRouteByTier (real jevLogs 2026-11-03)", () => {
  it.each([
    ["cmc/stealth/glyph-cluster:free", 0.73, p(0, 0, 0.01, 0, 0.77, 0.13, 0.09), "free", 0.99],
    ["cc/claude-sonnet-5", 0.49, p(0.12, 0.11, 0.56, 0.18, 0.01, 0.01, 0.01), "mid", 0.74],
    ["cc/claude-sonnet-5", 0.49, p(0.1, 0.11, 0.56, 0.2, 0.01, 0.01, 0.01), "mid", 0.76],
    ["cc/claude-sonnet-5", 0.5, p(0.1, 0.14, 0.57, 0.16, 0.01, 0.01, 0.01), "mid", 0.73],
  ])("%s %f → %s ≥0.7", (choice, confidence, probabilities, tier, conf) => {
    const r = groupRouteByTier({ choice, confidence, probabilities }, tiers);
    expect(r.tier).toBe(tier);
    expect(r.choice).toBe(choice);
    expect(r.confidence).toBe(conf);
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("keeps unknown-tier models as their own group and passes through without probabilities", () => {
    const r = groupRouteByTier({ choice: "a", confidence: 0.6, probabilities: { a: 0.6, b: 0.4 } }, { a: "unknown", b: "unknown" });
    expect(r.choice).toBe("a");
    expect(r.confidence).toBe(0.6);
    const bare = { choice: "a", confidence: 0.6, probabilities: null };
    expect(groupRouteByTier(bare, tiers)).toBe(bare);
  });
});

describe("smart router does not block on a slow router", () => {
  beforeEach(() => resetStickyComboStore());

  it("routes by default order after smartWaitMs, late answer becomes next-turn sticky", async () => {
    const models = ["a", "b"];
    const calls = [];
    const handleSingleModel = async (_b, m) => {
      calls.push(m);
      return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), clone() { return this; }, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
    };
    let release;
    const slow = new Promise((r) => { release = r; });
    const started = Date.now();
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] }, models, handleSingleModel, log,
      comboName: "c", comboStrategy: "smart", sessionId: "s1", smartWaitMs: 20,
      resolveSmartChoice: () => slow,
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(calls[0]).toBe("a");
    release({ choice: "b", confidence: 0.9, probabilities: { a: 0.1, b: 0.9 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(getStickyComboModel("c", "s1", models)).toBe("b");
  });
});
