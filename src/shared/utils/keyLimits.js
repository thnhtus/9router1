// Per-API-key limits: pure helpers (no DB, no request objects). Shared by the
// DB repo, the /api/keys routes and the engine.
import { KEY_LIMITS_UNLIMITED, BUDGET_PERIODS, KEY_LIMIT_MAX } from "@/shared/constants/keyLimits.js";

const nonNeg = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const period = (v) => (BUDGET_PERIODS.includes(v) ? v : KEY_LIMITS_UNLIMITED.period);

/** Read the limits object off an apiKeys row (missing/corrupt columns → unlimited). */
export function keyLimitsFromColumns(row) {
  if (!row) return { ...KEY_LIMITS_UNLIMITED };
  return {
    rpm: nonNeg(row.limitRpm),
    tokens: Math.floor(nonNeg(row.limitTokens)),
    cost: nonNeg(row.limitCost),
    period: period(row.limitPeriod),
  };
}

/** True when the key has at least one active limit — the only case worth gating. */
export function hasKeyLimits(limits) {
  return !!limits && (limits.rpm > 0 || limits.tokens > 0 || limits.cost > 0);
}

/** Columns to persist for a validated limits object. */
export function keyLimitsToColumns(limits) {
  const l = limits || KEY_LIMITS_UNLIMITED;
  return {
    limitRpm: Math.min(Math.floor(nonNeg(l.rpm)), KEY_LIMIT_MAX.rpm),
    limitTokens: Math.min(Math.floor(nonNeg(l.tokens)), KEY_LIMIT_MAX.tokens),
    limitCost: Math.min(nonNeg(l.cost), KEY_LIMIT_MAX.cost),
    limitPeriod: period(l.period),
  };
}

/**
 * Validate client input for a limits update. Rejects rather than repairs, so a
 * declared limit is never silently changed or dropped.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validateKeyLimitsInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "limits must be an object { rpm, tokens, cost, period }" };
  }
  const allowed = ["rpm", "tokens", "cost", "period"];
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  if (extra.length) return { ok: false, error: `limits: unexpected field(s) ${extra.join(", ")}` };

  const out = { ...KEY_LIMITS_UNLIMITED };
  for (const field of ["rpm", "tokens", "cost"]) {
    if (input[field] === undefined) continue;
    const v = input[field];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      return { ok: false, error: `limits.${field} must be a non-negative number` };
    }
    if (v > KEY_LIMIT_MAX[field]) {
      return { ok: false, error: `limits.${field} must be at most ${KEY_LIMIT_MAX[field]}` };
    }
    if (field !== "cost" && !Number.isInteger(v)) {
      return { ok: false, error: `limits.${field} must be an integer` };
    }
    out[field] = v;
  }
  if (input.period !== undefined) {
    if (!BUDGET_PERIODS.includes(input.period)) {
      return { ok: false, error: `limits.period must be one of ${BUDGET_PERIODS.join(", ")}` };
    }
    out.period = input.period;
  }
  return { ok: true, value: out };
}

/** ISO start of the current budget period (UTC), so resets need no cron. */
export function budgetPeriodStart(periodName, now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return periodName === "monthly"
    ? new Date(Date.UTC(y, m, 1)).toISOString()
    : new Date(Date.UTC(y, m, d.getUTCDate())).toISOString();
}
