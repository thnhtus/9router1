// Per-API-key rate limits + token/cost budgets (FR-TO-001..FR-TO-007).
// Limits live as columns on apiKeys (limitRpm / limitTokens / limitCost /
// limitPeriod) — additive columns, auto-synced by syncSchemaFromTables, default 0
// (= unlimited). Usage is derived from usageHistory rows that carry the key.

export const KEY_LIMITS_UNLIMITED = Object.freeze({ rpm: 0, tokens: 0, cost: 0, period: "daily" });

export const BUDGET_PERIODS = Object.freeze(["daily", "monthly"]);

export const KEY_LIMIT_MAX = Object.freeze({
  rpm: 600, // requests per minute, hard upper bound
  tokens: 5_000_000, // tokens per period
  cost: 100, // USD per period
});

export const KEY_LIMIT_STATUS = Object.freeze({
  RATE_LIMITED: 429, // FR-TO-002
  PAYMENT_REQUIRED: 402, // FR-TO-003
});
