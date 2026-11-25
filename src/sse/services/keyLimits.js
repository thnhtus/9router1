// Per-API-key rate limits + budgets (FR-TO-002..FR-TO-004, FR-TO-007).
//
// Fail-open by design: an unreadable DB or a corrupt row must never take the
// whole gateway down — a limit is a cost guard, not an authorization check
// (authorization stays in keyAccess.js / isValidApiKey). A key with no limits,
// an unknown key, or a request with no key is untouched (FR-TO-007).
import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
import { hasKeyLimits, budgetPeriodStart } from "@/shared/utils/keyLimits.js";
import { KEY_LIMIT_STATUS } from "@/shared/constants/keyLimits.js";
import { extractClientApiKey } from "./keyAccess.js";
import { errorResponse } from "open-sse/utils/error.js";
import * as log from "../utils/logger.js";

const WINDOW_MS = 60_000;
const USAGE_CACHE_TTL_MS = 5_000;

if (!global._keyLimitState) {
  global._keyLimitState = {
    windows: new Map(), // keyId -> { stamps: number[] }
    usage: new Map(), // `${keyId}|${periodStart}` -> { tokens, cost, requests, ts }
  };
}
const state = global._keyLimitState;

function pruneWindow(stamps, now) {
  const cutoff = now - WINDOW_MS;
  let i = 0;
  while (i < stamps.length && stamps[i] <= cutoff) i++;
  if (i > 0) stamps.splice(0, i);
  return stamps;
}

/** Sum of this key's usage since the given ISO instant (tokens, cost, requests). */
export async function readKeyUsage(apiKey, periodStart) {
  const db = await getAdapter();
  const row = db.get(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(promptTokens), 0) + COALESCE(SUM(completionTokens), 0) AS tokens,
            COALESCE(SUM(cost), 0) AS cost
       FROM usageHistory
      WHERE apiKey = ? AND timestamp >= ?`,
    [apiKey, periodStart]
  );
  return {
    requests: Number(row?.requests || 0),
    tokens: Number(row?.tokens || 0),
    cost: Number(row?.cost || 0),
  };
}

async function cachedUsage(key, limits, now) {
  const periodStart = budgetPeriodStart(limits.period, new Date(now));
  const cacheKey = `${key.id}|${periodStart}`;
  const hit = state.usage.get(cacheKey);
  if (hit && now - hit.ts < USAGE_CACHE_TTL_MS) return { ...hit, periodStart };
  try {
    const fresh = await readKeyUsage(key.key, periodStart);
    // usageHistory rows land just after the response finishes, so a cached total
    // is always slightly BEHIND reality; that is the safe direction for a budget.
    state.usage.set(cacheKey, { ...fresh, ts: now });
    return { ...fresh, periodStart };
  } catch (e) {
    log.warn("AUTH", `key-limits: usage read failed for "${key.name || key.id}": ${e.message}`);
    return null; // fail open
  }
}

/**
 * Limits context for the request's key, or null when nothing needs enforcing
 * (no key, unknown key, or a key with no limits set).
 */
export async function getKeyLimitsContext(request) {
  const apiKey = extractClientApiKey(request);
  if (!apiKey) return null;
  let record;
  try {
    record = await getApiKeyByKey(apiKey);
  } catch {
    return null; // fail open
  }
  if (!record?.limits || !hasKeyLimits(record.limits)) return null;
  return { keyId: record.id, keyName: record.name || record.id, apiKey: record.key, limits: record.limits };
}

/**
 * Enforce a limits context. Returns a 429 (rate) or 402 (budget) Response, or
 * null when the request may proceed. An allowed request is counted in the
 * rate window.
 */
export async function enforceKeyLimits(ctx, now = Date.now()) {
  if (!ctx) return null;
  const { limits } = ctx;

  // 1. Rate limit: sliding 60s window per key.
  if (limits.rpm > 0) {
    const entry = state.windows.get(ctx.keyId) || { stamps: [] };
    state.windows.set(ctx.keyId, entry);
    pruneWindow(entry.stamps, now);
    if (entry.stamps.length >= limits.rpm) {
      // Oldest request must age out before a slot frees up.
      const retryAfterMs = Math.max(entry.stamps[0] + WINDOW_MS - now, 1000);
      const retryAfter = Math.ceil(retryAfterMs / 1000);
      log.warn("AUTH", `key-limits: key "${ctx.keyName}" exceeded ${limits.rpm} rpm`);
      return errorResponse(
        KEY_LIMIT_STATUS.RATE_LIMITED,
        `Rate limit exceeded for this API key (${limits.rpm} requests/minute). Retry in ${retryAfter}s.`,
        { "Retry-After": String(retryAfter) }
      );
    }
    entry.stamps.push(now);
  }

  // 2. Budget: tokens and/or cost since the start of the current period.
  if (limits.tokens > 0 || limits.cost > 0) {
    const usage = await cachedUsage(ctx, limits, now);
    if (!usage) return null; // fail open
    if (limits.tokens > 0 && usage.tokens >= limits.tokens) {
      log.warn("AUTH", `key-limits: key "${ctx.keyName}" exhausted token budget (${usage.tokens}/${limits.tokens})`);
      return errorResponse(
        KEY_LIMIT_STATUS.PAYMENT_REQUIRED,
        `Token budget exhausted for this API key (${limits.tokens} tokens per ${limits.period}, resets at ${nextReset(limits.period, usage.periodStart)}).`
      );
    }
    if (limits.cost > 0 && usage.cost >= limits.cost) {
      log.warn("AUTH", `key-limits: key "${ctx.keyName}" exhausted cost budget ($${usage.cost.toFixed(4)}/$${limits.cost})`);
      return errorResponse(
        KEY_LIMIT_STATUS.PAYMENT_REQUIRED,
        `Cost budget exhausted for this API key ($${limits.cost} per ${limits.period}, resets at ${nextReset(limits.period, usage.periodStart)}).`
      );
    }
  }

  return null;
}

function nextReset(periodName, periodStart) {
  const d = new Date(periodStart);
  if (periodName === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** One-line gate for the /v1 handlers: context + enforce. */
export async function enforceKeyLimitsForRequest(request) {
  return enforceKeyLimits(await getKeyLimitsContext(request));
}

/** Current usage snapshot for the dashboard (uncached, authoritative). */
export async function getKeyLimitUsage(key) {
  const limits = key.limits;
  const periodStart = budgetPeriodStart(limits.period);
  try {
    const usage = await readKeyUsage(key.key, periodStart);
    return { ...usage, periodStart, period: limits.period, resetsAt: nextReset(limits.period, periodStart) };
  } catch {
    return null;
  }
}

/** Test seam: reset in-memory windows/usage caches. */
export function __resetKeyLimitState() {
  state.windows.clear();
  state.usage.clear();
}
