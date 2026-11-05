import { describe, it, expect } from "vitest";
import { fairnessOrdered, markComboMember, FAIR_STALE_TURNS } from "../../open-sse/services/combo.js";

describe("combo fairness: per-turn soft head", () => {
  it("Jev pick (softHead) stays first most turns", () => {
    const c = `pt-${Math.random()}`;
    for (let i = 0; i < FAIR_STALE_TURNS; i++) {
      expect(fairnessOrdered(["a", "b", "c"], c, null, "b")[0]).toBe("b");
    }
  });

  it("stale member jumps ahead of Jev pick at most once per FAIR_STALE_TURNS turns", () => {
    const c = `pt-${Math.random()}`;
    // "a" never used -> stale from turn 1. "b" is Jev's per-turn pick every turn.
    const heads = [];
    for (let i = 0; i < FAIR_STALE_TURNS * 2; i++) {
      heads.push(fairnessOrdered(["a", "b"], c, null, "b")[0]);
    }
    const exploreTurns = heads.filter((h) => h === "a").length;
    // Exploration happens, but rarely: at most one stale-promotion per FAIR_STALE_TURNS turns.
    expect(exploreTurns).toBeGreaterThan(0);
    expect(exploreTurns).toBeLessThanOrEqual(2);
  });

  it("a model that failed recently is demoted even as Jev's pick", () => {
    const c = `pt-${Math.random()}`;
    markComboMember(c, "b", true); // b just failed
    const order = fairnessOrdered(["a", "b", "c"], c, null, "b");
    expect(order[0]).not.toBe("b");
    expect(order[order.length - 1]).toBe("b");
  });

  it("hard head (forced/sticky) always wins over soft head", () => {
    const c = `pt-${Math.random()}`;
    const order = fairnessOrdered(["a", "b", "c"], c, "a", "b");
    expect(order[0]).toBe("a");
  });
});

describe("Jev criteria carry combo health", async () => {
  const { addHealth } = await import("../../src/sse/services/systemoneRouter.js");
  it("marks a model that keeps failing as unreliable", () => {
    const c = `h-${Math.random()}`;
    fairnessOrdered(["a", "b"], c);
    markComboMember(c, "a", true);
    markComboMember(c, "b");
    const crit = addHealth({ a: "cost: free", b: "cost: free" }, c);
    expect(crit.a).toContain("unreliable");
    expect(crit.a).toContain("failed recently");
    expect(crit.b).toBe("cost: free");
  });
});
