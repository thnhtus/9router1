// Combo auto-drop: a member unreachable COMBO_DROP_FAILS routings in a row is removed from the combo.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-drop-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});
afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

it("drops after 5 dead routings, resets on success, ignores request-scoped, keeps last member", async () => {
  const repo = await import("@/lib/db/repos/combosRepo.js");
  const { markComboMember, COMBO_DROP_FAILS, getComboHealthMap } = await import("../../open-sse/services/combo.js");
  await repo.createCombo({ name: "c", models: ["a", "b"] });

  for (let i = 0; i < COMBO_DROP_FAILS - 1; i++) expect(markComboMember("c", "a", true)).toBeNull();
  markComboMember("c", "a"); // success resets streak
  for (let i = 0; i < 10; i++) markComboMember("c", "a", true, false); // request-scoped: no count
  expect((await getComboHealthMap()).c).toBeUndefined();

  for (let i = 0; i < COMBO_DROP_FAILS - 1; i++) markComboMember("c", "a", true);
  expect((await getComboHealthMap()).c.a.failStreak).toBe(4);
  expect(await markComboMember("c", "a", true)).toBe(true);
  expect((await repo.getComboByName("c")).models).toEqual(["b"]);
  expect((await getComboHealthMap()).c.a.removedAt).toBeTruthy();

  for (let i = 0; i < COMBO_DROP_FAILS - 1; i++) markComboMember("c", "b", true);
  expect(await markComboMember("c", "b", true)).toBe(false); // last member stays
  expect((await repo.getComboByName("c")).models).toEqual(["b"]);

  // Custom threshold (2) and disabled (0)
  await repo.createCombo({ name: "c2", models: ["x", "y"] });
  expect(markComboMember("c2", "x", true, true, 0)).toBeNull(); // streak=1, 0 = never drop
  expect(await markComboMember("c2", "x", true, true, 2)).toBe(true); // streak=2 >= 2 → dropped
  expect((await repo.getComboByName("c2")).models).toEqual(["y"]);

  // Fusion panel + Orchestrate worker honor dropFails too
  const { handleFusionChat, handleOrchestrateChat } = await import("../../open-sse/services/combo.js");
  const noopLog = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
  const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  await repo.createCombo({ name: "fus", models: ["good", "bad"] });
  for (let i = 0; i < 2; i++) {
    await handleFusionChat({
      body: { messages: [{ role: "user", content: "Explain fusion routing carefully" }] },
      models: ["good", "bad"],
      comboName: "fus",
      dropFails: 2,
      log: noopLog,
      handleSingleModel: async (_b, m) => m === "bad"
        ? jsonRes(502, { error: { message: "down" } })
        : jsonRes(200, { choices: [{ message: { role: "assistant", content: "ok" } }] }),
    });
  }
  await new Promise((r) => setTimeout(r, 20));
  expect((await repo.getComboByName("fus")).models).toEqual(["good"]);

  await repo.createCombo({ name: "orch", models: ["p", "w1", "w2"] });
  for (let i = 0; i < 2; i++) {
    await handleOrchestrateChat({
      body: { messages: [{ role: "user", content: "Step 1 analyze logs, step 2 compare outputs, step 3 write report" }] },
      models: ["p", "w1", "w2"],
      comboName: "orch",
      plannerModel: "p",
      dropFails: 2,
      log: noopLog,
      handleSingleModel: async (_b, m, isPanel) => {
        if (m === "p" && isPanel) return jsonRes(200, { choices: [{ message: { role: "assistant", content: JSON.stringify({ subtasks: [{ title: "A", worker: "w2", instruction: "do A" }, { title: "B", worker: "w1", instruction: "do B" }] }) } }] });
        if (m === "w2") return jsonRes(503, { error: { message: "dead" } });
        return jsonRes(200, { choices: [{ message: { role: "assistant", content: "done" } }] });
      },
    });
  }
  await new Promise((r) => setTimeout(r, 20));
  expect((await repo.getComboByName("orch")).models).toEqual(["p", "w1"]);
});
