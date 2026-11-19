// Migration #3 cleans stored gemini-web state left behind by the model-id
// recalibration: phantom customModels rows and modelLock_* keys naming ids that
// are no longer advertised. A lock for a CURRENT id must survive.
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import migration from "../../src/lib/db/migrations/003-gemini-web-model-ids.js";
import registry from "../../open-sse/providers/registry/gemini-web.js";

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE kv (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (scope, key));
    CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL, data TEXT NOT NULL);
  `);
  return db;
}

const adapterFor = (db) => ({
  all: (sql, params = []) => db.prepare(sql).all(...params),
  get: (sql, params = []) => db.prepare(sql).get(...params),
  run: (sql, params = []) => db.prepare(sql).run(...params),
  exec: (sql) => db.exec(sql),
});

const currentChatId = registry.models.find((m) => m.kind !== "image").id;

describe("migration 003 gemini-web-model-ids", () => {
  it("drops phantom custom models but keeps real advertised ids", () => {
    const db = makeDb();
    const insert = db.prepare("INSERT INTO kv(scope,key,value) VALUES(?,?,?)");
    insert.run("customModels", "gemini-web|gemini-9-phantom|llm", JSON.stringify({ providerAlias: "gemini-web", id: "gemini-9-phantom", type: "llm" }));
    insert.run("customModels", `gemini-web|${currentChatId}|llm`, JSON.stringify({ providerAlias: "gemini-web", id: currentChatId, type: "llm" }));
    insert.run("customModels", "oc|keep-me|llm", JSON.stringify({ providerAlias: "oc", id: "keep-me", type: "llm" }));

    migration.up(adapterFor(db));

    const keys = db.prepare("SELECT key FROM kv WHERE scope='customModels'").all().map((r) => r.key);
    expect(keys).toEqual([`gemini-web|${currentChatId}|llm`, "oc|keep-me|llm"]);
  });

  it("removes stale modelLock_* keys and keeps the lock for a current id", () => {
    const db = makeDb();
    const data = {
      apiKey: "cookie",
      ["modelLock_gemini-3.1-pro"]: "2099-01-01T00:00:00.000Z",
      [`modelLock_${currentChatId}`]: "2099-01-01T00:00:00.000Z",
    };
    db.prepare("INSERT INTO providerConnections(id,provider,data) VALUES(?,?,?)").run("c1", "gemini-web", JSON.stringify(data));

    migration.up(adapterFor(db));

    const stored = JSON.parse(db.prepare("SELECT data FROM providerConnections WHERE id='c1'").get().data);
    expect(stored.apiKey).toBe("cookie");
    expect(stored["modelLock_gemini-3.1-pro"]).toBeUndefined();
    expect(stored[`modelLock_${currentChatId}`]).toBe("2099-01-01T00:00:00.000Z");
  });

  it("leaves other providers' connections untouched", () => {
    const db = makeDb();
    const data = { apiKey: "k", modelLock_gone: "2099-01-01T00:00:00.000Z" };
    db.prepare("INSERT INTO providerConnections(id,provider,data) VALUES(?,?,?)").run("c2", "openai", JSON.stringify(data));

    migration.up(adapterFor(db));

    expect(JSON.parse(db.prepare("SELECT data FROM providerConnections WHERE id='c2'").get().data)).toEqual(data);
  });

  it("is idempotent", () => {
    const db = makeDb();
    db.prepare("INSERT INTO kv(scope,key,value) VALUES(?,?,?)").run("customModels", "gemini-web|gone|llm", JSON.stringify({ providerAlias: "gemini-web", id: "gone", type: "llm" }));
    migration.up(adapterFor(db));
    expect(() => migration.up(adapterFor(db))).not.toThrow();
    expect(db.prepare("SELECT key FROM kv WHERE scope='customModels'").all()).toHaveLength(0);
  });
});
