import { describe, it, expect, vi } from "vitest";
import { acquire, releaseOnBodyEnd, getSemaphoreStats } from "../../open-sse/services/modelSemaphore.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("modelSemaphore", () => {
  it("caps running slots, queues FIFO, hands slots over on release", async () => {
    const r1 = await acquire("m", { max: 2 });
    await acquire("m", { max: 2 });
    let third = null;
    acquire("m", { max: 2 }).then((r) => (third = r));
    await tick();
    expect(third).toBe(null);
    expect(getSemaphoreStats("m")).toEqual({ running: 2, queued: 1 });
    r1();
    r1(); // idempotent
    await tick();
    expect(typeof third).toBe("function");
    expect(getSemaphoreStats("m")).toEqual({ running: 2, queued: 0 });
  });

  it("rejects on full queue and on timeout", async () => {
    await acquire("q", { max: 1 });
    await expect(acquire("q", { max: 1, maxQueue: 0 })).rejects.toMatchObject({ code: "SEMAPHORE_BUSY" });
    await expect(acquire("q", { max: 1, timeoutMs: 10 })).rejects.toMatchObject({ code: "SEMAPHORE_BUSY" });
    expect(getSemaphoreStats("q").queued).toBe(0);
  });

  it("max 0 is unlimited", async () => {
    for (let i = 0; i < 5; i++) await acquire("u", { max: 0 });
    expect(getSemaphoreStats("u")).toEqual({ running: 0, queued: 0 });
  });

  it("holds the slot until the body is consumed", async () => {
    const release = vi.fn();
    const res = releaseOnBodyEnd(new Response("hello"), release);
    expect(release).not.toHaveBeenCalled();
    expect(await res.text()).toBe("hello");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("round-robin combo with maxConcurrency", () => {
  it("cascades to the next member when the first is full", async () => {
    const hold = await acquire("a/x", { max: 1 }); // occupy member a
    const handleSingleModel = vi.fn(async (_b, m) => new Response(JSON.stringify({ choices: [{ message: { content: m } }] }), { headers: { "content-type": "application/json" } }));
    const log = { info() {}, warn() {}, debug() {}, error() {} };
    const res = await handleComboChat({
      body: {}, models: ["a/x", "b/y"], handleSingleModel, log,
      comboName: "rr-test", comboStrategy: "round-robin", maxConcurrency: 1,
    }).catch((e) => e);
    hold();
    expect(res).toBeInstanceOf(Response);
    expect(handleSingleModel.mock.calls.map((c) => c[1])).toContain("b/y");
  });
});
