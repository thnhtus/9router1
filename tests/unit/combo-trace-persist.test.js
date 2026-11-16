// Combo traces must survive restarts: live ring for the dashboard poll, SQLite for history.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const env = { ...process.env };

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-trace-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete globalThis.__comboTraces;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete globalThis.__comboTraces;
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.env = { ...env };
});

const MODELS = ["openai/gpt-4o", "anthropic/claude", "google/gemini"];

describe("combo trace persistence", () => {
  it("persists a finished run with attempts, cost and timing", async () => {
    const repo = await import("@/lib/db/repos/comboTracesRepo.js");
    const started = Date.now() - 1000;
    await repo.saveComboTrace({
      id: "t1", combo: "demo", strategy: "smart",
      startedAt: started, endedAt: started + 1000,
      status: "answered", cost: 0.42,
      attempts: [{ model: MODELS[0], status: "answered", ms: 900, cost: 0.42, tokens: { in: 10, out: 5 } }],
    });

    const rows = await repo.getComboTraces();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "t1", combo: "demo", strategy: "smart", status: "answered", cost: 0.42, persisted: true });
    expect(rows[0].startedAt).toBe(started);
    expect(rows[0].endedAt).toBe(started + 1000);
    expect(rows[0].attempts[0].tokens).toEqual({ in: 10, out: 5 });
  });

  it("keeps the table capped at 50 runs, newest kept", async () => {
    const repo = await import("@/lib/db/repos/comboTracesRepo.js");
    const base = Date.now() - 100000;
    for (let i = 0; i < 60; i++) {
      await repo.saveComboTrace({
        id: `t${i}`, combo: "c", strategy: "smart",
        startedAt: base + i * 100, endedAt: base + i * 100 + 50, status: "answered", attempts: [],
      });
    }
    const rows = await repo.getComboTraces(100);
    expect(rows).toHaveLength(50);
    expect(rows[0].id).toBe("t59");
    expect(rows.at(-1).id).toBe("t10");
  });

  it("lists persisted runs after the in-memory ring is gone (restart)", async () => {
    const first = await import("open-sse/services/comboTrace.js");
    const trace = first.startComboTrace("demo", "smart", MODELS);
    trace.trying(0);
    trace.answered(0);
    await new Promise((r) => setTimeout(r, 50));

    // Simulate a process restart: ring cleared, modules re-imported.
    delete globalThis.__comboTraces;
    vi.resetModules();
    const second = await import("open-sse/services/comboTrace.js");
    const runs = await second.listComboTraces();

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ combo: "demo", strategy: "smart", status: "answered", persisted: true });
    expect(runs[0].attempts[0]).toMatchObject({ model: MODELS[0], status: "answered" });
  });

  it("does not duplicate a live run that is also persisted", async () => {
    const mod = await import("open-sse/services/comboTrace.js");
    const trace = mod.startComboTrace("demo", "smart", MODELS);
    trace.trying(0);
    trace.answered(0);
    await new Promise((r) => setTimeout(r, 50));

    const runs = await mod.listComboTraces();
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(trace.id);
  });

  it("stamps the combo traceId on usageHistory rows written inside an attempt", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    const mod = await import("open-sse/services/comboTrace.js");

    const trace = mod.startComboTrace("demo", "smart", MODELS);
    trace.trying(0);
    await trace.run(0, () => db.saveRequestUsage({
      provider: "openai", model: "gpt-4o", connectionId: "c1",
      tokens: { prompt_tokens: 7, completion_tokens: 3 }, status: "ok",
    }));
    trace.answered(0);

    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const rows = adapter.all(`SELECT combo, traceId FROM usageHistory`);
    expect(rows).toHaveLength(1);
    expect(rows[0].combo).toBe("demo");
    expect(rows[0].traceId).toBe(trace.id);
  });

  it("leaves traceId null outside a combo run", async () => {
    const db = await import("@/lib/db/index.js");
    await db.initDb();
    await db.saveRequestUsage({
      provider: "openai", model: "gpt-4o", connectionId: "c1",
      tokens: { prompt_tokens: 1, completion_tokens: 1 }, status: "ok",
    });
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const rows = adapter.all(`SELECT traceId FROM usageHistory`);
    expect(rows[0].traceId).toBeNull();
  });
});
