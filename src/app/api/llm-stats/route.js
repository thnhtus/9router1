import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import {
  getApiKey, setApiKey, readCatalog, writeCatalog, readRoles, writeRoles,
  fetchCatalog, matchCatalog, costTier, suggestRole, buildProfile,
} from "@/lib/llmStats.js";

export const dynamic = "force-dynamic";

// GET: available models (active connections, not disabled) joined with llm-stats data + roles.
export async function GET() {
  try {
    const [conns, disabled, catalog, roles, key] = await Promise.all([
      getProviderConnections({ isActive: true }), getDisabledModels(), readCatalog(), readRoles(), getApiKey(),
    ]);
    const active = new Set(conns.flatMap((c) => [c.provider, getProviderAlias(c.provider)]).filter(Boolean));
    const seen = new Set();
    const models = AI_MODELS
      .filter((m) => active.has(m.provider))
      .filter((m) => !seen.has(`${m.provider}/${m.model}`) && seen.add(`${m.provider}/${m.model}`))
      .filter((m) => !(disabled[m.provider] || []).includes(m.model))
      .map((m) => {
        const id = `${m.provider}/${m.model}`;
        const entry = catalog?.models ? matchCatalog(m.model, catalog.models) : null;
        return {
          id, provider: m.provider, name: m.name || m.model,
          stats: entry, tier: costTier(id, entry),
          suggestedRole: suggestRole(entry), role: roles[id] || "",
          profile: buildProfile(id, entry, roles[id]),
        };
      });
    return NextResponse.json({
      hasKey: !!key,
      fetchedAt: catalog?.fetchedAt || null,
      catalogSize: catalog?.models?.length || 0,
      source: catalog?.source || null,
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
