// Sniffed provider registries (cheapllm, synap, merkium) ship display-only
// models whose `id` is null. With an active connection for one of those
// providers and no explicit enabledModels, /v1/models fed those ids straight
// into `.startsWith(...)` and the whole endpoint 500'd:
//   TypeError: Cannot read properties of null (reading 'startsWith')
import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { buildModelsList, GET } = await import("../../src/app/api/v1/models/route.js");

function connection(provider, providerSpecificData = {}) {
  return { id: 1, provider, isActive: true, providerSpecificData };
}

describe("/v1/models with null model ids", () => {
  it("skips the null ids in a provider's static table instead of throwing", async () => {
    db.getProviderConnections.mockResolvedValue([connection("synap")]);

    const models = await buildModelsList(["llm"]);

    expect(models.every((model) => typeof model.id === "string" && model.id.trim() !== "")).toBe(true);
    expect(models.some((model) => model.id.startsWith("synap/"))).toBe(false);
  });

  it("drops a null entry from enabledModels and keeps its siblings", async () => {
    db.getProviderConnections.mockResolvedValue([
      connection("opencode", { enabledModels: ["kimi-k3", null, "", "glm-5"] }),
    ]);

    const models = await buildModelsList(["llm"]);
    const ids = models.map((model) => model.id);

    // output alias for opencode is "oc"
    expect(ids).toContain("oc/kimi-k3");
    expect(ids).toContain("oc/glm-5");
    expect(ids.filter((id) => id.endsWith("/null") || id.endsWith("/"))).toEqual([]);
  });

  it("GET returns 200 rather than a 500 from the null-id provider", async () => {
    db.getProviderConnections.mockResolvedValue([connection("synap")]);

    const response = await GET({ headers: { get: () => null } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
