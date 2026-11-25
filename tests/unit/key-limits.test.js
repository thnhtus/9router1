// Per-API-key rate limits + budgets: shared helpers + engine.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  keys: {}, // apiKey string -> db row
  usage: { requests: 0, tokens: 0, cost: 0 },
  adapterError: false,
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyByKey: async (k) => fx.keys[k] || null,
}));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    get: () => {
      if (fx.adapterError) throw new Error("db down");
      return fx.usage;
    },
  }),
}));
vi.mock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

const engine = await import("../../src/sse/services/keyLimits.js");
const helpers = await import("../../src/shared/utils/keyLimits.js");
const constants = await import("../../src/shared/constants/keyLimits.js");

function makeKey(overrides = {}) {
  return {
    id: "k1",
    name: "test",
    key: "sk-test",
    isActive: true,
    limits: { rpm: 0, tokens: 0, cost: 0, period: "daily" },
    ...overrides,
  };
}
const req = (keyStr, { header = "Authorization", query = false } = {}) => {
  const headers = {};
  if (keyStr && !query) headers[header] = header === "Authorization" ? `Bearer ${keyStr}` : keyStr;
  const url = `http://localhost/v1/chat/completions${query && keyStr ? `?key=${keyStr}` : ""}`;
  return new Request(url, { method: "POST", headers });
};

beforeEach(() => {
  fx.keys = {};
  fx.usage = { requests: 0, tokens: 0, cost: 0 };
  fx.adapterError = false;
  engine.__resetKeyLimitState();
});

describe("shared helpers", () => {
  it("hasKeyLimits true only when at least one field > 0", () => {
    expect(helpers.hasKeyLimits({ rpm: 0, tokens: 0, cost: 0, period: "daily" })).toBe(false);
    expect(helpers.hasKeyLimits({ rpm: 5, tokens: 0, cost: 0, period: "daily" })).toBe(true);
    expect(helpers.hasKeyLimits(null)).toBe(false);
  });
  it("validateKeyLimitsInput rejects unknown fields and bad values", () => {
    expect(helpers.validateKeyLimitsInput({ rpm: 10 }).ok).toBe(true);
    expect(helpers.validateKeyLimitsInput({ foo: 1 }).ok).toBe(false);
    expect(helpers.validateKeyLimitsInput({ rpm: -1 }).ok).toBe(false);
    expect(helpers.validateKeyLimitsInput({ rpm: 1.5 }).ok).toBe(false);
    expect(helpers.validateKeyLimitsInput({ cost: 200 }).ok).toBe(false);
    expect(helpers.validateKeyLimitsInput({ period: "yearly" }).ok).toBe(false);
    expect(helpers.validateKeyLimitsInput(null).ok).toBe(false);
  });
  it("budgetPeriodStart returns UTC ISO for daily/monthly", () => {
    const now = new Date("2026-11-23T14:30:00Z");
    const d = helpers.budgetPeriodStart("daily", now);
    expect(d).toBe("2026-11-23T00:00:00.000Z");
    const m = helpers.budgetPeriodStart("monthly", now);
    expect(m).toBe("2026-11-01T00:00:00.000Z");
  });
  it("keyLimitsFromColumns maps DB columns", () => {
    const l = helpers.keyLimitsFromColumns({ limitRpm: 5, limitTokens: 1000, limitCost: 2, limitPeriod: "monthly" });
    expect(l).toEqual({ rpm: 5, tokens: 1000, cost: 2, period: "monthly" });
  });
});

describe("engine context", () => {
  it("returns null for no key / unknown key / unlimited key", async () => {
    fx.keys["sk-lim"] = makeKey({ limits: { rpm: 5, tokens: 0, cost: 0, period: "daily" } });
    expect(await engine.getKeyLimitsContext(req(null))).toBeNull();
    expect(await engine.getKeyLimitsContext(req("sk-nope"))).toBeNull();
    // unlimited key not stored → null
    fx.keys["sk-unl"] = makeKey({ key: "sk-unl", limits: { rpm: 0, tokens: 0, cost: 0, period: "daily" } });
    expect(await engine.getKeyLimitsContext(req("sk-unl"))).toBeNull();
  });
});

describe("rate limit (rpm)", () => {
  it("allows up to rpm then returns 429", async () => {
    fx.keys["sk-r"] = makeKey({ key: "sk-r", limits: { rpm: 2, tokens: 0, cost: 0, period: "daily" } });
    const ctx = await engine.getKeyLimitsContext(req("sk-r"));
    expect((await engine.enforceKeyLimits(ctx))?.status).toBeUndefined(); // first allowed
    expect((await engine.enforceKeyLimits(ctx))?.status).toBeUndefined(); // second allowed
    const r = await engine.enforceKeyLimits(ctx);
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
  it("query-string key also enforced", async () => {
    fx.keys["sk-q"] = makeKey({ key: "sk-q", limits: { rpm: 1, tokens: 0, cost: 0, period: "daily" } });
    const ctx = await engine.getKeyLimitsContext(req("sk-q", { query: true }));
    expect(await engine.enforceKeyLimits(ctx)).toBeNull();
    const r = await engine.enforceKeyLimits(ctx);
    expect(r.status).toBe(429);
  });
});

describe("budget (tokens / cost)", () => {
  it("returns 402 when tokens exhausted", async () => {
    fx.keys["sk-t"] = makeKey({ key: "sk-t", limits: { rpm: 0, tokens: 100, cost: 0, period: "daily" } });
    fx.usage = { requests: 5, tokens: 100, cost: 0 };
    const ctx = await engine.getKeyLimitsContext(req("sk-t"));
    const r = await engine.enforceKeyLimits(ctx);
    expect(r.status).toBe(402);
  });
  it("returns 402 when cost exhausted", async () => {
    fx.keys["sk-c"] = makeKey({ key: "sk-c", limits: { rpm: 0, tokens: 0, cost: 1, period: "daily" } });
    fx.usage = { requests: 5, tokens: 0, cost: 1 };
    const ctx = await engine.getKeyLimitsContext(req("sk-c"));
    const r = await engine.enforceKeyLimits(ctx);
    expect(r.status).toBe(402);
  });
  it("allows when under budget", async () => {
    fx.keys["sk-u"] = makeKey({ key: "sk-u", limits: { rpm: 0, tokens: 100, cost: 1, period: "daily" } });
    fx.usage = { requests: 1, tokens: 10, cost: 0.1 };
    const ctx = await engine.getKeyLimitsContext(req("sk-u"));
    expect(await engine.enforceKeyLimits(ctx)).toBeNull();
  });
});

describe("fail-open", () => {
  it("db error does not block the request", async () => {
    fx.keys["sk-f"] = makeKey({ key: "sk-f", limits: { rpm: 0, tokens: 100, cost: 0, period: "daily" } });
    fx.adapterError = true;
    const ctx = await engine.getKeyLimitsContext(req("sk-f"));
    expect(await engine.enforceKeyLimits(ctx)).toBeNull();
  });
});

describe("enforceKeyLimitsForRequest", () => {
  it("returns null for an unlimited/no-key request", async () => {
    expect(await engine.enforceKeyLimitsForRequest(req(null))).toBeNull();
  });
});
