// Regression: handleSingleModelChat referenced `sessionId` from handleChatInner's
// scope (ReferenceError: sessionId is not defined at chat.js:466) on every
// successful request while memoryEvalEnabled was on.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  handleChatCore: vi.fn(),
  scheduleSessionEval: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false, comboStrategy: "fallback", memoryEvalEnabled: true }),
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getCombos: async () => [],
  getProviderConnections: async () => [],
  getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => [] }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async () => null }));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn() }));
vi.mock("@/lib/memory/evaluate.js", () => ({ scheduleSessionEval: mocks.scheduleSessionEval }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(),
  extractApiKey: (request) => {
    const a = request.headers.get("Authorization");
    return a?.startsWith("Bearer ") ? a.slice(7) : request.headers.get("x-api-key");
  },
  isValidApiKey: async () => true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c,
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

const SESSION = "sess-abc-123";
const post = (headers = {}) => new Request("http://localhost/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test", ...headers },
  body: JSON.stringify({ model: "openai/model-a", messages: [{ role: "user", content: "hi" }] }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn", connectionName: "mock" });
  mocks.handleChatCore.mockResolvedValue({
    success: true,
    response: new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
});

describe("session eval scheduling in handleSingleModelChat", () => {
  it("succeeds and schedules the eval with the client session id", async () => {
    const res = await handleChat(post({ "x-session-id": SESSION }));
    expect(res.status).toBe(200);
    expect(mocks.scheduleSessionEval).toHaveBeenCalledWith(SESSION, { ownerType: "agent", ownerId: "sk-test" });
  });

  it("succeeds without any client session header (derived id, no throw)", async () => {
    const res = await handleChat(post());
    expect(res.status).toBe(200);
    expect(mocks.scheduleSessionEval).toHaveBeenCalledTimes(1);
  });
});
