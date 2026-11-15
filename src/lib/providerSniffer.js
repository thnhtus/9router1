import fs from "node:fs";
import path from "node:path";
import { makeKv } from "@/lib/db/helpers/kvStore.js";
import { PROVIDERS } from "open-sse/providers/index.js";
import { loadRuntimeDep } from "open-sse/services/lazyRuntime.js";
import { launchChromiumWithFallback, resolveSystemChromeExecutable } from "open-sse/executors/browserExecutableCheck.js";


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
  // Global CLI installs run from an arbitrary cwd with only a built bundle — no source to write into.
  if (!fs.existsSync(REGISTRY_INDEX)) throw new Error(`Registry source not found at ${REGISTRY_DIR}; install only works when 9router runs from a repo checkout`);
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

/** Strip an HTML page down to readable text for Jev evidence (no parser dep). */
export function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Fallback when Jev is unreachable. Billing phrases win over "no card" phrases
// ("no card for the playground, add a payment method for API keys" → no).
const NO_BILLING_RE = /(no credit card|without a credit card|no card required|no payment required|free forever)/i;
const BILLING_RE = /(add (a )?(credit card|billing|payment method)|payment method required|billing required|requires? (a )?(credit card|payment method))/i;
export function billingHeuristic(text) {
  if (BILLING_RE.test(text)) return "no";
  if (NO_BILLING_RE.test(text)) return "yes";
  return "unknown";
}

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Headless Chromium shared across a checkFreeAll run; closed after 60s idle so no process lingers.
let _browser = null;
let _idleTimer = null;
async function getBrowser() {
  clearTimeout(_idleTimer);
  _browser ??= (async () => {
    const { chromium } = await loadRuntimeDep("playwright-core");
    const executablePath = resolveSystemChromeExecutable();
    return launchChromiumWithFallback(chromium, executablePath ? { headless: true, executablePath } : { headless: true });
  })().catch((e) => { _browser = null; throw e; });
  return _browser;
}
function scheduleBrowserClose() {
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(async () => {
    const b = _browser;
    _browser = null;
    (await b?.catch(() => null))?.close().catch(() => {});
  }, 60000);
  _idleTimer.unref?.();
}

/** Render a page locally with headless Chromium and return its innerText. */
async function renderLocalText(u) {
  try {
    const browser = await getBrowser();
    const ctx = await browser.newContext({ userAgent: BROWSER_UA });
    try {
      const page = await ctx.newPage();
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500);
      const text = await page.evaluate(() => document.body.innerText);
      return text?.trim() ? text.slice(0, 4000) : null;
    } finally {
      await ctx.close().catch(() => {});
      scheduleBrowserClose();
    }
  } catch {
    return null;
  }
}

/**
 * Rendered-content evidence: local Chromium first, then the r.jina.ai reader,
 * then a raw HTML fetch. Fallbacks keep evidence working when a step is down.
 */
async function fetchPageEvidence(u) {
  const local = await renderLocalText(u);
  if (local) return local;
  try {
    const readerRes = await fetch(`https://r.jina.ai/${u}`, {
      headers: { "User-Agent": BROWSER_UA },
      signal: AbortSignal.timeout(30000),
    });
    if (readerRes.ok) {
      const text = await readerRes.text();
      if (text.trim()) return text.slice(0, 4000);
    }
  } catch { /* reader down */ }
  const res = await fetch(u, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) return null;
  return htmlToText(await res.text()).slice(0, 2000);
}

/** Best-effort evidence of the provider site + /pricing as text. */
async function gatherBillingEvidence(c) {
  const urls = [c.pricingUrl, c.website];
  try { if (c.website) urls.push(new URL("/pricing", c.website).toString()); } catch { /* bad url */ }
  const chunks = [];
  for (const u of [...new Set(urls.filter(Boolean))].slice(0, 3)) {
    try {
      const text = await fetchPageEvidence(u);
      if (text) chunks.push(`[${u}] ${text}`);
    } catch { /* unreachable page */ }
  }
  return chunks.join("\n");
}

