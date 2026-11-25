// Per-API-key limits: a DB written by schema v7 (apiKeys without the limit
// columns) upgrades in place, keeps its rows, and every existing key reads as
// unlimited (limit 0). Mirrors the access-column migration test but builds the
// legacy DB by stripping the columns from a real v8 database, so it exercises
// the actual upgrade path without re-declaring the whole old schema.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
const dbFile = () => path.join(tempDir, "db", "data.sqlite");

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  return { db, adapter: await getAdapter() };
}

function closeAdapter() {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-limits-migration-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  closeAdapter();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("apiKeys limit columns: upgrade from schema v7", () => {
  it("re-adds the columns and reads existing keys as unlimited", async () => {
    // 1. Build a current DB with one key that already has a limit set.
    const first = await boot();
    const created = await first.db.createApiKey("kept", "m", { rpm: 7, tokens: 100, cost: 1, period: "monthly" });
    closeAdapter();

    // 2. Downgrade it to the v7 shape: drop the limit columns, stamp version 7.
    const raw = new DatabaseSync(dbFile());
    for (const col of ["limitRpm", "limitTokens", "limitCost", "limitPeriod"]) {
      raw.exec(`ALTER TABLE apiKeys DROP COLUMN ${col}`);
    }
    raw.exec(`UPDATE _meta SET value = '7' WHERE key = 'schemaVersion'`);
    raw.exec(`UPDATE _meta SET value = '7' WHERE key = 'backupSchemaVersion'`);
    const before = raw.prepare("SELECT id, name FROM apiKeys").all();
    raw.close();

    // 3. Boot again: migration must restore the columns, keep the row, reset limits.
    const { db, adapter } = await boot();
    const cols = adapter.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["limitRpm", "limitTokens", "limitCost", "limitPeriod"]));

    const keys = await db.getApiKeys();
    expect(keys.map((k) => [k.id, k.name])).toEqual(before.map((r) => [r.id, r.name]));
    expect(keys[0].limits).toEqual({ rpm: 0, tokens: 0, cost: 0, period: "daily" });
    expect(keys[0].id).toBe(created.id);

    // The migration took the pre-change safety backup.
    const backups = fs.readdirSync(path.join(tempDir, "db", "backups"));
    expect(backups.some((d) => d.startsWith("schema-7-to-"))).toBe(true);

    // Limits set after the upgrade persist and enforce normally.
    await db.updateApiKey(created.id, { limits: { rpm: 3, tokens: 0, cost: 0, period: "daily" } });
    expect((await db.getApiKeyById(created.id)).limits).toMatchObject({ rpm: 3 });
  });

  it("has the usageHistory(apiKey, timestamp) index the budget query needs", async () => {
    const { adapter } = await boot();
    const idx = adapter.all(`PRAGMA index_list(usageHistory)`).map((i) => i.name);
    expect(idx).toContain("idx_uh_apikey");
  });
});
