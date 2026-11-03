import { describe, it, expect } from "vitest";
import { augmentModelsWithSmartPool } from "open-sse/services/smartAutoPool.js";

const settings = { smartAutoPool: { enabled: true, models: ["cmc-free", "free-tier", "x/a"] } };
const combos = { "cmc-free": ["x/a", "x/c"], "free-tier": ["x/c", "x/d"] };
const lookup = async (n) => combos[n] || null;

describe("augmentModelsWithSmartPool", () => {
  it("skips the combo itself and flattens pool combos without duplicates", async () => {
    expect(await augmentModelsWithSmartPool(["x/a", "x/b"], "smart", settings, "cmc-free", lookup))
      .toEqual(["x/a", "x/b", "x/c", "x/d"]);
  });
  it("flattens nested combos and survives cycles", async () => {
    const nested = { a: ["b", "x/1"], b: ["a", "x/2"] };
    const s = { smartAutoPool: { enabled: true, models: ["a"] } };
    expect(await augmentModelsWithSmartPool(["x/0"], "smart", s, "top", async (n) => nested[n] || null))
      .toEqual(["x/0", "x/2", "x/1"]);
  });
  it("is a no-op for non-smart combos", async () => {
    expect(await augmentModelsWithSmartPool(["x/a"], "fallback", settings, "c", lookup)).toEqual(["x/a"]);
  });
});
