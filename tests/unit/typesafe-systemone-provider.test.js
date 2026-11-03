import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvidersByKind } from "@/shared/constants/providers";
import { handleSystemoneCore } from "../../open-sse/handlers/systemoneCore.js";
import { parseSystemOneRouteAnswer, buildChoiceCriteria } from "../../open-sse/services/systemoneRouter.js";

const URL = "https://api.typesafe.ai/v1/systemone";

describe("TypeSafe Jev as Smart Router model", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is listed as a systemone provider", () => {
    const p = getProvidersByKind("systemone").find((x) => x.id === "typesafe");
    expect(p?.systemoneConfig?.baseUrl).toBe(URL);
  });

  it("posts the combo route question with Bearer auth and parses the choice", async () => {
    const reply = { model: "jev-latest", answers: { route: { type: "choice", choice: "cc/opus", confidence: 0.68, probabilities: { "cc/opus": 0.84, "gemini/flash": 0.16 } } }, usage: { input_tokens: 308, output_tokens: 51 } };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(reply), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { model: "jev-latest", state: "refactor auth", questions: { route: { type: "choice", instructions: "pick", criteria: buildChoiceCriteria(["cc/opus", "gemini/flash"]) } } };
    const r = await handleSystemoneCore({ body, modelInfo: { provider: "typesafe", model: "jev-latest" }, credentials: { apiKey: "ts_k" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL);
    expect(init.headers.Authorization).toBe("Bearer ts_k");
    expect(parseSystemOneRouteAnswer(await r.response.json()).choice).toBe("cc/opus");
  });
});
