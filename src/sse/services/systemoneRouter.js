import { getModelInfo } from "../services/model.js";
import { getProviderCredentials } from "../services/auth.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { createHash } from "node:crypto";
import { getRoutingProfiles, getModelTiers } from "@/lib/llmStats.js";
import { appendJevLog } from "@/lib/jevLogs.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
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
export async function resolveSmartChoice(opts) {
  if (!Array.isArray(opts?.models) || opts.models.length <= 1) return null;
  const key = cacheKey(opts.body, opts.models);
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.route;

  const trace = { comboName: opts.comboName || null, models: opts.models };
  const started = Date.now();
  let route = null;
  try {
    route = await evaluate(opts, trace);
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
}, trace) {
  const targetModel = (typeof routerModel === "string" && routerModel.trim())
    ? routerModel.trim()
    : DEFAULT_SYSTEMONE_ROUTER_MODEL;
  trace.routerModel = targetModel;

  const state = extractPromptState(body);
  if (!state) {
    log?.debug?.("COMBO", "smart-router: empty prompt state, skipping classification");
    trace.error = "empty prompt state";
    return null;
  }

  // Profiles (role, cost tier, llm-stats scores) let Jev trade capability for cost.
  const criteria = { ...buildChoiceCriteria(models), ...(await getRoutingProfiles(models)) };
  if (Object.keys(criteria).length === 0) return null;

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
          instructions: "Which of these configured models is the most appropriate for this request? Prefer the cheapest model (free < cheap < mid < premium) whose role and scores fit the task; pick a premium model only when the request clearly needs it.",
          criteria,
        },
      },
    };

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`System One router timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const corePromise = handleSystemoneCore({
      body: systemoneBody,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      onRequestSuccess: () => {},
    });

    let result;
    try {
      result = await Promise.race([corePromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }

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
