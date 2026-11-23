import { describe, it, expect, vi, beforeEach } from "vitest";

// The free gate keys on the TLS ClientHello: on one process and egress IP the
// same body/headers answered 429 over Node's OpenSSL fingerprint and 200 over
// the cipher list below. These tests pin the wiring, not the upstream.
const { createSessionMock, loadRuntimeDepMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  loadRuntimeDepMock: vi.fn(),
}));

vi.mock("../../open-sse/services/lazyRuntime.js", () => ({
  loadRuntimeDep: loadRuntimeDepMock,
}));

describe("opencodeTlsClient", () => {
  beforeEach(async () => {
    vi.resetModules();
    createSessionMock.mockReset();
    loadRuntimeDepMock.mockReset();
    loadRuntimeDepMock.mockResolvedValue({ createSession: createSessionMock });
  });

  it("uses the cipher list the upstream accepts and sends ALPN-negotiated requests", async () => {
    const response = new Response("data: ok\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    createSessionMock.mockResolvedValue({ fetch: fetchMock, close: vi.fn() });

    const { opencodeTlsFetch, __test__ } = await import("../../open-sse/services/opencodeTlsClient.js");
    const result = await opencodeTlsFetch("https://opencode.ai/inference/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const options = createSessionMock.mock.calls[0][0];
    expect(options.emulation.tlsOptions.cipherList).toBe(__test__.OPENCODE_CIPHER_LIST);
    // BoringSSL family list: AES-128-GCM first plus the legacy CBC entries the
    // upstream fingerprints on. Dropping any of them is refused upstream.
    expect(__test__.OPENCODE_CIPHER_LIST.split(":")).toHaveLength(17);
    expect(__test__.OPENCODE_CIPHER_LIST.startsWith("TLS_AES_128_GCM_SHA256")).toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/inference/v1/chat/completions",
      expect.objectContaining({ method: "POST", body: "{}" })
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("text/event-stream");
  });

  it("reuses one session across requests", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("ok", { status: 200 }));
    createSessionMock.mockResolvedValue({ fetch: fetchMock, close: vi.fn() });

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    await opencodeTlsFetch("https://opencode.ai/a", {});
    await opencodeTlsFetch("https://opencode.ai/b", {});

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops the pooled session after a transport error and retries on a fresh one", async () => {
    const ok = new Response("ok", { status: 200 });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("http2 error: stream error received: unspecific protocol error detected"))
      .mockResolvedValueOnce(ok);
    const closeMock = vi.fn().mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue({ fetch: fetchMock, close: closeMock });

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    const result = await opencodeTlsFetch("https://opencode.ai/a", {});

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The poisoned session is closed and a second, fresh session is created.
    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the transport error once the fresh-session retry also fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("http2 error: stream error"));
    const closeMock = vi.fn().mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue({ fetch: fetchMock, close: closeMock });

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");

    await expect(opencodeTlsFetch("https://opencode.ai/a", {})).rejects.toThrow(/http2 error/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(createSessionMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry or reset the session when the caller aborts", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("aborted"));
    const closeMock = vi.fn().mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue({ fetch: fetchMock, close: closeMock });

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    const controller = new AbortController();
    controller.abort();

    await expect(
      opencodeTlsFetch("https://opencode.ai/a", {}, { signal: controller.signal })
    ).rejects.toThrow(/aborted/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("surfaces an actionable error when wreq-js is unavailable", async () => {
    loadRuntimeDepMock.mockRejectedValue(new Error("MODULE_NOT_FOUND"));

    const { opencodeTlsFetch, OpencodeTlsUnavailableError } = await import(
      "../../open-sse/services/opencodeTlsClient.js"
    );

    await expect(opencodeTlsFetch("https://opencode.ai/a", {})).rejects.toBeInstanceOf(
      OpencodeTlsUnavailableError
    );
  });

  it("forwards the abort signal so a cancelled stream stops upstream", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("ok", { status: 200 }));
    createSessionMock.mockResolvedValue({ fetch: fetchMock, close: vi.fn() });

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    const controller = new AbortController();
    await opencodeTlsFetch("https://opencode.ai/a", {}, { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
