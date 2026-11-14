// ⚠️ AGENT/DEV: Bump this by +1 EVERY TIME you change the schema below
// (add/remove/alter a table, column, or index in TABLES). It drives the
// pre-change safety backup in migrate.js: when the stored version is lower,
// one lightweight DB backup is taken before applying schema changes. Forgetting
// to bump only skips that backup — it does NOT break the additive auto-sync.
export const SCHEMA_VERSION = 5;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      // Per-key access control. Additive columns, picked up by
      // syncSchemaFromTables() on boot; existing rows read as unrestricted (0).
      accessRestricted: "INTEGER DEFAULT 0",
      accessAllow: "TEXT",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)"],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      combo: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
      "CREATE INDEX IF NOT EXISTS idx_uh_combo ON usageHistory(combo)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
  // Jev (System One) routing audit: one row per decision, capped at 1000 (src/lib/jevLogs.js).
  jevLogs: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      createdAt: "TEXT NOT NULL",
      comboName: "TEXT",
      routerModel: "TEXT",
      choice: "TEXT",
      confidence: "REAL",
      latencyMs: "INTEGER",
      status: "INTEGER",
      error: "TEXT",
      request: "TEXT",
      response: "TEXT",
    },
  },
  // Hourly Jev counters, kept forever (small) so stats survive the jevLogs cap and restarts.
  jevHourly: {
    columns: {
      hour: "TEXT NOT NULL", // ISO, truncated to the hour (UTC)
      comboName: "TEXT NOT NULL DEFAULT ''",
      total: "INTEGER NOT NULL DEFAULT 0",
      failed: "INTEGER NOT NULL DEFAULT 0",
      skipped: "INTEGER NOT NULL DEFAULT 0", // requests that bypassed Jev while the breaker was open
      latencySum: "INTEGER NOT NULL DEFAULT 0",
      latencyN: "INTEGER NOT NULL DEFAULT 0",
    },
    primaryKey: "PRIMARY KEY (hour, comboName)",
  },
  // Hourly token-saver counters (Jev-gated lossy savers + RTK), kept forever (small rows).
  // level = 'L1'..'L4' when Jev classified the turn, '' when no signal (no smart combo).
  tokenSaverHourly: {
    columns: {
      hour: "TEXT NOT NULL", // ISO, truncated to the hour (UTC)
      level: "TEXT NOT NULL DEFAULT ''",
      total: "INTEGER NOT NULL DEFAULT 0", // requests with a Jev signal (or savers applied)
      lossyApplied: "INTEGER NOT NULL DEFAULT 0", // Headroom or Caveman actually ran
      lossyBlocked: "INTEGER NOT NULL DEFAULT 0", // lossy enabled in settings but gated off by Jev
      lossyOff: "INTEGER NOT NULL DEFAULT 0", // lossy savers disabled in settings
      rtkHits: "INTEGER NOT NULL DEFAULT 0",
      headroomSaved: "INTEGER NOT NULL DEFAULT 0", // tokens reported saved by Headroom
      caveman: "INTEGER NOT NULL DEFAULT 0",
      pxpipe: "INTEGER NOT NULL DEFAULT 0",
      custom: "INTEGER NOT NULL DEFAULT 0",
      ponytail: "INTEGER NOT NULL DEFAULT 0",
    },
    primaryKey: "PRIMARY KEY (hour, level)",
  },
  // PXPIPE compression events (was DATA_DIR/pxpipe/events.jsonl), capped in src/lib/pxpipe/events.js.
  pxpipeEvents: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      ts: "INTEGER NOT NULL", // epoch ms
      data: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pxe_ts ON pxpipeEvents(ts)"],
  },
  jevBreakerEvents: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      at: "TEXT NOT NULL",
      kind: "TEXT NOT NULL", // 'open' | 'close'
      failStreak: "INTEGER NOT NULL DEFAULT 0",
      reason: "TEXT",
      until: "TEXT", // open only: when the pause ends
    },
  },
  // Universal Agent Memory (LangGraph-backed). Owner scoping supports multi-agent/multi-project sharing.
  agentMemories: {
    columns: {
      id: "TEXT PRIMARY KEY",
      ownerType: "TEXT NOT NULL", // 'user' | 'agent' | 'team' | 'project'
      ownerId: "TEXT NOT NULL",
      type: "TEXT NOT NULL", // 'episodic' | 'semantic' | 'procedural' | 'preference' | 'working'
      content: "TEXT NOT NULL",
      metadata: "TEXT", // JSON
      embedding: "TEXT", // JSON array
      confidence: "REAL DEFAULT 1.0",
      importance: "REAL DEFAULT 0.5",
      version: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
      lastAccessedAt: "TEXT",
      expiresAt: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_am_owner ON agentMemories(ownerType, ownerId)",
      "CREATE INDEX IF NOT EXISTS idx_am_type ON agentMemories(type)",
      "CREATE INDEX IF NOT EXISTS idx_am_created ON agentMemories(createdAt DESC)",
    ],
  },
  memoryRelations: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      sourceId: "TEXT NOT NULL",
      targetId: "TEXT NOT NULL",
      relationType: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_mr_source ON memoryRelations(sourceId)",
      "CREATE INDEX IF NOT EXISTS idx_mr_target ON memoryRelations(targetId)",
    ],
  },
  memoryEvents: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      sessionId: "TEXT",
      agent: "TEXT",
      kind: "TEXT NOT NULL", // 'capture' | 'extract' | 'consolidate' | 'retrieve'
      payload: "TEXT NOT NULL",
      ts: "INTEGER NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_me_ts ON memoryEvents(ts DESC)"],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
