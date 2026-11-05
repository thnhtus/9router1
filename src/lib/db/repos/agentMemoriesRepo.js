import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const SUPABASE_URL = process.env.JEV_SUPABASE_URL || process.env.MEMORY_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.JEV_SUPABASE_SECRET_KEY || process.env.MEMORY_SUPABASE_SECRET_KEY || "";

function supabaseEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function baseUrl() {
  return SUPABASE_URL.replace(/\/$/, "");
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function toRow(mem) {
  return {
    id: mem.id,
    owner_type: mem.ownerType,
    owner_id: mem.ownerId,
    type: mem.type,
    content: mem.content,
    metadata: mem.metadata || {},
    embedding: mem.embedding ? JSON.stringify(mem.embedding) : null,
    confidence: mem.confidence ?? 1.0,
    importance: mem.importance ?? 0.5,
    version: mem.version ?? 1,
    created_at: mem.createdAt,
    updated_at: mem.updatedAt,
    last_accessed_at: mem.lastAccessedAt,
    expires_at: mem.expiresAt || null,
  };
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    type: row.type,
    content: row.content,
    metadata: row.metadata && typeof row.metadata === "string" ? parseJson(row.metadata, {}) : (row.metadata || {}),
    embedding: row.embedding
      ? (typeof row.embedding === "string" ? parseJson(row.embedding, null) : row.embedding)
      : null,
    confidence: row.confidence ?? 1.0,
    importance: row.importance ?? 0.5,
    version: row.version ?? 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    expiresAt: row.expires_at,
  };
}

// ---------- SQLite fallback helpers ----------

function rowToMemory(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    type: row.type,
    content: row.content,
    metadata: parseJson(row.metadata, {}),
    embedding: parseJson(row.embedding, null),
    confidence: row.confidence ?? 1.0,
    importance: row.importance ?? 0.5,
    version: row.version ?? 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastAccessedAt: row.lastAccessedAt,
    expiresAt: row.expiresAt,
  };
}

// ---------- Public API ----------

