import fs from "node:fs";
import path from "node:path";
import { makeKv } from "@/lib/db/helpers/kvStore.js";
import { PROVIDERS } from "open-sse/providers/index.js";

// Repo registry source tree (resolved from cwd). The sniffer writes real
// provider files here so installed candidates become first-class registry entries.
const REGISTRY_DIR = path.join(process.cwd(), "open-sse", "providers", "registry");
const REGISTRY_INDEX = path.join(REGISTRY_DIR, "index.js");
const ICONS_DIR = path.join(process.cwd(), "public", "providers");

/** Normalize a candidate id to a safe kebab-case filename slug. */
export function sanitizeRegistryId(id) {
  const slug = String(id || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || null;
}

/**
 * Install a candidate as a real registry provider: write registry/{id}.js and
 * append it to the auto-generated import list in registry/index.js. Existing
 * index.js content/order is preserved (only the new entry is appended).
 */
export async function installToRegistry(candidate) {
  const id = sanitizeRegistryId(candidate?.id);
  if (!id) throw new Error("Invalid provider id");
  const file = path.join(REGISTRY_DIR, `${id}.js`);
  if (fs.existsSync(file)) throw new Error(`Provider ${id} already installed (${id}.js exists)`);

  const code = generateRegistryDraft({ ...candidate, id });
  fs.writeFileSync(file, code);

  const idx = addToRegistryIndex(fs.readFileSync(REGISTRY_INDEX, "utf8"), id);
  fs.writeFileSync(REGISTRY_INDEX, idx);
  await fetchProviderLogo({ ...candidate, id }).catch(() => {});
  return { id, filename: `${id}.js` };
}

/**
 * Add `import pN from "./{id}.js"` after the last import and `pN,` to the
 * export array of registry/index.js. Pure (string in, string out) so it is testable.
 */
export function addToRegistryIndex(src, id) {
  if (src.includes(`./${id}.js`)) throw new Error(`Provider ${id} already present in registry/index.js`);
  const imports = [...src.matchAll(/^import p\d+ from "\.\/.+?\.js";$/gm)];
  if (!imports.length) throw new Error("registry/index.js has no import lines — unexpected format");
  const exportClose = src.lastIndexOf("];");
  if (exportClose === -1) throw new Error("registry/index.js export array not found");

  const next = Math.max(...[...src.matchAll(/\bp(\d+)\b/g)].map((m) => Number(m[1]))) + 1;
  const last = imports[imports.length - 1];
  const at = last.index + last[0].length;
  const withImport = src.slice(0, at) + `\nimport p${next} from "./${id}.js";` + src.slice(at);
  const close = withImport.lastIndexOf("];");
  return withImport.slice(0, close) + `  p${next},\n` + withImport.slice(close);
}

/** Provider icon files live at public/providers/{id}.png (128px). */
export function hasProviderLogo(id) {
  const slug = sanitizeRegistryId(id);
  return !!slug && fs.existsSync(path.join(ICONS_DIR, `${slug}.png`));
}

/**
 * Crawl one provider's brand mark into public/providers/{id}.png.
 * Uses Google's favicon service (already-normalized 128px PNG, no image deps).
 */
export async function fetchProviderLogo(candidate) {
  const id = sanitizeRegistryId(candidate?.id);
  if (!id) return { ok: false, error: "Invalid provider id" };
  if (hasProviderLogo(id)) return { ok: true, id, skipped: true };

  let domain = null;
  try {
    domain = new URL(candidate.website || candidate.baseUrl).hostname.replace(/^www\./, "");
  } catch {
    return { ok: false, id, error: "No website/baseUrl to resolve a logo from" };
  }

  const res = await fetch(
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) return { ok: false, id, error: `logo HTTP ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200) return { ok: false, id, error: "logo response too small" };

  fs.mkdirSync(ICONS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ICONS_DIR, `${id}.png`), buf);
  return { ok: true, id, domain, bytes: buf.length };
}

/** Crawl logos for every candidate that does not have one yet. */
export async function crawlProviderLogos(providers) {
  const results = [];
  for (const p of providers) {
    try {
      results.push(await fetchProviderLogo(p));
    } catch (err) {
      results.push({ ok: false, id: p.id, error: err.message });
    }
  }
  return {
    fetched: results.filter((r) => r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.ok).length,
  };
}

const kv = makeKv("providerSniffer");

export const READ_SNIFFER_PROVIDERS = async () => (await kv.get("providers")) || [];
export const WRITE_SNIFFER_PROVIDERS = async (list) => await kv.set("providers", list);
export const READ_SNIFFER_SETTINGS = async () => (await kv.get("settings")) || { autoScan: false, lastScanAt: null };
export const WRITE_SNIFFER_SETTINGS = async (val) => await kv.set("settings", val);

/**
 * Verify a candidate provider by pinging its validateUrl or baseUrl.
 * Accepts optional apiKey for authenticated free-tier endpoints.
 */
export async function verifyCandidate(candidate, apiKey = "") {
  const url = candidate.validateUrl || candidate.baseUrl;
  if (!url) {
    return { ok: false, error: "No validateUrl or baseUrl specified" };
  }

  const headers = {
    "User-Agent": "9router/0.5.112 (ProviderSniffer; +https://github.com/decolua/9router)",
  };

  if (apiKey) {
    if (candidate.authType === "claude") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (res.ok || res.status === 401 || res.status === 403) {
      // 401/403 means endpoint exists and is reachable, just needs key
      return {
        ok: true,
        status: res.status,
        latencyMs,
        requiresKey: res.status === 401 || res.status === 403,
        note: res.ok ? "Endpoint reachable & active" : "Reachable (Auth Required)",
      };
    } else {
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status} ${res.statusText}`,
        latencyMs,
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: err.name === "AbortError" ? "Connection timed out (8s)" : err.message,
    };
  }
}

