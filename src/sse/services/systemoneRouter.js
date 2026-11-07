import { getModelInfo } from "../services/model.js";
import { getProviderCredentials } from "../services/auth.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { createHash } from "node:crypto";
import { getRoutingProfiles, getModelTiers } from "@/lib/llmStats.js";
import { appendJevLog, countJevSkip, recordBreakerEvent, loadOpenBreaker } from "@/lib/jevLogs.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { getComboFairness, hydrateComboFairness, FAIR_ERR_TURNS } from "open-sse/services/combo.js";
import {
  DEFAULT_SYSTEMONE_ROUTER_MODEL,
  DEFAULT_SYSTEMONE_TIMEOUT_MS,
  extractPromptState,
  buildChoiceCriteria,
  parseSystemOneRouteAnswer,
  groupRouteByTier,
} from "open-sse/services/systemoneRouter.js";

// Same prompt + same candidates → same decision; skip the Jev round trip.
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const routeCache = new Map();

// Circuit breaker: after BREAKER_FAILS consecutive failures, skip Jev for BREAKER_COOLDOWN_MS
// so a down/rate-limited router doesn't add a doomed call to every combo request.
const BREAKER_FAILS = 3;
const BREAKER_COOLDOWN_MS = 30 * 1000;
// On globalThis so the dashboard API route sees the same state even if Next bundles routes separately.
const breaker = (globalThis.__jevBreaker ??= { fails: 0, openUntil: 0, skipped: 0, restored: null });
// Restore a still-active pause from the DB once per process, so a restart doesn't hammer a down router.
const breakerReady = () => (breaker.restored ??= loadOpenBreaker()
  .then((until) => { if (until > breaker.openUntil) breaker.openUntil = until; })
  .catch(() => {}));

/** For the dashboard: is Jev paused, until when, and how many calls were skipped since start. */
export const getJevBreakerState = () => ({
  open: Date.now() < breaker.openUntil, openUntil: breaker.openUntil || null,
  skipped: breaker.skipped, failStreak: breaker.fails,
});

/** Append the combo's measured reliability so Jev stops re-picking a model that keeps failing (e.g. 429). */
export function addHealth(criteria, comboName) {
  const s = comboName && getComboFairness(comboName);
  if (!s) return criteria;
  for (const m of Object.keys(criteria)) {
    const st = s.members.get(m);
    const runs = (st?.ok || 0) + (st?.fail || 0);
    if (!st?.fail) continue;
    const notes = [`fail rate ${Math.round((st.fail / runs) * 100)}% of ${runs} runs`];
    if (st.errSeq != null && s.seq - st.errSeq <= FAIR_ERR_TURNS) notes.push("failed recently");
    if (st.fail / runs >= 0.2) notes.push("unreliable");
    criteria[m] = [criteria[m], ...notes].filter(Boolean).join("; ");
  }
  return criteria;
}

function cacheKey(body, models) {
  return createHash("sha256").update(JSON.stringify([extractPromptState(body), models])).digest("hex");
}

/**
 * Dispatch an in-process System One decision evaluation for a combo request.
 * Resolves the configured router model's provider and credentials, sends the choice
 * query with a short timeout, and returns the parsed routing decision.
 *
 * Never throws: on missing credentials, timeout, or upstream failure, returns null
 * so combo dispatch fails open to standard model ordering.
 *
 * @param {object} opts
 * @param {object} opts.body - Client request body
 * @param {string[]} opts.models - Combo model candidate array
 * @param {string} [opts.routerModel] - System One router model (defaults to oc/jev-1.13-free)
 * @param {object} [opts.log] - Logger
 * @param {number} [opts.timeoutMs=DEFAULT_SYSTEMONE_TIMEOUT_MS] - Hard ceiling for router evaluation
 * @returns {Promise<{ choice: string, confidence: number|null, probabilities: Record<string, number>|null } | null>}
 */
const TRIVIAL_RE = /^(hi|hello|hey|alo|chào|xin chào|ping|test|thanks|thank you|cảm ơn|ok|oke)[\s!.?]*$|^[\d\s+\-*/().=?]+$/i;
// Greeting or bare arithmetic only, single turn (no [earlier] context): anything else goes to Jev.
export function isTrivialPrompt(state) {
  return typeof state === "string" && state.length < 60 && !state.includes("[earlier]") && TRIVIAL_RE.test(state.trim());
}

export async function resolveSmartChoice(opts) {
  if (!Array.isArray(opts?.models) || opts.models.length <= 1) return null;
  const key = cacheKey(opts.body, opts.models);
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.route;

  await breakerReady();
  if (Date.now() < breaker.openUntil) { // open: no call, no log row — just count the skip
    breaker.skipped++;
    countJevSkip(opts.comboName).catch(() => {});
    return null;
  }
  if (breaker.openUntil) { // pause just ended: record the close once
    breaker.openUntil = 0;
    recordBreakerEvent({ kind: "close" }).catch(() => {});
  }

  const trace = { comboName: opts.comboName || null, models: opts.models };
  const started = Date.now();
  let route = null;
  try {
    route = await evaluate(opts, trace);
    // Only router faults trip the breaker; an empty prompt is not a failure.
    if (route) breaker.fails = 0;
    else if (trace.error !== "empty prompt state" && ++breaker.fails >= BREAKER_FAILS) {
      breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      recordBreakerEvent({ kind: "open", failStreak: breaker.fails, reason: trace.error || null, until: breaker.openUntil }).catch(() => {});
      breaker.fails = 0;
      opts.log?.warn?.("COMBO", `smart-router: ${BREAKER_FAILS} failures in a row, pausing Jev for ${BREAKER_COOLDOWN_MS / 1000}s`);
    }
    if (route) {
      route = groupRouteByTier(route, await getModelTiers(opts.models));
      if (routeCache.size >= CACHE_MAX) routeCache.delete(routeCache.keys().next().value);
      routeCache.set(key, { route, at: Date.now() });
    }
    return route;
  } finally {
    // Per-request audit trail for the Jev Router page; never blocks or breaks routing.
    appendJevLog({ ...trace, choice: route?.choice || null, confidence: route?.confidence ?? null, latencyMs: Date.now() - started })
      .catch(() => {});
  }
}

