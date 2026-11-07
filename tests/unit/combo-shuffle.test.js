import { describe, it, expect } from "vitest";
import { handleComboChat, shuffleModels } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, debug() {}, error() {} };
const ok = () => { const make = () => ({ ok: true, status: 200, headers: new Headers(), clone: make, json: async () => ({}) }); return make(); };

describe("combo shuffle", () => {
  it("shuffleModels keeps members, varies order", () => {
    const m = ["a", "b", "c", "d"];
    const seen = new Set(Array.from({ length: 200 }, () => shuffleModels(m).join()));
    expect(shuffleModels(m).sort()).toEqual(m);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("smart + shuffle: Jev pick still first", async () => {
    for (let i = 0; i < 20; i++) {
      const tried = [];
      await handleComboChat({
        body: { messages: [{ role: "user", content: "hi" }] }, models: ["a", "b", "c", "d"], log,
        comboName: `s${i}-${Math.random()}`, comboStrategy: "smart", shuffle: true, autoSwitch: false,
        resolveSmartChoice: async () => ({ choice: "c", confidence: 0.9 }),
        handleSingleModel: async (_b, m) => { tried.push(m); return ok(); },
      });
      expect(tried[0]).toBe("c");
    }
  });

  it("fallback + shuffle: first member varies", async () => {
    const firsts = new Set();
    for (let i = 0; i < 50; i++) {
      await handleComboChat({
        body: { messages: [{ role: "user", content: "hi" }] }, models: ["a", "b", "c", "d"], log,
        comboName: "f", comboStrategy: "fallback", shuffle: true, autoSwitch: false,
        handleSingleModel: async (_b, m) => { firsts.add(m); return ok(); },
      });
    }
    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe("combo fairness", () => {
  it("promotes never-used/stale members and demotes recently failed ones", async () => {
    const { fairnessOrdered, markComboMember, FAIR_STALE_TURNS } = await import("../../open-sse/services/combo.js");
    const c = "fair-" + Math.random();
    fairnessOrdered(["a", "b", "c"], c);
    markComboMember(c, "a");
    markComboMember(c, "b", true);
    // c never used → front; b failed → end; a ok in middle
    expect(fairnessOrdered(["a", "b", "c"], c)).toEqual(["c", "a", "b"]);
    // keepHead stays first even if errored
    expect(fairnessOrdered(["a", "b", "c"], c, "b")[0]).toBe("b");
    for (let i = 0; i < FAIR_STALE_TURNS; i++) fairnessOrdered(["a"], c);
    // a now stale → promoted alongside c
    expect(fairnessOrdered(["a", "c"], c)).toEqual(["a", "c"]);
  });
});
