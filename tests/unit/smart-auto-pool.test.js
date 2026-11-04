import { describe, it, expect } from "vitest";
import { augmentModelsWithSmartPool } from "../../open-sse/services/smartAutoPool.js";

const on = { smartAutoPool: { enabled: true, models: ["oc/free-a", "cc/opus", "gh/mini"] } };

describe("augmentModelsWithSmartPool", () => {
  it("appends pool models not already in the combo, smart strategy only", async () => {
    await expect(augmentModelsWithSmartPool(["cc/opus", "cx/gpt"], "smart", on)).resolves.toEqual(["cc/opus", "cx/gpt", "oc/free-a", "gh/mini"]);
  });
  it("leaves non-smart combos, disabled pool and missing settings untouched", async () => {
    const m = ["cc/opus"];
    expect(await augmentModelsWithSmartPool(m, "fallback", on)).toBe(m);
    expect(await augmentModelsWithSmartPool(m, "smart", { smartAutoPool: { enabled: false, models: ["x/y"] } })).toBe(m);
    expect(await augmentModelsWithSmartPool(m, "smart", {})).toBe(m);
  });
});