/**
 * Is the provider usable without adding billing (card / paid plan)? Evidence = REA recon
 * text posted by the agent (opts.evidence) or a plain fetch of website + /pricing.
 * Jev (System One, free oc/jev-1.13-free) judges it; keyword heuristic if Jev is down.
 * @returns {Promise<{freeUsable:"yes"|"no"|"unknown", confidence:number|null, source:string, evidence:string|null, checkedAt:string, error?:string}>}
 */
export async function checkFreeUsable(candidate, opts = {}) {
  const checkedAt = new Date().toISOString();
  const evidence = String(opts.evidence || (await gatherBillingEvidence(candidate))).slice(0, 6000);
  if (!evidence.trim()) return { freeUsable: "unknown", confidence: null, source: "no-evidence", evidence: null, checkedAt };
  const routerModel = opts.routerModel || "oc/jev-1.13-free";
  const base = { evidence: evidence.slice(0, 1500), evidenceSource: opts.evidence ? opts.evidenceSource || "rea" : "fetch", checkedAt };

  try {
    const { handleSystemoneCore } = await import("open-sse/handlers/systemoneCore.js");
    const { getModelInfo } = await import("@/sse/services/model.js");
    const { getProviderCredentials } = await import("@/sse/services/auth.js");
    const { checkAndRefreshToken } = await import("@/sse/services/tokenRefresh.js");

    const { provider, model } = (await getModelInfo(routerModel)) || {};
    if (!provider) throw new Error(`unknown Jev model ${routerModel}`);
    const creds = await getProviderCredentials(provider, new Set(), model);
    if (!creds || creds.allRateLimited) throw new Error(`no credentials for ${provider}`);

    const result = await handleSystemoneCore({
      body: {
        model,
        state: `Provider: ${candidate.name || candidate.id}\nWebsite: ${candidate.website || ""}\nAPI: ${candidate.baseUrl || ""}\nCatalog note: ${candidate.notice || ""}\n\nEvidence:\n${evidence}`,
        questions: {
          freeUsable: {
            type: "choice",
            instructions: "Can a new user call this API for free WITHOUT first adding a credit card, billing method or paid plan? " +
              "yes = free usage needs no card/billing. no = card/billing/top-up/paid plan required before requests work (one-off trial credits that need a card count as no). " +
              "unknown = evidence does not say.",
            criteria: { yes: null, no: null, unknown: null },
          },
        },
      },
      modelInfo: { provider, model },
      credentials: await checkAndRefreshToken(provider, creds),
      timeoutMs: 20000,
    });
    if (!result?.success) throw new Error(result?.error || `Jev HTTP ${result?.status}`);
    const a = (await result.response.json())?.answers?.freeUsable;
    const choice = String(a?.choice || "").toLowerCase();
    if (!["yes", "no", "unknown"].includes(choice)) throw new Error("Jev gave no answer");
    const conf = a.confidence ?? null;
    // An explicit billing phrase overrides Jev, so "add a credit card" is never greenlit.
    // Low confidence is kept as-is; passesFreeGate rejects it.
    if (choice !== "no" && billingHeuristic(evidence) === "no") {
      return { freeUsable: "no", confidence: null, source: "heuristic", jevChoice: choice, ...base };
    }
    return { freeUsable: choice, confidence: conf, source: `jev:${routerModel}`, ...base };
  } catch (err) {
    return { freeUsable: billingHeuristic(evidence), confidence: null, source: "heuristic", error: err.message, ...base };
  }
}

/** Install gate: only a Jev "yes" with confidence >= 0.6. A heuristic "yes" (Jev down) never passes. */
export const passesFreeGate = (p) => {
  const fc = p?.freeCheck;
  return fc?.freeUsable === "yes" && String(fc.source).startsWith("jev:") && typeof fc.confidence === "number" && fc.confidence >= 0.6;
};

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
