import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory sniffer store + scripted verdicts per provider id.
let store = [];
const verdicts = { a: "yes", b: "no", c: "unknown" };
const checkFreeUsable = vi.fn(async (p) => ({ freeUsable: verdicts[p.id], source: "jev:x", confidence: 0.9 }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } }));
vi.mock("@/lib/providerSniffer.js", () => ({
  READ_SNIFFER_PROVIDERS: async () => store,
  WRITE_SNIFFER_PROVIDERS: async (l) => { store = l; },
  READ_SNIFFER_SETTINGS: async () => ({}),
  WRITE_SNIFFER_SETTINGS: async () => {},
  seedInitialCandidatesIfEmpty: async () => [],
  checkFreeUsable,
  passesFreeGate: () => false,
  verifyCandidate: vi.fn(), isAlreadyInRegistry: vi.fn(), generateRegistryDraft: vi.fn(),
  scanFreeLlmCatalog: vi.fn(), installToRegistry: vi.fn(), fetchProviderLogo: vi.fn(), crawlProviderLogos: vi.fn(),
}));
const { POST } = await import("../../src/app/api/provider-sniffer/route.js");
const post = (body) => POST({ json: async () => body });

beforeEach(() => {
  checkFreeUsable.mockClear();
  store = [
    { id: "ok", status: "verified", freeCheck: { freeUsable: "yes" } }, // already free → skipped
    { id: "a", status: "candidate" },
    { id: "b", status: "candidate" },
    { id: "c", status: "candidate" },
  ];
});

describe("provider-sniffer checkFree / checkFreeAll", () => {
  it("checkFreeAll skips free-usable, ignores needs-billing", async () => {
    const r = await post({ action: "checkFreeAll" });
    expect(r.body.results).toEqual({ checked: 3, skipped: 1, yes: 1, no: 1, unknown: 1 });
    expect(checkFreeUsable.mock.calls.map(([p]) => p.id)).toEqual(["a", "b", "c"]);
    const byId = Object.fromEntries(store.map((p) => [p.id, p.status]));
    expect(byId).toEqual({ ok: "verified", a: "candidate", b: "ignored", c: "candidate" });
  });

  it("single checkFree also ignores needs-billing", async () => {
    const r = await post({ action: "checkFree", id: "b" });
    expect(r.body.provider.status).toBe("ignored");
    expect((await post({ action: "checkFree", id: "c" })).body.provider.status).toBe("candidate");
  });
});
