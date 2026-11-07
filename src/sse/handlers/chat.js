import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
} from "../services/auth.js";
import { handleAntigravityQuotaError, clearAntigravityStrikes } from "../services/antigravityQuota.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { runWithAgentTag } from "open-sse/services/agentTag.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";
import { handleComboChat, handleFusionChat, handleOrchestrateChat, detectRequiredCapabilities } from "open-sse/services/combo.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { networkRouteKey, isRouteDown, markRouteDown } from "open-sse/services/accountFallback.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { resolveSessionIdentity } from "open-sse/utils/sessionManager.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { stripModelContextMarker } from "open-sse/utils/modelMarkers.js";
import { getKeyAccessContext, enforceKeyAccess, filterAdapterModels } from "../services/keyAccess.js";
import { resolveSmartChoice } from "../services/systemoneRouter.js";
import { getRoutingProfiles, getModelTiers } from "@/lib/llmStats.js";
import { augmentModelsWithSmartPool } from "open-sse/services/smartAutoPool.js";
import { consumeEscalationBudget } from "open-sse/services/systemoneRouter.js";
import { retrieveMemories } from "@/lib/db/repos/agentMemoriesRepo.js";
import { embedText } from "@/lib/memory/embed.js";
import { runMemoryLifecycle } from "open-sse/services/memoryGraph.js";

// request -> memory block; computed once in handleChat, read by every handleSingleModelChat attempt.
const memoryPrompts = new WeakMap();

function lastUserText(body) {
  const msgs = body?.messages || (Array.isArray(body?.input) ? body.input : []);
  const m = [...msgs].reverse().find((x) => x?.role === "user");
  const c = m?.content;
  if (typeof c === "string") return c;
  return Array.isArray(c) ? c.map((p) => p?.text || "").join(" ").trim() : "";
}