async function evaluate({
  body,
  models,
  routerModel = DEFAULT_SYSTEMONE_ROUTER_MODEL,
  log,
  timeoutMs = DEFAULT_SYSTEMONE_TIMEOUT_MS,
  comboName = null,
}, trace) {
  const targetModel = (typeof routerModel === "string" && routerModel.trim())
    ? routerModel.trim()
    : DEFAULT_SYSTEMONE_ROUTER_MODEL;
  trace.routerModel = targetModel;

  const baseState = extractPromptState(body);
  if (!baseState) {
    log?.debug?.("COMBO", "smart-router: empty prompt state, skipping classification");
    trace.error = "empty prompt state";
    return null;
  }

  // ponytail: greeting/arithmetic-only fast path skips the ~340ms (p50) Jev call; widen TRIVIAL_RE if logs show more cheap repeats.
  if (models.includes("worker") && isTrivialPrompt(baseState)) {
    trace.fastPath = true;
    return { choice: "worker", confidence: 0.95, probabilities: { worker: 0.95 }, rationale: "fast-path: trivial prompt" };
  }

  const hints = [];
  if ((baseState.match(/\n\s*[-*\d]+\./g) || []).length >= 4) hints.push("multi-step task");
  if (/(migrat|refactor whole|toàn bộ|kiến trúc|architecture|database schema|irrevocable|production drop|dọn sạch)/i.test(baseState)) hints.push("high-stakes/irreversible");
  const state = hints.length ? `${baseState}\n[task-signals: ${hints.join(", ")}]` : baseState;

  // Profiles (role, cost tier, llm-stats scores) let Jev trade capability for cost.
  const criteria = { ...buildChoiceCriteria(models), ...(await getRoutingProfiles(models)) };
  if (Object.keys(criteria).length === 0) return null;
  if (comboName) await hydrateComboFairness(comboName);
  addHealth(criteria, comboName);

  try {
    const modelInfo = await getModelInfo(targetModel);
    if (!modelInfo?.provider) {
      log?.warn?.("COMBO", `smart-router: unrecognized router model "${targetModel}"`);
      trace.error = `smart-router: unrecognized router model "${targetModel}"`;
      return null;
    }

    const { provider, model } = modelInfo;
    const credentials = await getProviderCredentials(provider, new Set(), model);
    if (!credentials || credentials.allRateLimited) {
      log?.warn?.("COMBO", `smart-router: no credentials available for router provider "${provider}"`);
      trace.error = `smart-router: no credentials available for router provider "${provider}"`;
      return null;
    }

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);
    const systemoneBody = trace.request = {
      model,
      state,
      questions: {
        route: {
          type: "choice",
          instructions: "Pick the best fitting model whose role and scores match the task complexity. Balance cost with model variety: do not default to the single cheapest option when multiple models fit. Compare models from every provider on equal terms (Claude, GPT, Gemini, GLM, DeepSeek, Mistral, Grok, free/open models); do not favor one provider family by default. A model with missing profile fields is not disqualified; judge it on the info given and its fit for the level. Score the task on 4 levels: L1 trivial lookup/formatting, L2 single-file edit or simple answer, L3 multi-file feature or debugging, L4 architecture/migration/irreversible change. If the task needs exact precision (code that must compile, money, legal text, writes to data), raise the level one step. Avoid models marked unreliable or failed recently.",
          criteria,
        },
      },
    };

    // timeoutMs aborts the fetch itself, so a hung router never leaves a socket open.
    const result = await handleSystemoneCore({
      body: systemoneBody,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      onRequestSuccess: () => {},
      timeoutMs,
    });

    trace.status = result?.success ? 200 : (result?.status ?? null);
    if (!result?.success || !result.response) {
      log?.warn?.("COMBO", `smart-router: evaluation failed (${result?.status || "error"})`);
      trace.error = result?.error || `evaluation failed (${result?.status || "error"})`;
      return null;
    }

    const json = trace.response = await result.response.json();
    const route = parseSystemOneRouteAnswer(json);
    if (!route || !route.choice) {
      log?.warn?.("COMBO", "smart-router: response missing valid route choice");
      trace.error = "smart-router: response missing valid route choice";
      return null;
    }

    return route;
  } catch (err) {
    log?.warn?.("COMBO", `smart-router: evaluation aborted (${err?.message || String(err)})`);
    trace.error = `smart-router: evaluation aborted (${err?.message || String(err)})`;
    return null;
  }
}
