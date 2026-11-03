// LLM Stats (llm-stats.com) catalog over its hosted MCP server, matched to the models
// this router can actually serve. Output feeds per-model "profiles" that the Smart Router
// hands to Jev as choice criteria, so Jev can pick the cheapest model fit for a request.
import { getAdapter } from "@/lib/db/driver.js";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";

export const LLM_STATS_MCP_URL = "https://mcp.llm-stats.com/mcp";
export const LLM_STATS_REST_URL = "https://api.llm-stats.com/stats/v1/models";
const KV_SCOPE = "llmStats";
const PAGE_LIMIT = 200;
const MAX_PAGES = 5;

async function rpc(url, key, sessionId, id, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id != null ? { id } : {}), method, params }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`llm-stats MCP ${method}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const sid = res.headers.get("mcp-session-id") || sessionId;
  if (id == null) return { sid };
  const text = await res.text();
  // Streamable HTTP answers either plain JSON or an SSE stream of `data:` lines.
  const payloads = (res.headers.get("content-type") || "").includes("event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim())
    : [text];
  for (const p of payloads) {
    let msg;
    try { msg = JSON.parse(p); } catch { continue; }
    if (msg.id !== id) continue;
    if (msg.error) throw new Error(`llm-stats MCP ${method}: ${msg.error.message || JSON.stringify(msg.error)}`);
    return { sid, result: msg.result };
  }
  throw new Error(`llm-stats MCP ${method}: no response`);
}

function toolJson(result) {
  if (result?.isError) throw new Error(result.content?.[0]?.text || "llm-stats tool error");
  if (result?.structuredContent) return result.structuredContent;
  for (const c of result?.content || []) {
    if (c.type !== "text") continue;
    try { return JSON.parse(c.text); } catch { /* markdown summary, try next part */ }
  }
  throw new Error("llm-stats list-models returned no JSON payload");
}

function slim(m) {
  const priced = (m.providers || []).filter((p) => p.input_price_per_m != null);
  const min = (k) => (priced.length ? Math.min(...priced.map((p) => p[k] ?? Infinity)) : null);
  return {
    id: m.id,
    name: m.name,
    org: m.organization?.name || "",
    scores: m.top_scores || {},
    inPrice: min("input_price_per_m"),
    outPrice: min("output_price_per_m"),
    context: m.context_window ?? null,
  };
}

/** Pull the full catalog through the MCP `list-models` tool. */
export async function fetchCatalogViaMcp(apiKey, url = LLM_STATS_MCP_URL) {
  const { sid } = await rpc(url, apiKey, null, 1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "9router", version: "1" },
  });
  await rpc(url, apiKey, sid, null, "notifications/initialized", {}).catch(() => {});
  const models = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { result } = await rpc(url, apiKey, sid, 2 + page, "tools/call", {
      name: "list-models",
      arguments: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
    });
    const data = toolJson(result);
    models.push(...(data.models || []).map(slim));
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return models;
}

/** Same catalog via REST (same key, same ModelSummary shape). */
export async function fetchCatalogViaRest(apiKey, url = LLM_STATS_REST_URL) {
  const models = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const u = new URL(url);
    u.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`llm-stats REST: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    models.push(...(data.models || []).map(slim));
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return models;
}

/** MCP first; the hosted MCP server has failed its own output validation before, so fall back to REST. */
export async function fetchCatalog(apiKey) {
  try {
    return { source: "mcp", models: await fetchCatalogViaMcp(apiKey) };
  } catch (mcpErr) {
    try {
      return { source: "rest", models: await fetchCatalogViaRest(apiKey), mcpError: mcpErr.message.slice(0, 200) };
    } catch (restErr) {
      throw new Error(`MCP: ${mcpErr.message.slice(0, 200)} | REST: ${restErr.message}`);
    }
  }
}

export const readCatalog = () => kvGet("catalog", null);

export async function writeCatalog(models, source) {
  const value = { fetchedAt: new Date().toISOString(), source, models };
  await kvSet("catalog", value);
  return value;
}

