import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db/helpers/kvStore.js", () => ({ makeKv: () => ({}) }));
vi.mock("open-sse/providers/index.js", () => ({ PROVIDERS: {} }));
// Jev unreachable → checkFreeUsable must fall back to the keyword heuristic.
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: async () => null }));
// No headless Chromium in unit tests → renderLocalText gracefully falls back.
vi.mock("open-sse/services/lazyRuntime.js", () => ({ loadRuntimeDep: async () => { throw new Error("no playwright"); } }));
vi.mock("open-sse/executors/browserExecutableCheck.js", () => ({
  launchChromiumWithFallback: async () => { throw new Error("no chromium"); },
  resolveSystemChromeExecutable: () => null,
}));
const { billingHeuristic, htmlToText, passesFreeGate, checkFreeUsable } = await import("../../src/lib/providerSniffer.js");

describe("free-without-billing check", () => {
  it("heuristic", () => {
    expect(billingHeuristic("Start free, no credit card required")).toBe("yes");
    expect(billingHeuristic("You must add a credit card to get API access")).toBe("no");
    expect(billingHeuristic("No credit card for the playground, but add a payment method for API keys")).toBe("no");
    expect(billingHeuristic("Fast inference")).toBe("unknown");
  });
  it("htmlToText strips scripts and tags", () => {
    expect(htmlToText("<p>Free <b>tier</b></p><script>x()</script>")).toBe("Free tier");
  });
  it("gate needs Jev yes with confidence >= 0.6", () => {
    expect(passesFreeGate({ freeCheck: { freeUsable: "yes", confidence: 0.9, source: "jev:oc/jev-1.13-free" } })).toBe(true);
    expect(passesFreeGate({ freeCheck: { freeUsable: "yes", confidence: 0.4, source: "jev:oc/jev-1.13-free" } })).toBe(false);
    expect(passesFreeGate({ freeCheck: { freeUsable: "yes", confidence: null, source: "heuristic" } })).toBe(false); // Jev down → never passes
    expect(passesFreeGate({ freeCheck: { freeUsable: "no", confidence: 0.99, source: "jev:oc/jev-1.13-free" } })).toBe(false);
    expect(passesFreeGate({})).toBe(false);
  });
  it("falls back to heuristic when Jev is unavailable", async () => {
    const v = await checkFreeUsable({ id: "x" }, { evidence: "No credit card required." });
    expect(v).toMatchObject({ freeUsable: "yes", source: "heuristic", evidenceSource: "rea" });
  });
});

describe("billing evidence fetch", () => {
  const ok = (text) => ({ ok: true, text: async () => text });
  it("uses r.jina.ai rendered content first", async () => {
    const fetchMock = vi.fn(async () => ok("Pricing: add a credit card to use the API"));
    vi.stubGlobal("fetch", fetchMock);
    const v = await checkFreeUsable({ id: "x", website: "https://x.dev" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://r.jina.ai/https://x.dev");
    expect(v).toMatchObject({ freeUsable: "no", evidenceSource: "fetch" });
    vi.unstubAllGlobals();
  });
  it("falls back to raw HTML when reader fails", async () => {
    const fetchMock = vi.fn(async (u) => (u.startsWith("https://r.jina.ai/") ? { ok: false } : ok("<p>No credit card required</p>")));
    vi.stubGlobal("fetch", fetchMock);
    const v = await checkFreeUsable({ id: "x", website: "https://x.dev" });
    expect(fetchMock.mock.calls.map(([u]) => u)).toContain("https://x.dev");
    expect(v.freeUsable).toBe("yes");
    vi.unstubAllGlobals();
  });
});