async function buildMemoryPrompt(body, apiKey) {
  const query = lastUserText(body).slice(0, 4000);
  if (!query) return "";
  const items = await retrieveMemories({ ownerType: "agent", ownerId: apiKey, queryEmbedding: await embedText(query), topK: 8 });
  let out = "Relevant memory:";
  for (const m of items || []) {
    const line = `\n- ${m.content}`;
    if (out.length + line.length > 2000) break;
    out += line;
  }
  return items?.length ? out : "";
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export function handleChat(request, clientRawRequest = null) {
  return runWithAgentTag(request.headers, () => handleChatInner(request, clientRawRequest));
}

async function handleChatInner(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    let url = null;
    try { url = new URL(request.url); } catch { url = null; }
    clientRawRequest = {
      endpoint: url?.pathname || "",
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  // Claude Code marks a 1M-context request as `<model>[1m]`; the marker matches
  // no combo, alias or provider/model pair, so it must not reach resolution.
  // The capability travels in the anthropic-beta header, forwarded as-is.
  const { model: modelStr, contextMarker } = stripModelContextMarker(body.model);
  if (contextMarker) body.model = modelStr;

  const session = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
  const sessionId = session?.sessionId || null;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Per-key access control: a restricted key may call only its listed combos and
  // models. Checked once on the requested target, before bypass, combo expansion
  // and any credential lookup; an allowed combo grants the members it routes to.
  const keyAccess = await getKeyAccessContext(request);
  const keyAccessDenied = await enforceKeyAccess(keyAccess, modelStr);
  if (keyAccessDenied) return keyAccessDenied;

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Agent memory: off by default; any failure leaves the request untouched.
  if (settings.memoryEnabled && apiKey) {
    try {
      const mem = await buildMemoryPrompt(body, apiKey);
      if (mem) memoryPrompts.set(request, mem);
    } catch (e) {
      log.warn("MEMORY", `retrieve skipped: ${e.message}`);
    }
  }

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const capModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings);
    // Cost pool: Jev candidates for "smart"; last-resort fallback (tried only after every combo model fails) for other strategies.
    const pooled = comboStrategies[modelStr]?.smartPool === false ? capModels : await augmentModelsWithSmartPool(capModels, "smart", settings, modelStr, getComboModels);
    const allModels = await filterAdapterModels(keyAccess, pooled, comboModels);
    const fallbackPool = comboStrategy === "smart" ? [] : allModels.filter((m) => !capModels.includes(m));
    const augmentedModels = allModels.filter((m) => !fallbackPool.includes(m));
    const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m) && capModels.includes(m));

    if (comboStrategy === "fusion" || comboStrategy === "orchestrate") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy})`);
      const multi = comboStrategy === "fusion" ? handleFusionChat : handleOrchestrateChat;
      return multi({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        plannerModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategy === "fusion" ? comboStrategies[modelStr]?.fusionTuning : comboStrategies[modelStr]?.orchestrateTuning,
        profiles: comboStrategy === "orchestrate" ? await getRoutingProfiles(comboModels) : undefined,
        sessionId,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    const comboCfg = comboStrategies[modelStr] || {};
    const forceModel = await resolveForcedLane(request, augmentedModels);
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit,
      sessionId,
      fallbackPool,
      smartPolicy: comboCfg.smartPolicy || "smart",
      maxConcurrency: Number(comboCfg.maxConcurrency) || 0,
      sessionSticky: comboCfg.sessionSticky !== false,
      shuffle: comboCfg.shuffle === true,
      confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.7,
      smartWaitMs: typeof comboCfg.smartWaitMs === "number" ? comboCfg.smartWaitMs : 1200,
      forceModel,
      oneTurn: modelStr === "auto" ? {
        models: ["team", "council"],
        threshold: 0.4,
        // team is uncapped; council is capped at 10/day.
        consume: async (choice) => choice !== "council" || consumeEscalationBudget("auto", choice, 10),
      } : null,
      resolveSmartChoice: comboStrategy === "smart"
        ? (b, m) => resolveSmartChoice({
            body: b,
            models: m,
            routerModel: comboCfg.routerModel,
            comboName: modelStr,
            log,
          })
        : null,
    });
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const soloAugmented = await filterAdapterModels(keyAccess, augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings), [modelStr]);
  if (soloAugmented.length > 1) {
    const adapterAdded = soloAugmented.filter((m) => m !== modelStr);
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, contextMarker ? `${modelStr.slice(modelStr.indexOf("/") + 1)}[${contextMarker}]` : null);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, requestedModel = null) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      // Nested combo (a combo member that is itself a combo): the access decision
      // was made on the outer target; only drop adapter models the key may not call.
      const keyAccess = await getKeyAccessContext(request);
      const capModels = augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings);
      // No smart pool here: this combo was reached through an outer combo/pool,
      // re-adding the pool would let it route back into itself forever.
      const augmentedModels = await filterAdapterModels(keyAccess, capModels, comboModels);
      const adapterAdded = augmentedModels.filter((m) => !comboModels.includes(m) && capModels.includes(m));

      const nestedSession = resolveSessionIdentity({ headers: clientRawRequest?.headers, body });
      const nestedSessionId = nestedSession?.sessionId || null;
      if (comboStrategy === "fusion" || comboStrategy === "orchestrate") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy})`);
        const multi = comboStrategy === "fusion" ? handleFusionChat : handleOrchestrateChat;
        return multi({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          plannerModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategy === "fusion" ? comboStrategies[modelStr]?.fusionTuning : comboStrategies[modelStr]?.orchestrateTuning,
        profiles: comboStrategy === "orchestrate" ? await getRoutingProfiles(comboModels) : undefined,
        sessionId: nestedSessionId,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      const comboCfg = comboStrategies[modelStr] || {};
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit,
        sessionId: nestedSessionId,
        smartPolicy: comboCfg.smartPolicy || "smart",
        maxConcurrency: Number(comboCfg.maxConcurrency) || 0,
        sessionSticky: comboCfg.sessionSticky !== false,
        shuffle: comboCfg.shuffle === true,
        confidenceThreshold: typeof comboCfg.confidenceThreshold === "number" ? comboCfg.confidenceThreshold : 0.7,
        smartWaitMs: typeof comboCfg.smartWaitMs === "number" ? comboCfg.smartWaitMs : 1200,
        resolveSmartChoice: comboStrategy === "smart"
          ? (b, m) => resolveSmartChoice({
              body: b,
              models: m,
              routerModel: comboCfg.routerModel,
              comboName: modelStr,
              log,
            })
          : null,
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let lastHeaders = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, { requestedModel: requestedModel || model });

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman, lastHeaders);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable", lastHeaders);
    }

    // Skip accounts whose egress route just failed at transport level — same proxy, same failure.
    const routeKey = networkRouteKey(provider, credentials.providerSpecificData);
    // noauth always resolves to the same virtual connection, so fail fast instead of looping.
    if (isRouteDown(routeKey) && credentials.connectionId === "noauth") {
      return errorResponse(HTTP_STATUS.BAD_GATEWAY, `[${provider}/${model}] Network route down, retry shortly`);
    }
    if (isRouteDown(routeKey)) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError ||= `Network route down (${provider})`;
      lastStatus ||= HTTP_STATUS.BAD_GATEWAY;
      continue;
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(credentials.connectionId, refreshedCredentials.accessToken, provider);
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      customPromptEnabled: !!chatSettings.customPromptEnabled || memoryPrompts.has(request),
      customPrompt: [chatSettings.customPromptEnabled ? chatSettings.customPrompt : "", memoryPrompts.get(request)].filter(Boolean).join("\n\n"),
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      // Per-provider user overrides (custom headers / connect timeout) from settings
      providerOverrides: (chatSettings.providerOverrides || {})[provider] || null,
      // Detect source format by endpoint + body
      sourceFormatOverride: (() => {
        try { return request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null; }
        catch { return null; }
      })(),
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
        // "Consecutive" strikes: a success clears the breaker for this pair.
        clearAntigravityStrikes(credentials.connectionId, model);
      }
    });

    if (result.success) {
      // Agent memory capture: fire-and-forget, never delays or fails the reply.
      if (chatSettings.memoryEnabled && apiKey) {
        runMemoryLifecycle({ ownerType: "agent", ownerId: apiKey, query: lastUserText(body) }, apiKey)
          .catch((e) => log.warn("MEMORY", `capture skipped: ${e.message}`));
      }
      return result.response;
    }

    // Antigravity 409/429: refresh live quota to get exact resetAt before locking
    let quotaResetMs = null;
    let resetsAtMs = result.resetsAtMs;
    if (provider === "antigravity" && (result.status === 409 || result.status === 429)) {
      quotaResetMs = await handleAntigravityQuotaError(
        credentials.connectionId, result.status, model,
        refreshedCredentials.accessToken, credentials.providerSpecificData
      );
      if (quotaResetMs) resetsAtMs = quotaResetMs;
    }

    // Transport failure is the route's fault, not the account's: trip the route, don't lock the account.
    if (result.networkError) {
      log.warn("FALLBACK", `⇄ ROUTE ${routeKey} DOWN (network) → NEXT ACCOUNT`);
      markRouteDown(routeKey);
      if (credentials.connectionId === "noauth") return result.response;
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    // Exhausted Antigravity model is blocked only in RAM cache until upstream resetAt.
    // Do not persist a modelLock_* for this path.
    const shouldFallback = provider === "antigravity" && quotaResetMs
      ? true
      : (await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetsAtMs)).shouldFallback;

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      lastHeaders = upstreamResponseHeaders(result.response?.headers);
      continue;
    }

    return result.response;
  }
}

// User override: `x-jev-model: <combo member>` pins that model; `x-jev-lane: free|cheap|mid|premium`
// pins the first combo member in that cost tier. Unknown values are ignored (Jev decides).
export async function resolveForcedLane(request, models) {
  const h = request?.headers;
  const model = h?.get?.("x-jev-model")?.trim();
  if (model && models.includes(model)) return model;
  const lane = h?.get?.("x-jev-lane")?.trim().toLowerCase();
  if (!lane) return null;
  const tiers = await getModelTiers(models);
  return models.find((m) => tiers[m] === lane) || null;
}