// "cc/claude-opus-4-5-20251101:free" → "claude-opus-4-5"
export function normalizeModelId(id) {
  let s = String(id || "").toLowerCase().replace(/^.*\//, "").replace(/:[a-z]+$/, "").replace(/[._ ]/g, "-");
  const SUFFIX = /-(\d{8}|\d{4}-\d{2}-\d{2}|free|latest|preview|high|medium|low|minimal|xhigh|thinking)$/;
  while (SUFFIX.test(s)) s = s.replace(SUFFIX, "");
  return s;
}

export function isFreeModel(id) {
  return /(^|[-:/])free($|[-:])/i.test(String(id));
}

/** Exact normalized id, else the longest catalog id that prefixes ours (or vice versa). */
export function matchCatalog(modelId, catalog) {
  const n = normalizeModelId(modelId);
  if (!n) return null;
  let best = null;
  for (const c of catalog) {
    const cn = normalizeModelId(c.id);
    if (cn === n) return c;
    if ((n.startsWith(cn + "-") || cn.startsWith(n + "-")) && (!best || cn.length > normalizeModelId(best.id).length)) best = c;
  }
  return best;
}

export function costTier(modelId, entry) {
  if (isFreeModel(modelId)) return "free";
  const p = entry?.inPrice;
  if (p == null) return "unknown";
  if (p <= 0.5) return "cheap";
  if (p <= 3) return "mid";
  return "premium";
}

// Raw scores mix scales (productivity 1822 next to science 0.9), so Jev can't compare them.
// Rank each score against every catalog model in that category instead.
const MIN_CATEGORY_SIZE = 20; // smaller categories give noisy ranks
const rankCache = new WeakMap();

function categoryValues(catalog) {
  if (!Array.isArray(catalog)) return {};
  let by = rankCache.get(catalog);
  if (!by) {
    by = {};
    for (const e of catalog) for (const [k, v] of Object.entries(e?.scores || {})) if (Number.isFinite(v)) (by[k] ??= []).push(v);
    rankCache.set(catalog, by);
  }
  return by;
}

/** [[category, topPercent]] best first, e.g. [["reasoning", 3], ...] ("top 3%"). */
export function scoreRanks(entry, catalog) {
  const by = categoryValues(catalog);
  const out = [];
  for (const [k, v] of Object.entries(entry?.scores || {})) {
    const vals = by[k];
    if (!Number.isFinite(v) || !vals || vals.length < MIN_CATEGORY_SIZE) continue;
    const above = vals.filter((x) => x > v).length;
    out.push([k, Math.max(1, Math.ceil(((above + 1) / vals.length) * 100))]);
  }
  return out.sort((a, b) => a[1] - b[1]);
}

export function suggestRole(entry, catalog) {
  return scoreRanks(entry, catalog)[0]?.[0] || "general";
}

/** One line Jev reads per model: role (only when set by the user), cost tier, price, category ranks. */
export function buildProfile(modelId, entry, role, catalog) {
  const tier = costTier(modelId, entry);
  const parts = role ? [`role: ${role}`, `cost: ${tier}`] : [`cost: ${tier}`];
  if (tier !== "free" && entry?.inPrice != null) parts.push(`price $${entry.inPrice}/$${entry.outPrice ?? "?"} per 1M in/out`);
  const top = scoreRanks(entry, catalog).slice(0, 4);
  if (top.length) parts.push(`rank ${top.map(([k, p]) => `${k} top ${p}%`).join(", ")}`);
  return parts.join("; ");
}

async function kvGet(key, fallback) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [KV_SCOPE, key]);
  return row ? parseJson(row.value, fallback) : fallback;
}

async function kvSet(key, value) {
  const db = await getAdapter();
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [KV_SCOPE, key, JSON.stringify(value)],
  );
}

// Server-side only: never return the key from an API route.
export const getApiKey = () => kvGet("apiKey", null);
export const setApiKey = (key) => kvSet("apiKey", key || null);
/** { "<routed model>": "<role>" } set on the dashboard. */
export const readRoles = () => kvGet("roles", {});
export const writeRoles = (roles) => kvSet("roles", roles);

/**
 * Jev choice criteria for a combo: model → profile line, or null when nothing is known
 * (Jev then falls back to its own knowledge of the model). Never throws.
 */
/** { model: cost tier } for grouping Jev's probabilities; "unknown" when uncatalogued. */
export async function getModelTiers(models) {
  const out = {};
  try {
    const catalog = await readCatalog();
    for (const m of models) out[m] = costTier(m, catalog?.models ? matchCatalog(m, catalog.models) : null);
  } catch { /* fail open: no grouping */ }
  return out;
}

export async function getRoutingProfiles(models) {
  const out = {};
  for (const m of models) if (typeof m === "string" && m.trim()) out[m.trim()] = null;
  try {
    const [catalog, roles] = await Promise.all([readCatalog(), readRoles()]);
    for (const m of Object.keys(out)) {
      const entry = catalog?.models ? matchCatalog(m, catalog.models) : null;
      if (entry || roles[m] || isFreeModel(m)) out[m] = buildProfile(m, entry, roles[m], catalog.models);
    }
  } catch { /* fail open: bare criteria */ }
  return out;
}
