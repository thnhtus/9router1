import { describe, it, expect, vi } from "vitest";

const getRequestDetailById = vi.fn();
vi.mock("@/lib/usageDb", () => ({ getRequestDetailById }));

const { GET } = await import("@/app/api/usage/request-details/[id]/route.js");
const { mergeWithDefaults } = await import("@/lib/db/repos/settingsRepo.js");

const call = (id) => GET(new Request("http://x"), { params: Promise.resolve({ id }) });

describe("GET /api/usage/request-details/[id]", () => {
  it("returns the full stored payload for an existing id", async () => {
    const detail = { id: "a1", request: { messages: [{ role: "user", content: "hi" }] }, response: { content: "yo" } };
    getRequestDetailById.mockResolvedValueOnce(detail);
    const res = await call("a1");
    expect(getRequestDetailById).toHaveBeenLastCalledWith("a1");
    expect(res.status).toBe(200);
    expect((await res.json()).detail).toEqual(detail);
  });

  it("returns 404 for an unknown id", async () => {
    getRequestDetailById.mockResolvedValueOnce(null);
    const res = await call("missing");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Request detail not found");
  });

  it("default per-field payload cap is 1 MB so full bodies are stored", () => {
    expect(mergeWithDefaults({}).observabilityMaxJsonSize).toBe(1024);
  });
});
