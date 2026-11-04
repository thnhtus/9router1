import { describe, it, expect, vi } from "vitest";

import { handleOrchestrateChat } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

function okResponse(content) {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, clone: make, json: async () => json });
  return make();
}

const plan = JSON.stringify({ subtasks: [
  { title: "A", instruction: "do a" },
  { title: "B", instruction: "do b" },
  { title: "C", instruction: "do c" },
] });

describe("orchestrate combo", () => {
  it("plans, fans out round-robin to workers, then synthesizes with the planner", async () => {
    const calls = [];
    const handleSingleModel = vi.fn(async (body, model, isPanel) => {
      calls.push({ model, isPanel, body });
      const last = body.messages.at(-1).content;
      if (model === "p/brain" && last.includes("PLANNER")) return okResponse("Plan:\n```json\n" + plan + "\n```");
      if (model === "p/brain") return okResponse("FINAL");
      return okResponse(`res-${model}-${last.slice(-4)}`);
    });

    const res = await handleOrchestrateChat({
      body: { messages: [{ role: "user", content: "Q" }], stream: true, tools: [{ name: "x" }] },
      models: ["p/w1", "p/w2"],
      handleSingleModel,
      log,
      comboName: "team",
      plannerModel: "p/brain",
    });

    expect(calls.map((c) => c.model)).toEqual(["p/brain", "p/w1", "p/w2", "p/w1", "p/brain"]);
    for (const c of calls.slice(0, 4)) {
      expect(c.body.stream).toBe(false);
      expect(c.body.tools).toBeUndefined();
      expect(c.isPanel).toBe(true);
    }
    const final = calls[4];
    expect(final.body.stream).toBe(true);
    expect(final.body.tools).toEqual([{ name: "x" }]);
    expect(final.body.messages.at(-1).content).toContain("[B]");
    expect(final.body.messages.at(-1).content).toContain("res-p/w2-do b");
    expect(await (await res.json()).choices[0].message.content).toBe("FINAL");
  });

  it("answers directly when the planner returns no subtasks or junk", async () => {
    for (const reply of ['{"subtasks":[]}', "not json at all"]) {
      const handleSingleModel = vi.fn(async (body, model) => okResponse(model === "p/brain" && body.messages.at(-1).content.includes("PLANNER") ? reply : "DIRECT"));
      await handleOrchestrateChat({ body: { messages: [{ role: "user", content: "hi" }] }, models: ["p/w1"], handleSingleModel, log, plannerModel: "p/brain" });
      expect(handleSingleModel.mock.calls.map((c) => c[1])).toEqual(["p/brain", "p/brain"]);
      expect(handleSingleModel.mock.calls[1][0].messages).toEqual([{ role: "user", content: "hi" }]);
    }
  });

  it("skips planning on tool-result turns of an agent loop", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("next step"));
    await handleOrchestrateChat({
      body: { messages: [{ role: "user", content: "Q" }, { role: "assistant", content: "", tool_calls: [{ function: { name: "read" } }] }, { role: "tool", content: "file" }] },
      models: ["p/w1", "p/w2"],
      handleSingleModel,
      log,
      plannerModel: "p/brain",
    });
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(handleSingleModel.mock.calls[0][1]).toBe("p/brain");
  });

  it("falls back to the planner when every worker fails", async () => {
    const handleSingleModel = vi.fn(async (body, model) => {
      if (model === "p/brain") return okResponse(body.messages.at(-1).content.includes("PLANNER") ? plan : "DIRECT");
      return { ok: false, status: 500, clone() { return this; }, json: async () => ({}) };
    });
    await handleOrchestrateChat({ body: { messages: [{ role: "user", content: "Q" }] }, models: ["p/w1"], handleSingleModel, log, plannerModel: "p/brain" });
    const lastCall = handleSingleModel.mock.calls.at(-1);
    expect(lastCall[1]).toBe("p/brain");
    expect(lastCall[0].messages).toEqual([{ role: "user", content: "Q" }]);
  });
});

describe("orchestrate: assignment, isolation, review", () => {
  const assigned = JSON.stringify({ subtasks: [
    { title: "A", worker: "p/w2", instruction: "do a" },
    { title: "B", worker: "nope", instruction: "do b" },
  ] });

  it("uses the planner's worker choice, isolates workers, retries rejected results once", async () => {
    const calls = [];
    let tries = 0;
    const handleSingleModel = vi.fn(async (body, model) => {
      calls.push({ model, body });
      const last = body.messages.at(-1).content;
      if (model === "p/brain" && last.includes("PLANNER")) return okResponse(assigned);
      if (model === "p/brain" && last.includes("REVIEWER")) return okResponse(JSON.stringify({ retry: [{ index: 0, feedback: "too short" }] }));
      if (model === "p/brain") return okResponse("FINAL");
      if (last.includes("too short")) return okResponse("fixed-a");
      tries++;
      return okResponse(`res-${last.slice(-4)}`);
    });

    await handleOrchestrateChat({
      body: { system: "secret sys", messages: [{ role: "user", content: "history Q" }] },
      models: ["p/w1", "p/w2"],
      handleSingleModel,
      log,
      plannerModel: "p/brain",
      tuning: { reviewRounds: 1 },
    });

    const workerCalls = calls.filter((c) => c.model !== "p/brain");
    expect(workerCalls.map((c) => c.model)).toEqual(["p/w2", "p/w2", "p/w2"]); // B: invalid → round-robin index 1
    for (const c of workerCalls) {
      expect(c.body.messages).toHaveLength(1);
      expect(c.body.system).toBeUndefined();
      expect(JSON.stringify(c.body)).not.toContain("history Q");
    }
    expect(tries).toBe(2);
    const final = calls.at(-1);
    expect(final.model).toBe("p/brain");
    expect(final.body.messages.at(-1).content).toContain("fixed-a");
    expect(calls.filter((c) => c.model === "p/brain" && c.body.messages.at(-1).content.includes("REVIEWER"))).toHaveLength(1);
  });
});
