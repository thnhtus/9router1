// Smoke: which Jev signals bump "Lossy applied" vs "Blocked by Jev" (Caveman on, Headroom off).
import { it, expect, vi, beforeEach } from "vitest";
import "../translator/registerAll.js";
import { SMART_SIGNAL } from "../../open-sse/services/systemoneRouter.js";

const { executeMock, bumpMock } = vi.hoisted(() => ({ executeMock: vi.fn(), bumpMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: executeMock }) }));
vi.mock("@/lib/db/repos/tokenSaverRepo.js", () => ({ bumpTokenSaverHourly: bumpMock }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
  createSSETransformStreamWithLogger: vi.fn(() => new TransformStream()),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockResolvedValue({
    response: new Response(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } }),
    url: "https://api.openai.com/v1/chat/completions", headers: {}, transformedBody: null,
  });
});

const run = (signal, headers = {}) => {
  const body = { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hi" }] };
  if (signal) body[SMART_SIGNAL] = signal;
  return handleChatCore({
    body, modelInfo: { provider: "openai", model: "gpt-4o" }, credentials: { apiKey: "k", providerSpecificData: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, connectionId: "c",
    headroomEnabled: false, rtkEnabled: false, cavemanEnabled: true, cavemanLevel: "lite", ponytailEnabled: false,
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json", ...headers } },
  }).then(() => bumpMock.mock.calls.at(-1)?.[0]);
};

it.each([
  ["Jev L1 confident", { level: 1, levelConfidence: 0.9, levelLowProbability: 0.95 }, { level: "L1", lossyApplied: 1, lossyBlocked: 0, caveman: 1 }],
  ["Jev L2 confident", { level: 2, levelConfidence: 0.9, levelLowProbability: 0.85 }, { level: "L2", lossyApplied: 1, lossyBlocked: 0 }],
  ["Jev L2 low-confidence", { level: 2, levelConfidence: 0.6, levelLowProbability: 0.6 }, { level: "L2", lossyApplied: 0, lossyBlocked: 1 }],
  ["Jev L3", { level: 3, levelConfidence: 0.95 }, { level: "L3", lossyApplied: 0, lossyBlocked: 1 }],
  ["Jev L4", { level: 4, levelConfidence: 0.95 }, { level: "L4", lossyApplied: 0, lossyBlocked: 1 }],
  ["heuristic L1 (Jev late)", { level: 1, levelConfidence: 0.5, source: "heuristic" }, { level: "L1", lossyApplied: 0, lossyBlocked: 1 }],
  ["no Jev signal (non-smart combo)", null, { level: "", lossyApplied: 1, lossyBlocked: 0 }],
])("%s", async (_name, signal, expected) => {
  expect(await run(signal)).toMatchObject(expected);
});

it("x-9router-token-saver: off skips Caveman without counting a Jev block", async () => {
  expect(await run({ level: 1, levelConfidence: 0.9, levelLowProbability: 0.95 }, { "x-9router-token-saver": "off" }))
    .toMatchObject({ lossyApplied: 0, lossyBlocked: 0, caveman: 0 });
});
