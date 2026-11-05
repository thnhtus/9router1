import { describe, it, expect } from "vitest";
import { createMemory, listMemories, updateMemory, retrieveMemories } from "../../src/lib/db/repos/agentMemoriesRepo.js";
import { POST as createRoute } from "../../src/app/api/memory/route.js";
import { extractFacts } from "../../open-sse/services/memoryGraph.js";

describe("agent memory repo", () => {
  it("create/list/update version bump", async () => {
    const m = await createMemory({ ownerType: "user", ownerId: "u1", type: "semantic", content: "hello" });
    expect(m.version).toBe(1);
    const updated = await updateMemory(m.id, { content: "hello2" });
    expect(updated.version).toBe(2);
    const list = await listMemories({ ownerId: "u1" });
    expect(list.length).toBeGreaterThan(0);
  });

  it("retrieve ordering with synthetic embeddings", async () => {
    await createMemory({ ownerType: "user", ownerId: "u2", type: "semantic", content: "a", embedding: [1, 0] });
    await createMemory({ ownerType: "user", ownerId: "u2", type: "semantic", content: "b", embedding: [0, 1] });
    const res = await retrieveMemories({ ownerType: "user", ownerId: "u2", queryEmbedding: [1, 0], topK: 1 });
    expect(res[0].content).toBe("a");
  });
});

describe("memory API validation", () => {
  it("rejects invalid payload", async () => {
    const req = new Request("http://localhost/api/memory", { method: "POST", body: JSON.stringify({ ownerType: "x", ownerId: "u", type: "semantic", content: "hi" }), headers: { "Content-Type": "application/json" } });
    const res = await createRoute(req);
    expect(res.status).toBe(400);
  });
});

describe("extractFacts heuristic", () => {
  it("matches sentence-start triggers only", () => {
    expect(extractFacts("remember my favorite color is blue")).toEqual(["remember my favorite color is blue"]);
    expect(extractFacts("Nhớ hộ tôi địa chỉ này")).toHaveLength(1);
    expect(extractFacts("never store this")).toEqual(["never store this"]);
    // must NOT match trigger words mid-text (past junk: ACP status line matched "never guess them")
    expect(extractFacts("[ACP status: refs above it, never guess them]")).toEqual([]);
    expect(extractFacts("can you always answer in English?")).toEqual([]);
  });
});
