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

describe("combo answer streak cap", async () => {
  const { capHeadStreak, recordComboAnswer, HEAD_STREAK_MAX } = await import("../../open-sse/services/combo.js");
  it("same model answers at most HEAD_STREAK_MAX turns in a row, counted on the real answerer", () => {
    const c = `hs-${Math.random()}`;
    const answers = [];
    for (let i = 0; i < 20; i++) {
      const order = capHeadStreak(["a", "b", "c", "d"], c);
      const answer = order[0] === "b" ? order[1] : order[0]; // "b" always fails over to the next
      recordComboAnswer(c, null, answer);
      answers.push(answer);
    }
    let run = 1;
    for (let i = 1; i < answers.length; i++) {
      run = answers[i] === answers[i - 1] ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(HEAD_STREAK_MAX);
    }
    expect(answers).not.toContain("b");
    expect(answers.slice(0, HEAD_STREAK_MAX + 1)).toEqual(["a", "a", "a", answers[3]]);
    expect(answers[3]).not.toBe("a");
  });
});
