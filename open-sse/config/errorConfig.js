// OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
  auth: 10 * 60 * 1000,
};

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, cooldownMs?, backoff?, kind? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 *   - kind: semantic class used by combo-health to decide whether the failure is
 *     truly permanent ("model") vs. transient/rotatable ("quota", "credential",
 *     "network"). Defaults to "transient" when omitted.
 */
export const ERROR_KIND = { CREDENTIAL: "credential", QUOTA: "quota", MODEL: "model", NETWORK: "network", TRANSIENT: "transient", REQUEST: "request" };

export const ERROR_RULES = [
  // --- Text-based rules (checked first, order = priority) ---
  // Codex-specific auth boundary — the credential is valid, just not for this
  // model. Rotate accounts rather than killing the member.
  { provider: "codex", text: "model is not supported when using codex with a chatgpt account", cooldownMs: MAX_RATE_LIMIT_COOLDOWN_MS, kind: ERROR_KIND.CREDENTIAL },
  // Intl gateway blocks affect the account/IP — treat like network hiccups.
  { provider: "codebuddy-intl", text: "request illegal", backoff: true, kind: ERROR_KIND.NETWORK },
  { provider: "codebuddy-intl", text: "conversation id missing", backoff: true, kind: ERROR_KIND.NETWORK },
  { text: "no credentials",           cooldownMs: COOLDOWN.long, kind: ERROR_KIND.CREDENTIAL },
  // 404 "No active credentials for provider: X" is a routing/credential state, not a
  // deleted model — dropping the member would be permanent damage from a config gap.
  { text: "no active credentials",     cooldownMs: COOLDOWN.long, kind: ERROR_KIND.CREDENTIAL },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short, kind: ERROR_KIND.NETWORK },
  { text: "improperly formed request", cooldownMs: COOLDOWN.long, kind: ERROR_KIND.CREDENTIAL },
  // Refresh-token/credential deaths are not fixable by a 2-minute retry; give the
  // operator time to re-authenticate without hammering the provider.
  { text: "invalid_grant",            cooldownMs: COOLDOWN.auth, kind: ERROR_KIND.CREDENTIAL },
  { text: "token expired",            cooldownMs: COOLDOWN.auth, kind: ERROR_KIND.CREDENTIAL },
  { text: "authentication failed",    cooldownMs: COOLDOWN.auth, kind: ERROR_KIND.CREDENTIAL },
  // Rate-quota class — always rotational (exponential backoff).
  { text: "rate limit",               backoff: true, kind: ERROR_KIND.QUOTA },
  { text: "too many requests",        backoff: true, kind: ERROR_KIND.QUOTA },
  { text: "quota exceeded",           backoff: true, kind: ERROR_KIND.QUOTA },
  { text: "insufficient credit",      backoff: true, kind: ERROR_KIND.QUOTA },
  { text: "credit balance is too low", backoff: true, kind: ERROR_KIND.QUOTA },
  { text: "capacity",                 backoff: true, kind: ERROR_KIND.QUOTA },
  { text: "overloaded",               backoff: true, kind: ERROR_KIND.QUOTA },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 401, cooldownMs: COOLDOWN.long, kind: ERROR_KIND.CREDENTIAL },
  { status: 402, cooldownMs: COOLDOWN.long, kind: ERROR_KIND.CREDENTIAL },
  { status: 403, cooldownMs: COOLDOWN.long, kind: ERROR_KIND.CREDENTIAL },
  // A 404 here means the upstream literally does not know this model — drop-worthy.
  { status: 404, cooldownMs: COOLDOWN.long, kind: ERROR_KIND.MODEL },
  { status: 429, backoff: true, kind: ERROR_KIND.QUOTA },
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};
