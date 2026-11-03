// Jev persistence: hourly counters, breaker events + restore, idempotent Supabase push.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const env = { ...process.env };

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-jev-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.env = { ...env };
  vi.unstubAllGlobals();
});

describe("jev persistence", () => {
  it("aggregates decisions, failures, skips and success-only latency per hour", async () => {
    const j = await import("@/lib/jevLogs.js");
    await j.appendJevLog({ comboName: "c", choice: "a/x", latencyMs: 100 });
    await j.appendJevLog({ comboName: "c", choice: "a/x", latencyMs: 300 });
    await j.appendJevLog({ comboName: "c", error: "timeout", latencyMs: 8000 });
    await j.countJevSkip("c");
    const s = await j.jevStats(24);
    expect(s).toMatchObject({ total: 3, failed: 1, skipped: 1, avgLatencyMs: 200 });
    expect(s.series).toHaveLength(1);

    await j.clearJevLogs(); // clears rows, keeps counters
    expect(await j.listJevLogs()).toHaveLength(0);
    expect((await j.jevStats(24)).total).toBe(3);
  });

  it("restores a still-open breaker and ignores an expired or closed one", async () => {
    const j = await import("@/lib/jevLogs.js");
    expect(await j.loadOpenBreaker()).toBe(0);
    const until = Date.now() + 30000;
    await j.recordBreakerEvent({ kind: "open", failStreak: 3, reason: "timeout", until });
    expect(await j.loadOpenBreaker()).toBe(until);
    await j.recordBreakerEvent({ kind: "close" });
    expect(await j.loadOpenBreaker()).toBe(0);
    await j.recordBreakerEvent({ kind: "open", until: Date.now() - 1 });
    expect(await j.loadOpenBreaker()).toBe(0);
  });

  it("pushes aggregates only (no prompts) and advances event cursor", async () => {
    process.env.JEV_SUPABASE_URL = "https://x.supabase.co";
    process.env.JEV_SUPABASE_SECRET_KEY = "sk";
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 201 }); }));
    const j = await import("@/lib/jevLogs.js");
    await j.appendJevLog({ comboName: "c", latencyMs: 50, request: { messages: [{ content: "SECRET PROMPT" }] } });
    await j.recordBreakerEvent({ kind: "open", until: Date.now() + 1000 });

    expect(await j.pushJevMetrics()).toEqual({ hourly: 1, events: 1 });
    expect(JSON.stringify(calls)).not.toContain("SECRET PROMPT");
    expect(calls[0].url).toContain("/rest/v1/jev_hourly?on_conflict=instance_id,hour,combo_name");
    expect(calls[0].body[0]).toMatchObject({ combo_name: "c", total: 1, latency_sum: 50, latency_n: 1 });

    // Second push: current hour re-sent (overwrite), events not re-sent.
    expect(await j.pushJevMetrics()).toEqual({ hourly: 1, events: 0 });
  });
});