/**
 * Check if candidate provider ID or baseUrl already exists in 9router built-in registry
 */
export function isAlreadyInRegistry(candidateId, baseUrl) {
  for (const [key, p] of Object.entries(PROVIDERS)) {
    if (key === candidateId || p.alias === candidateId || p.id === candidateId) {
      return { inRegistry: true, registeredId: key, reason: "ID match" };
    }
    if (baseUrl && p.transport?.baseUrl && p.transport.baseUrl.toLowerCase() === baseUrl.toLowerCase()) {
      return { inRegistry: true, registeredId: key, reason: "BaseURL match" };
    }
  }
  return { inRegistry: false };
}

/**
 * Generate JS code for registry/{id}.js draft
 */
export function generateRegistryDraft(candidate) {
  const id = candidate.id || "custom-free-provider";
  const name = candidate.name || "Custom Free Provider";
  const color = candidate.color || "#10B981";
  const textIcon = (candidate.textIcon || id.slice(0, 2)).toUpperCase();
  const baseUrl = candidate.baseUrl || "https://api.example.com/v1/chat/completions";
  const validateUrl = candidate.validateUrl || candidate.baseUrl;
  const models = candidate.models || [{ id: "default-model", name: "Default Model" }];

  return `// Auto-generated by Provider Sniffer for 9router
export default {
  id: ${JSON.stringify(id)},
  alias: ${JSON.stringify(id)},
  category: ${JSON.stringify(candidate.category || "freeTier")},
  hasFree: true,
  ${candidate.noAuth ? "noAuth: true," : "authType: \"apikey\","}
  display: {
    name: ${JSON.stringify(name)},
    icon: "bolt",
    color: ${JSON.stringify(color)},
    textIcon: ${JSON.stringify(textIcon)},
    website: ${JSON.stringify(candidate.website || baseUrl)},
    notice: {
      text: ${JSON.stringify(candidate.notice || "Discovered free tier provider")},
    },
  },
  transport: {
    baseUrl: ${JSON.stringify(baseUrl)},
    validateUrl: ${JSON.stringify(validateUrl)},
    format: ${JSON.stringify(candidate.format || "openai")},
  },
  models: ${JSON.stringify(models, null, 4)},
  serviceKinds: ["llm"],
};
`;
}

/**
 * Scan the Free-LLM catalog (83 providers / 451 free models, MIT) and merge new
 * candidates into the sniffer list. Entries already in the 9router registry are
 * recorded as "registered"; user "ignored" entries are never resurrected.
 */