export async function listMemories({ ownerType, ownerId, type, limit = 100 } = {}) {
  if (supabaseEnabled()) {
    const qs = new URLSearchParams();
    qs.set("select", "*");
    qs.set("order", "created_at.desc");
    qs.set("limit", String(limit));
    if (ownerType) qs.set("owner_type", `eq.${ownerType}`);
    if (ownerId) qs.set("owner_id", `eq.${ownerId}`);
    if (type) qs.set("type", `eq.${type}`);
    const res = await fetch(`${baseUrl()}/rest/v1/agent_memories?${qs}`, { headers: headers() });
    if (!res.ok) throw new Error(`Supabase list failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return rows.map(fromRow);
  }
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (ownerType) { where.push("ownerType = ?"); params.push(ownerType); }
  if (ownerId) { where.push("ownerId = ?"); params.push(ownerId); }
  if (type) { where.push("type = ?"); params.push(type); }
  const sql = `SELECT * FROM agentMemories ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY createdAt DESC LIMIT ?`;
  params.push(limit);
  return db.all(sql, params).map(rowToMemory);
}

export async function getMemoryById(id) {
  if (supabaseEnabled()) {
    const res = await fetch(`${baseUrl()}/rest/v1/agent_memories?id=eq.${encodeURIComponent(id)}&select=*`, { headers: headers() });
    if (!res.ok) throw new Error(`Supabase get failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return fromRow(rows[0]);
  }
  const db = await getAdapter();
  return rowToMemory(db.get(`SELECT * FROM agentMemories WHERE id = ?`, [id]));
}

export async function createMemory(data) {
  if (supabaseEnabled()) {
    const now = new Date().toISOString();
    const mem = {
      id: data.id || uuidv4(),
      ownerType: data.ownerType,
      ownerId: data.ownerId,
      type: data.type,
      content: data.content,
      metadata: data.metadata || {},
      embedding: data.embedding || null,
      confidence: data.confidence ?? 1.0,
      importance: data.importance ?? 0.5,
      version: 1,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      expiresAt: data.expiresAt || null,
    };
    const res = await fetch(`${baseUrl()}/rest/v1/agent_memories`, {
      method: "POST",
      headers: headers({ Prefer: "return=representation" }),
      body: JSON.stringify(toRow(mem)),
    });
    if (!res.ok) throw new Error(`Supabase create failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return fromRow(rows[0]);
  }
  const db = await getAdapter();
  const now = new Date().toISOString();
  const mem = {
    id: data.id || uuidv4(),
    ownerType: data.ownerType,
    ownerId: data.ownerId,
    type: data.type,
    content: data.content,
    metadata: data.metadata || {},
    embedding: data.embedding || null,
    confidence: data.confidence ?? 1.0,
    importance: data.importance ?? 0.5,
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    expiresAt: data.expiresAt || null,
  };
  db.run(
    `INSERT INTO agentMemories(id, ownerType, ownerId, type, content, metadata, embedding, confidence, importance, version, createdAt, updatedAt, lastAccessedAt, expiresAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [mem.id, mem.ownerType, mem.ownerId, mem.type, mem.content, stringifyJson(mem.metadata), mem.embedding ? stringifyJson(mem.embedding) : null, mem.confidence, mem.importance, mem.version, mem.createdAt, mem.updatedAt, mem.lastAccessedAt, mem.expiresAt]
  );
  return mem;
}

export async function updateMemory(id, data) {
  if (supabaseEnabled()) {
    const existing = await getMemoryById(id);
    if (!existing) return null;
    const merged = { ...existing, ...data, updatedAt: new Date().toISOString(), version: (existing.version || 1) + 1 };
    const res = await fetch(`${baseUrl()}/rest/v1/agent_memories?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: headers({ Prefer: "return=representation" }),
      body: JSON.stringify(toRow(merged)),
    });
    if (!res.ok) throw new Error(`Supabase update failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return fromRow(rows[0]);
  }
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM agentMemories WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToMemory(row), ...data, updatedAt: new Date().toISOString(), version: (row.version || 1) + 1 };
    db.run(
      `UPDATE agentMemories SET ownerType=?, ownerId=?, type=?, content=?, metadata=?, embedding=?, confidence=?, importance=?, version=?, updatedAt=?, lastAccessedAt=?, expiresAt=? WHERE id=?`,
      [merged.ownerType, merged.ownerId, merged.type, merged.content, stringifyJson(merged.metadata || {}), merged.embedding ? stringifyJson(merged.embedding) : null, merged.confidence, merged.importance, merged.version, merged.updatedAt, merged.lastAccessedAt || merged.updatedAt, merged.expiresAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteMemory(id) {
  if (supabaseEnabled()) {
    const res = await fetch(`${baseUrl()}/rest/v1/agent_memories?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
    if (!res.ok) throw new Error(`Supabase delete failed: ${res.status} ${await res.text()}`);
    return true;
  }
  const db = await getAdapter();
  const res = db.run(`DELETE FROM agentMemories WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function touchMemory(id) {
  if (supabaseEnabled()) {
    await fetch(`${baseUrl()}/rest/v1/agent_memories?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ last_accessed_at: new Date().toISOString() }),
    });
    return;
  }
  const db = await getAdapter();
  db.run(`UPDATE agentMemories SET lastAccessedAt = ? WHERE id = ?`, [new Date().toISOString(), id]);
}

export async function retrieveMemories({ ownerType, ownerId, queryEmbedding, topK = 8, type } = {}) {
  if (supabaseEnabled()) {
    if (!queryEmbedding) {
      const rows = await listMemories({ ownerType, ownerId, type, limit: topK });
      return rows;
    }
    const res = await fetch(`${baseUrl()}/rest/v1/rpc/match_agent_memories`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_owner_type: ownerType,
        p_owner_id: ownerId,
        p_embedding: queryEmbedding,
        p_count: topK,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn("[memory] match rpc failed, falling back to recency:", res.status, txt);
      return listMemories({ ownerType, ownerId, type, limit: topK });
    }
    const rows = await res.json();
    let items = rows.map(fromRow);
    if (type) items = items.filter((m) => m.type === type);
    return items.slice(0, topK);
  }
  const all = await listMemories({ ownerType, ownerId, type, limit: 5000 });
  if (!queryEmbedding) return all.slice(0, topK);
  const scored = all
    .filter((m) => Array.isArray(m.embedding) && m.embedding.length === queryEmbedding.length)
    .map((m) => {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < queryEmbedding.length; i++) {
        dot += m.embedding[i] * queryEmbedding[i];
        na += m.embedding[i] * m.embedding[i];
        nb += queryEmbedding[i] * queryEmbedding[i];
      }
      const cos = na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
      return { memory: m, score: cos };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((x) => x.memory);
}