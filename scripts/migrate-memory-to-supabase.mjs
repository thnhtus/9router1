import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

const url = process.env.JEV_SUPABASE_URL;
const key = process.env.JEV_SUPABASE_SECRET_KEY;
if (!url || !key) { console.error("Missing JEV_SUPABASE_URL/KEY"); process.exit(1); }

const dataDir = process.env.DATA_DIR && fs.existsSync(process.env.DATA_DIR) ? process.env.DATA_DIR : path.join(os.homedir(), ".9router");
const dbPath = path.join(dataDir, "db", "data.sqlite");
console.log("Reading", dbPath);
function safeParse(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

const db = new Database(dbPath, { readonly: true });
const rows = db.prepare("SELECT * FROM agentMemories").all();
console.log("rows:", rows.length);

let ok = 0, skip = 0, fail = 0;
for (const r of rows) {
  const body = {
    id: r.id,
    owner_type: r.ownerType,
    owner_id: r.ownerId,
    type: r.type,
    content: r.content,
    metadata: safeParse(r.metadata, {}),
    embedding: safeParse(r.embedding, null),
    confidence: r.confidence,
    importance: r.importance,
    version: r.version,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    last_accessed_at: r.lastAccessedAt || null,
    expires_at: r.expiresAt || null,
  };
  const res = await fetch(`${url}/rest/v1/agent_memories`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (res.ok) { ok++; }
  else if (res.status === 409) { skip++; }
  else { fail++; console.error(r.id, res.status, await res.text()); }
}
console.log(`done: ok=${ok} skip=${skip} fail=${fail}`);
db.close();