export async function scanFreeLlmCatalog() {
  const res = await fetch("https://free-llm.com/catalog.json", {
    headers: {
      // Cloudflare blocks bare curl/undici UAs on this host (403).
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Free-LLM catalog HTTP ${res.status}`);
  const catalog = await res.json();

  const providers = (await READ_SNIFFER_PROVIDERS()) || [];
  const byId = new Map(providers.map((p) => [p.id, p]));
  let added = 0;

  for (const src of catalog.providers || []) {
    const id = src.slug;
    if (!id || !src.base_url) continue;
    const existing = byId.get(id);
    if (existing && existing.status === "ignored") continue;

    const baseUrl = src.base_url.replace(/\/$/, "") + "/chat/completions";
    const dupe = isAlreadyInRegistry(id, baseUrl);
    const entry = {
      id,
      name: src.name || id,
      website: src.website || src.url || null,
      baseUrl,
      validateUrl: src.base_url.replace(/\/$/, "") + "/models",
      format: "openai",
      authType: "apikey",
      hasFree: true,
      notice: [src.rate_limit, src.daily_limit].filter(Boolean).join(" · ") || null,
      discoveredFrom: "Free-LLM catalog",
      status: dupe.inRegistry ? "registered" : existing?.status || "candidate",
      lastVerifiedAt: existing?.lastVerifiedAt || null,
      verificationError: existing?.verificationError || null,
      models: (src.models || []).slice(0, 12).map((m) => ({ id: m.id, name: m.name || m.id })),
    };

    if (existing) {
      // Keep local verification state; only refresh descriptive fields.
      Object.assign(existing, { ...entry, status: existing.status });
    } else {
      byId.set(id, entry);
      providers.push(entry);
      added++;
    }
  }

  await WRITE_SNIFFER_PROVIDERS(providers);
  await WRITE_SNIFFER_SETTINGS({ ...(await READ_SNIFFER_SETTINGS()), lastScanAt: new Date().toISOString() });
  return { added, scanned: (catalog.providers || []).length, updatedAt: catalog.updated_at };
}

/**
 * Seed initial catalog of known curated free AI providers if storage is empty
 */
export async function seedInitialCandidatesIfEmpty() {
  const existing = await READ_SNIFFER_PROVIDERS();
  if (existing && existing.length > 0) return existing;

  const initial = [
    {
      id: "openrouter-free",
      name: "OpenRouter Free Models",
      website: "https://openrouter.ai",
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      validateUrl: "https://openrouter.ai/api/v1/models",
      format: "openai",
      authType: "apikey",
      noAuth: false,
      hasFree: true,
      notice: "27+ free models available (:free suffix). 200 req/day without key.",
      discoveredFrom: "9router Built-in Registry",
      status: "registered",
      lastVerifiedAt: new Date().toISOString(),
      models: [
        { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash (Free)" },
        { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Free)" },
        { id: "deepseek/deepseek-r1:free", name: "DeepSeek R1 (Free)" }
      ]
    },
    {
      id: "pollinations-ai",
      name: "Pollinations.ai",
      website: "https://pollinations.ai",
      baseUrl: "https://text.pollinations.ai/openai",
      validateUrl: "https://text.pollinations.ai/models",
      format: "openai",
      authType: "apikey",
      noAuth: true,
      hasFree: true,
      notice: "Zero-config free LLM & Image text generation, no API key required.",
      discoveredFrom: "9router Built-in Registry",
      status: "registered",
      lastVerifiedAt: new Date().toISOString(),
      models: [
        { id: "openai", name: "GPT-4o Mini (Pollinations)" },
        { id: "mistral", name: "Mistral Nemo" }
      ]
    },
    {
      id: "groq-free",
      name: "Groq Cloud Free Tier",
      website: "https://console.groq.com",
      baseUrl: "https://api.groq.com/openai/v1/chat/completions",
      validateUrl: "https://api.groq.com/openai/v1/models",
      format: "openai",
      authType: "apikey",
      noAuth: false,
      hasFree: true,
      notice: "Fast LPUs, free tier with generous RPM/TPM limits per model.",
      discoveredFrom: "reach-mcp / last30days",
      status: "verified",
      lastVerifiedAt: new Date().toISOString(),
      models: [
        { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
        { id: "qwen/qwen3-32b", name: "Qwen 3 32B" }
      ]
    },
    {
      id: "cerebras-free",
      name: "Cerebras Inference Free Tier",
      website: "https://cloud.cerebras.ai",
      baseUrl: "https://api.cerebras.ai/v1/chat/completions",
      validateUrl: "https://api.cerebras.ai/v1/models",
      format: "openai",
      authType: "apikey",
      noAuth: false,
      hasFree: true,
      notice: "World's fastest Llama 3 inference, 1M tokens/day free limit.",
      discoveredFrom: "Free-LLM Directory / reach-mcp",
      status: "candidate",
      lastVerifiedAt: null,
      models: [
        { id: "llama3.1-8b", name: "Llama 3.1 8B (Cerebras)" },
        { id: "llama3.1-70b", name: "Llama 3.1 70B (Cerebras)" }
      ]
    },
    {
      id: "chutes-ai",
      name: "Chutes.ai Free Tier",
      website: "https://chutes.ai",
      baseUrl: "https://chutes.ai/v1/chat/completions",
      validateUrl: "https://chutes.ai/v1/models",
      format: "openai",
      authType: "apikey",
      noAuth: false,
      hasFree: true,
      notice: "Decentralized GPU cloud for open-weights models.",
      discoveredFrom: "last30flames / GitHub Free-LLM",
      status: "candidate",
      lastVerifiedAt: null,
      models: [
        { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1 (Chutes)" }
      ]
    }
  ];

  await WRITE_SNIFFER_PROVIDERS(initial);
  return initial;
}
