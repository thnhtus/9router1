// /api/keys limits contract: create, update, validation, and the usage snapshot
// returned by GET /api/keys/[id]. Runs against a real SQLite DB in a temp DATA_DIR.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let createKey, updateKey, getKey;

const putLimits = (id, limits) =>
  updateKey(jsonRequest(`http://localhost/api/keys/${id}`, "PUT", { limits }), { params: Promise.resolve({ id }) });

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-limits-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
  ({ POST: createKey } = await import("@/app/api/keys/route.js"));
  ({ PUT: updateKey, GET: getKey } = await import("@/app/api/keys/[id]/route.js"));
});

afterEach(() => {
  vi.doUnmock("next/server");
  vi.resetModules();
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("POST /api/keys with limits", () => {
  it("creates a key with no limits (unlimited) by default", async () => {
    const res = await createKey(jsonRequest("http://localhost/api/keys", "POST", { name: "plain" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.limits).toEqual({ rpm: 0, tokens: 0, cost: 0, period: "daily" });
  });

  it("persists limits given at creation", async () => {
    const res = await createKey(
      jsonRequest("http://localhost/api/keys", "POST", { name: "limited", limits: { rpm: 30, tokens: 2000, cost: 5, period: "monthly" } })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.limits).toEqual({ rpm: 30, tokens: 2000, cost: 5, period: "monthly" });
  });

  it("rejects an invalid limits payload with 400", async () => {
    for (const limits of [{ rpm: -5 }, { foo: 1 }, { rpm: 1.5 }, { period: "weekly" }, { tokens: 9_999_999_999 }]) {
      const res = await createKey(jsonRequest("http://localhost/api/keys", "POST", { name: "bad", limits }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
  });
});

describe("PUT /api/keys/[id] limits", () => {
  it("updates limits and leaves them out when not supplied", async () => {
    const created = await (await createKey(jsonRequest("http://localhost/api/keys", "POST", { name: "k" }))).json();

    const res = await putLimits(created.id, { rpm: 10, period: "monthly" });
    expect(res.status).toBe(200);
    expect((await res.json()).key.limits).toMatchObject({ rpm: 10, period: "monthly" });

    // A rename without `limits` must not clear the stored limits.
    const renamed = await updateKey(jsonRequest(`http://localhost/api/keys/${created.id}`, "PUT", { name: "renamed" }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect((await renamed.json()).key.limits).toMatchObject({ rpm: 10, period: "monthly" });
  });

  it("rejects invalid limits on update", async () => {
    const created = await (await createKey(jsonRequest("http://localhost/api/keys", "POST", { name: "k2" }))).json();
    const res = await putLimits(created.id, { rpm: 601 });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/keys/[id] usage snapshot", () => {
  it("returns an empty usage block for a fresh key", async () => {
    const created = await (await createKey(jsonRequest("http://localhost/api/keys", "POST", { name: "u" }))).json();
    const res = await getKey(new Request(`http://localhost/api/keys/${created.id}`), { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key.id).toBe(created.id);
    expect(body.usage).toMatchObject({ requests: 0, tokens: 0, cost: 0 });
    expect(body.usage.periodStart).toBeTruthy();
    expect(body.usage.resetsAt).toBeTruthy();
  });

  it("404s for an unknown id", async () => {
    const res = await getKey(new Request("http://localhost/api/keys/nope"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});
