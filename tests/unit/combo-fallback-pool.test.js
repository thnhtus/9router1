import { describe, it, expect } from "vitest";
import { handleComboChat } from "open-sse/services/combo.js";

const log = { info() {}, warn() {}, error() {}, debug() {} };

describe("handleComboChat fallbackPool", () => {
  it("tries pool models only after every combo model fails", async () => {
    const tried = [];
    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["a/1", "b/2"],
      fallbackPool: ["p/3", "a/1"],
      handleSingleModel: async (_b, m) => {
        tried.push(m);
        return m === "p/3" ? new Response("{}", { status: 200 }) : new Response("down", { status: 503 });
      },
      log, comboName: "t-pool", comboStrategy: "fallback",
    });
    expect(tried).toEqual(["a/1", "b/2", "p/3"]);
    expect(res.status).toBe(200);
  });
});
