import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;

let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();
    // ENABLE_REQUEST_LOGS only governs the file logger (open-sse/utils/requestLogger.js).
    // Using it here disabled this DB store whenever the documented default `false` was
    // present in .env — the dashboard toggle then showed observability as on while
    // nothing was recorded. OBSERVABILITY_ENABLED is the env switch for this store.
    const envFallback = process.env.OBSERVABILITY_ENABLED !== "false";
    const uiFlag = typeof settings.enableObservability === "boolean";
    const enabled = uiFlag
      ? settings.enableObservability
      : envFallback;

    cachedConfig = {
      enabled,
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: false,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
    };
  }
  cachedConfigTs = Date.now();
  return cachedConfig;
}

let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

export const __test__ = { sanitizeHeaders };

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj, maxSize) {
  const str = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj || {};
}

const INSERT_SQL = `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`;

function buildRecord(item, config) {
  if (!item.id) item.id = generateDetailId(item.model);
  if (!item.timestamp) item.timestamp = new Date().toISOString();
  if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);
  return {
    id: item.id,
    provider: item.provider || null,
    model: item.model || null,
    connectionId: item.connectionId || null,
    sessionId: item.sessionId || null,
    timestamp: item.timestamp,
    status: item.status || null,
    latency: item.latency || {},
    tokens: item.tokens || {},
    request: truncateField(item.request, config.maxJsonSize),
    providerRequest: truncateField(item.providerRequest, config.maxJsonSize),
    providerResponse: truncateField(item.providerResponse, config.maxJsonSize),
    response: truncateField(item.response, config.maxJsonSize),
    pxpipe: item.pxpipe || undefined,
    tokenSavers: item.tokenSavers || undefined,
  };
}

function writeBatch(db, items, config) {
  db.transaction(() => {
    for (const item of items) {
      const record = buildRecord(item, config);
      db.run(INSERT_SQL, [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record)]);
    }
    const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`);
    if (cnt && cnt.c > config.maxRecords) {
      db.run(
        `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
        [cnt.c - config.maxRecords]
      );
    }
  });
}

async function flushToDatabase() {
  if (isFlushing) return;
  if (writeBuffer.length === 0) return;
  isFlushing = true;
  try {
    // Drain entire buffer (loop in case more pushed during await)
    while (writeBuffer.length > 0) {
      const items = writeBuffer.splice(0, writeBuffer.length);
      const db = await getAdapter();
      writeBatch(db, items, await getObservabilityConfig());
    }
  } catch (e) {
    console.error("[requestDetailsRepo] Batch write failed:", e);
  } finally {
    isFlushing = false;
  }
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) {return;}

  writeBuffer.push(detail);

  // Trigger immediate flush if batch threshold reached.
  // flushToDatabase() drains entire buffer in a loop, so all pushes during await are persisted.
  if (writeBuffer.length >= config.batchSize) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushToDatabase().catch((e) => console.error("[requestDetailsRepo] flush err:", e));
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushToDatabase().catch(() => {});
    }, config.flushIntervalMs);
  }
}

export async function getRequestDetails(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  if (filter.status) { conds.push("status = ?"); params.push(filter.status); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestDetails ${where}`, params);
  const totalItems = cntRow ? cntRow.c : 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const details = rows.map((r) => parseJson(r.data, {}));

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

// Harness turns are stored as rows with provider='harness:<name>'. Aggregate them so the
// dashboard can show what harnesses captured and offer manual Jev evaluation.
export async function listHarnessSessions({ limit = 50 } = {}) {
  const db = await getAdapter();
  const rows = db.all(`SELECT data FROM requestDetails WHERE provider LIKE 'harness:%' ORDER BY timestamp DESC LIMIT ?`, [Math.max(1, Math.min(500, limit))]);
  const bySession = new Map();
  for (const r of rows) {
    const d = parseJson(r.data, null);
    if (!d?.sessionId) continue;
    let s = bySession.get(d.sessionId);
    if (!s) {
      s = { sessionId: d.sessionId, harness: String(d.provider || "").replace(/^harness:/, ""), count: 0, errors: 0, providers: new Set(), models: new Set(), firstAt: d.timestamp, lastAt: d.timestamp };
      bySession.set(d.sessionId, s);
    }
    if (d.timestamp < s.firstAt) s.firstAt = d.timestamp;
    if (d.timestamp > s.lastAt) s.lastAt = d.timestamp;
    s.count += 1;
    if (d.status === "error") s.errors += 1;
    if (d.provider) s.providers.add(d.provider);
    if (d.model) s.models.add(d.model);
  }
  return [...bySession.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).map((s) => ({ ...s, providers: [...s.providers], models: [...s.models] }));
}

export async function getDistinctProviders() {
  const db = await getAdapter();
  const rows = db.all(`SELECT DISTINCT provider FROM requestDetails WHERE provider IS NOT NULL ORDER BY provider ASC`);
  return rows.map((r) => r.provider);
}

export async function getRequestDetailById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM requestDetails WHERE id = ?`, [id]);
  return row ? parseJson(row.data, null) : null;
}

const _shutdownHandler = async () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) await flushToDatabase();
};

function ensureShutdownHandler() {
  process.off("beforeExit", _shutdownHandler);
  process.off("SIGINT", _shutdownHandler);
  process.off("SIGTERM", _shutdownHandler);
  process.off("exit", _shutdownHandler);

  process.on("beforeExit", _shutdownHandler);
  process.on("SIGINT", _shutdownHandler);
  process.on("SIGTERM", _shutdownHandler);
  process.on("exit", _shutdownHandler);
}

ensureShutdownHandler();
