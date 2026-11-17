// Regression: Claude's OAuth token response carries no email, so a re-login
// skipped dedup (`data.email` falsy) and inserted a NEW row at MAX(priority)+1
// while the revoked row kept priority 1 and its modelLock_*/unavailable state.
// getProviderCredentials is fill-first by priority, so it kept picking the dead
// row and every request failed 401 "OAuth access token has been revoked",
// no matter how many times the user re-authed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-emailless-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("createProviderConnection — email-less OAuth re-login", () => {
  it("updates the existing row instead of stacking a second one", async () => {
    const first = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "revoked-at",
      refreshToken: "revoked-rt",
      testStatus: "active",
    });

    // Simulate the failure state the router writes after a 401.
    await db.updateProviderConnection(first.id, {
      testStatus: "unavailable",
      lastError: "[401]: OAuth access token has been revoked.",
      errorCode: 401,
      modelLock_claude_opus_5: new Date(Date.now() + 120_000).toISOString(),
    });

    const second = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "fresh-at",
      refreshToken: "fresh-rt",
      testStatus: "active",
    });

    const pool = await db.getProviderConnections({ provider: "claude" });
    expect(pool).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(pool[0].accessToken).toBe("fresh-at");
    // resetHealthStateOnActivation must clear the stale lock + error state.
    expect(pool[0].testStatus).toBe("active");
    expect(pool[0].modelLock_claude_opus_5).toBeNull();
    expect(pool[0].errorCode).toBeNull();
  });

  it("does not collapse onto an ambiguous pool of two email-less rows", async () => {
    // Two email-less rows already exist (two separate accounts): identity is
    // unknowable, so a third login must create its own row rather than
    // overwrite one at random.
    const a = await db.createProviderConnection({ provider: "kimi", authType: "oauth", accessToken: "a" });
    await db.updateProviderConnection(a.id, { email: null });
    // Second email-less row: created while the pool is size 1, so dedup would
    // merge it — insert it directly to build the ambiguous two-row state.
    await db.createProviderConnection({ provider: "kimi", authType: "oauth", email: "tmp@example.com", accessToken: "b" });
    const rows = await db.getProviderConnections({ provider: "kimi" });
    const second = rows.find(c => c.accessToken === "b");
    await db.updateProviderConnection(second.id, { email: null });

    const third = await db.createProviderConnection({ provider: "kimi", authType: "oauth", accessToken: "c" });
    const pool = await db.getProviderConnections({ provider: "kimi" });
    expect(pool).toHaveLength(3);
    expect(pool.find(c => c.id === third.id).accessToken).toBe("c");
  });

  it("keeps email-based dedup working", async () => {
    const a = await db.createProviderConnection({
      provider: "codex", authType: "oauth", email: "x@example.com", accessToken: "1",
      providerSpecificData: { chatgptAccountId: "acc-1" },
    });
    const b = await db.createProviderConnection({
      provider: "codex", authType: "oauth", email: "x@example.com", accessToken: "2",
      providerSpecificData: { chatgptAccountId: "acc-1" },
    });
    expect(b.id).toBe(a.id);
    expect(b.accessToken).toBe("2");
  });
});
