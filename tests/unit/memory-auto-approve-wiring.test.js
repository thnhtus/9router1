// Wiring test for the opt-in auto-approve path: a strong session must be written
// as metadata.status="approved" with an audit trail, a weak one stays a candidate.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: { memoryEvalEnabled: true, memoryAutoApprove: true, memoryEvalModel: "" },
  createMemory: vi.fn(async (payload) => ({ id: "m1", ...payload })),
  answers: {},
}));

vi.mock("@/sse/services/model.js", () => ({ getModelInfo: async () => ({ provider: "typesafe", model: "jev-latest" }) }));
vi.mock("@/sse/services/auth.js", () => ({ getProviderCredentials: async () => ({ apiKey: "k" }) }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c }));
vi.mock("open-sse/handlers/systemoneCore.js", () => ({
  handleSystemoneCore: async () => ({
    success: true,
    response: { json: async () => ({ answers: mocks.answers }) },
  }),
}));
vi.mock("@/lib/db/repos/requestDetailsRepo.js", () => ({
  getRequestDetails: async () => ({
    details: [
      {
        sessionId: "01a1e87c-cf9b-7586-aab1-bbf1528e8698",
        provider: "harness:pi",
        model: "auto",
        timestamp: "2026-01-01T00:00:00Z",
        request: { messages: [{ role: "user", content: "refactor the runner" }] },
        response: { content: "done: npm test" },
      },
    ],
    pagination: { page: 1, hasNext: false },
  }),
}));
vi.mock("@/lib/db/repos/agentMemoriesRepo.js", () => ({ createMemory: mocks.createMemory }));
vi.mock("@/lib/localDb.js", () => ({ getApiKeys: async () => [{ key: "sk-test-1234567890" }] }));
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({ getSettings: async () => mocks.settings }));

const { evaluateSession } = await import("@/lib/memory/evaluate.js");

const answer = (v) => ({ probabilities: { yes: v } });

beforeEach(() => {
  mocks.createMemory.mockClear();
  mocks.settings = { memoryEvalEnabled: true, memoryAutoApprove: true, memoryEvalModel: "" };
});

describe("evaluateSession auto-approve wiring", () => {
  it("writes an approved memory with audit trail for a strong session", async () => {
    mocks.answers = { task_success: answer(0.95), reusable: answer(0.9), evidence: answer(0.95) };
    const out = await evaluateSession({ sessionId: "01a1e87c-cf9b-7586-aab1-bbf1528e8698" });
    expect(out.candidateCreated).toBe(true);
    expect(out.autoApproved).toBe(true);
    const meta = mocks.createMemory.mock.calls[0][0].metadata;
    expect(meta.status).toBe("approved");
    expect(meta.autoApproved).toBe(true);
    expect(meta.autoApproveReason).toContain("Jev task=0.95");
  });

  it("keeps the human gate when the switch is off", async () => {
    mocks.settings = { memoryEvalEnabled: true, memoryAutoApprove: false, memoryEvalModel: "" };
    mocks.answers = { task_success: answer(0.95), reusable: answer(0.9), evidence: answer(0.95) };
    const out = await evaluateSession({ sessionId: "01a1e87c-cf9b-7586-aab1-bbf1528e8698" });
    expect(out.autoApproved).toBe(false);
    expect(mocks.createMemory.mock.calls[0][0].metadata.status).toBe("candidate");
  });

  it("does not auto-approve a session that merely passes the candidate gate", async () => {
    mocks.answers = { task_success: answer(0.6), reusable: answer(0.7), evidence: answer(0.7) };
    const out = await evaluateSession({ sessionId: "01a1e87c-cf9b-7586-aab1-bbf1528e8698" });
    expect(out.passed).toBe(true);
    expect(out.autoApproved).toBe(false);
    expect(mocks.createMemory.mock.calls[0][0].metadata.status).toBe("candidate");
  });
});
