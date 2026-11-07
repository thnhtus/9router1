import { describe, it, expect } from "vitest";
import { networkRouteKey, markRouteDown, isRouteDown, clearRouteDown, isNetworkError } from "../../open-sse/services/accountFallback.js";

describe("network route breaker", () => {
  it("keys accounts by egress path, so accounts behind one dead proxy share a key", () => {
    const viaProxy = { connectionProxyEnabled: true, connectionProxyUrl: "http://p1:8080" };
    expect(networkRouteKey("openai", viaProxy)).toBe(networkRouteKey("openai", { ...viaProxy, connectionProxyPoolId: "x" }));
    expect(networkRouteKey("openai", viaProxy)).not.toBe(networkRouteKey("openai", {}));
    expect(networkRouteKey("openai", { vercelRelayUrl: "https://r" })).toBe("openai::https://r");
    expect(networkRouteKey("openai", { connectionProxyUrl: "http://p1" })).toBe("openai::direct"); // proxy disabled
  });

  it("trips, expires and clears", async () => {
    const k = "t::direct";
    expect(isRouteDown(k)).toBe(false);
    markRouteDown(k, 20);
    expect(isRouteDown(k)).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(isRouteDown(k)).toBe(false);
    markRouteDown(k);
    clearRouteDown(k);
    expect(isRouteDown(k)).toBe(false);
  });

  it("detects transport errors only", () => {
    expect(isNetworkError(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }))).toBe(true);
    expect(isNetworkError({ cause: { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } } })).toBe(true);
    expect(isNetworkError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isNetworkError(new Error("Upstream 502 Bad Gateway"))).toBe(false);
    expect(isNetworkError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});
