// Regression: an unmatched 4xx (a request-scoped failure) used to hit the
// transient-cooldown default, which locked the account for 30s and — with a
// single connection — answered every other request in that window with a copy of
// the first error. A 400 "maximum context length" from one session therefore
// looked like the same failure in unrelated sessions.
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { ERROR_KIND } from "../../open-sse/config/errorConfig.js";

describe("checkFallbackError — request-scoped vs account-scoped failures", () => {
  it("does not cool the account down for a 400 caused by the request", () => {
    const result = checkFallbackError(400, JSON.stringify({
      error: {
        message: "This model's maximum context length is 1048576 tokens. However, you requested 1186139 tokens",
        type: "invalid_request_error",
      },
    }));

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0, requestScoped: true, kind: ERROR_KIND.REQUEST });
  });

  it("still falls back for account-scoped statuses", () => {
    for (const status of [401, 402, 403, 404, 429]) {
      expect(checkFallbackError(status, "nope").shouldFallback).toBe(true);
    }
  });

  it("still honours rate-limit / quota wording on any 4xx", () => {
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "quota exceeded").shouldFallback).toBe(true);
  });

  it.each([
    "You have insufficient credits to make this request. Please purchase more credits to continue using the service.",
    "INSUFFICIENT CREDITS",
    "Insufficient credit balance",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    "CREDIT BALANCE IS TOO LOW",
  ])("falls back with backoff for a 400 credit error: %s", (message) => {
    expect(checkFallbackError(400, message)).toEqual({
      shouldFallback: true, cooldownMs: 2000, newBackoffLevel: 1, kind: ERROR_KIND.QUOTA,
    });
    expect(checkFallbackError(400, message, 1)).toEqual({
      shouldFallback: true, cooldownMs: 4000, newBackoffLevel: 2, kind: ERROR_KIND.QUOTA,
    });
  });

  it("falls back with backoff for queue-timeout-no-priority errors", () => {
    const msg = "This request waited 10 min and the model had not started to answer; a request without priority credit is stopped after 10 min. Its prompt is about 92,289 tokens: a shorter one is read sooner. Send it again when the line is shorter.";
    expect(checkFallbackError(503, msg)).toEqual({
      shouldFallback: true, cooldownMs: 2000, newBackoffLevel: 1, kind: ERROR_KIND.QUOTA,
    });
  });

  it("does not fall back for an ordinary bad request", () => {
    expect(checkFallbackError(400, "Bad request")).toEqual({
      shouldFallback: false, cooldownMs: 0, requestScoped: true, kind: ERROR_KIND.REQUEST,
    });
  });

  it("keeps the transient cooldown for unmatched server errors", () => {
    const result = checkFallbackError(503, "upstream exploded");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(result.kind).toBe(ERROR_KIND.TRANSIENT);
  });
});

// Regression: classification must now carry a `kind` so combo-health can tell a
// genuinely-dead member ("model" — deleted alias / retired) apart from failures that
// are merely rotatable (quota / credential / network). Otherwise a free-tier quota
// exhaustion (429 → all-accounts-locked synthetic 503) or an expired auth token
// (401/403 → rotated away) keeps feeding the drop streak, and a healthy member gets
// evicted from the combo after COMBO_DROP_FAILS instead of just waiting for recovery.
describe("checkFallbackError — failure kinds", () => {
  it("classifies a missing model as drop-worthy (kind=model)", () => {
    const result = checkFallbackError(404, "The model `xyz` does not exist or you do not have access to it");
    expect(result.shouldFallback).toBe(true);
    expect(result.kind).toBe(ERROR_KIND.MODEL);
  });

  it("classifies auth/quota/token expiry as rotatable, not drop-worthy", () => {
    expect(checkFallbackError(401, "Invalid API key provided: [auth]").kind).toBe(ERROR_KIND.CREDENTIAL);
    expect(checkFallbackError(403, "authentication failed: token expired").kind).toBe(ERROR_KIND.CREDENTIAL);
    expect(checkFallbackError(429, "You have exceeded your quota").kind).toBe(ERROR_KIND.QUOTA);
    expect(checkFallbackError(503, "[provider/gpt-4o] rate limit reached").kind).toBe(ERROR_KIND.QUOTA);
    expect(checkFallbackError(401, "invalid_grant: refresh token has expired").kind).toBe(ERROR_KIND.CREDENTIAL);
  });
});

describe("checkFallbackError — synthetic no-credential 404 is not a dead model", () => {
  it("classifies the chat.js 404 envelope as credential, not model", () => {
    // Live evidence: POST /v1/chat/completions with an unconfigured provider returns
    // HTTP 404 {"error":{"message":"No active credentials for provider: openai","code":"model_not_found"}}
    const r = checkFallbackError(404, "No active credentials for provider: openai");
    expect(r.kind).toBe(ERROR_KIND.CREDENTIAL);
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });
});
