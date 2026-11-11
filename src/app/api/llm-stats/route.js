import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getCombos } from "@/lib/db/repos/combosRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import {
  getApiKey, setApiKey, readCatalog, writeCatalog, readRoles, writeRoles,
  fetchCatalog, matchCatalog, costTier, suggestRole, buildProfile, scoreRanks,
} from "@/lib/llmStats.js";

export const dynamic = "force-dynamic";

// GET: available models (active connections, not disabled) joined with llm-stats data + roles.
// Non-chat models that should not appear in score charts.
const NON_CHAT_RE = /embed|image|imagen|tts|whisper|audio|ocr/i;

export async function GET() {
  try {
    const [conns, disabled, catalog, roles, key, combos] = await Promise.all([
      getProviderConnections({ isActive: true }), getDisabledModels(), readCatalog(), readRoles(), getApiKey(), getCombos(),
    ]);
    const active = new Set(conns.flatMap((c) => [c.provider, getProviderAlias(c.provider)]).filter(Boolean));

    // Usage counts (last 7 days) so the page reflects real activity, not just active providers.
    const usage7d = new Map();
    try {
      const db = await getAdapter();
      const since = new Date(Date.now() - 7 * 864e5).toISOString(); // timestamp is ISO text
      const rows = db.all(`SELECT provider, model, COUNT(*) c FROM usageHistory WHERE timestamp > ? AND model IS NOT NULL GROUP BY provider, model`, [since]);
      for (const r of rows) {
        const id = `${getProviderAlias(r.provider) || r.provider}/${r.model}`; // usage stores provider id, combos use alias
        usage7d.set(id, (usage7d.get(id) || 0) + (Number(r.c) || 0));
      }
    } catch { /* fail open */ }

    // Combo membership: map model id -> combo names that include it (resolve 1 level).
    const comboOf = new Map();
    const comboNames = new Set(combos.map((c) => c.name));
    for (const c of combos) {
      for (const m of c.models || []) {
        if (comboNames.has(m)) continue; // combo-of-combo, skip
        (comboOf.get(m) || comboOf.set(m, []).get(m)).push(c.name);
      }
    }

    // Build the candidate set: active provider models + combo members + recently used models.
    const candidates = new Map(); // id -> {provider, model, name}
    for (const m of AI_MODELS) {
      const id = `${m.provider}/${m.model}`;
      if (active.has(m.provider)) candidates.set(id, { provider: m.provider, model: m.model, name: m.name || m.model });
    }
    for (const id of comboOf.keys()) {
      if (!candidates.has(id)) {
        const [p, ...rest] = id.split("/");
        candidates.set(id, { provider: p, model: rest.join("/"), name: rest.join("/") });
      }
    }
    for (const id of usage7d.keys()) {
      if (!candidates.has(id)) {
        const [p, ...rest] = id.split("/");
        candidates.set(id, { provider: p, model: rest.join("/"), name: rest.join("/") });
      }
    }

    const models = [...candidates.entries()]
      .filter(([id]) => !NON_CHAT_RE.test(id))
      .filter(([, info]) => !(disabled[info.provider] || []).includes(info.model))
      .map(([id, info]) => {
        const entry = catalog?.models ? matchCatalog(info.model, catalog.models) : null;
        return {
          id, provider: info.provider, name: info.name,
          stats: entry, tier: costTier(id, entry),
          suggestedRole: suggestRole(entry, catalog?.models), role: roles[id] || "",
          profile: buildProfile(id, entry, roles[id], catalog?.models),
          // Percentile 1-100 per category (100 = best): raw scores mix scales, so charts use this.
          ranks: Object.fromEntries(scoreRanks(entry, catalog?.models).map(([k, p]) => [k, 101 - p])),
          combos: comboOf.get(id) || [],
          usage7d: usage7d.get(id) || 0,
        };
      })
      .sort((a, b) => (b.usage7d || 0) - (a.usage7d || 0) || a.id.localeCompare(b.id));
    return NextResponse.json({
      hasKey: !!key,
      fetchedAt: catalog?.fetchedAt || null,
      catalogSize: catalog?.models?.length || 0,
      source: catalog?.source || null,
      combos: combos.map((c) => ({ id: c.id, name: c.name, models: c.models })),
      models,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST { apiKey } | { action: "sync" } | { roles: { "<model>": "<role>" } }
export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    if (typeof body.apiKey === "string") {
      await setApiKey(body.apiKey.trim());
      return NextResponse.json({ ok: true, hasKey: !!body.apiKey.trim() });
    }
    if (body.roles && typeof body.roles === "object") {
      const clean = {};
      for (const [k, v] of Object.entries(body.roles)) {
        if (typeof v === "string" && v.trim()) clean[String(k).slice(0, 200)] = v.trim().slice(0, 60);
      }
      await writeRoles(clean);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "sync") {
      const key = await getApiKey();
      if (!key) return NextResponse.json({ error: "Set the llm-stats API key first" }, { status: 400 });
      const { models, source, mcpError } = await fetchCatalog(key);
      const saved = await writeCatalog(models, source);
      return NextResponse.json({ ok: true, fetchedAt: saved.fetchedAt, catalogSize: models.length, source, mcpError });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
