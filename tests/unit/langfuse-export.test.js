import { describe, it, expect, vi } from "vitest";
import { langfuseConfig, buildLangfuseBatch, exportComboRun } from "../../open-sse/services/langfuseExport.js";

const run = {
  id: "r1", combo: "auto", strategy: "fallback", startedAt: 1000, endedAt: 3000, status: "answered", cost: 0.002,
  attempts: [
    { model: "a", status: "failed", at: 1000, ms: 200, code: 429, reason: "rate", cost: null, tokens: null },
    { model: "b", status: "answered", at: 1300, ms: 500, code: null, reason: null, cost: 0.002, tokens: { in: 10, out: 5 } },
    { model: "c", status: "skipped", at: null, ms: null },
  ],
};

describe("langfuseConfig", () => {
  it("is null without both keys", () => {
    expect(langfuseConfig({})).toBeNull();
    expect(langfuseConfig({ LANGFUSE_PUBLIC_KEY: "pk" })).toBeNull();
  });
  it("builds basic auth and trims host slash", () => {
    const c = langfuseConfig({ LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", LANGFUSE_HOST: "http://lf/" });
    expect(c.auth).toBe("Basic " + Buffer.from("pk:sk").toString("base64"));
    expect(c.host).toBe("http://lf");
  });
});

describe("buildLangfuseBatch", () => {
  it("emits one trace plus one generation per attempted model, skipping waiting/skipped", () => {
    const batch = buildLangfuseBatch(run);
    expect(batch.map((e) => e.type)).toEqual(["trace-create", "generation-create", "generation-create"]);
    expect(batch[0].body.name).toBe("combo:auto");
    const [, failed, ok] = batch;
    expect(failed.body.level).toBe("ERROR");
    expect(failed.body.statusMessage).toBe("rate");
    expect(ok.body.usage).toEqual({ input: 10, output: 5 });
    expect(ok.body.traceId).toBe("r1");
  });
  it("never includes prompt or response fields", () => {
    const s = JSON.stringify(buildLangfuseBatch({ ...run, attempts: [{ ...run.attempts[1], prompt: "secret" }] }));
    expect(s).not.toContain("secret");
  });
});

describe("exportComboRun", () => {
  it("is a no-op without env", async () => {
    const fetchImpl = vi.fn();
    expect(await exportComboRun(run, { env: {}, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("posts batch to /api/public/ingestion with basic auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const env = { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", LANGFUSE_HOST: "http://lf" };
    expect(await exportComboRun(run, { env, fetchImpl })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://lf/api/public/ingestion");
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(init.body).batch).toHaveLength(3);
  });
});
