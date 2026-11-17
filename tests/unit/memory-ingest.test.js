import { describe, it, expect, vi } from "vitest";

const saved = [];
vi.mock("@/lib/db/repos/requestDetailsRepo.js", () => ({
  saveRequestDetail: async (d) => { saved.push(d); },
}));

const { POST, buildTurnDetail } = await import("@/app/api/v1/memory/ingest/route.js");
const post = (body) => new Request("http://localhost/api/v1/memory/ingest", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("harness turn ingest", () => {
  it("rejects a missing sessionId", async () => {
    const res = await POST(post({ prompt: "hi" }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty turn", async () => {
    const res = await POST(post({ sessionId: "s1" }));
    expect(res.status).toBe(400);
  });

  it("stores a turn in the shape evaluateSession reads", async () => {
    const res = await POST(post({
      sessionId: "s2",
      harness: "pi",
      prompt: "fix the migration",
      response: "done",
      tools: [{ name: "bash", input: "npm run migrate", output: "ok" }],
    }));
    expect(res.status).toBe(200);
    const d = saved.at(-1);
    expect(d.sessionId).toBe("s2");
    expect(d.provider).toBe("harness:pi");
    expect(d.request.messages[0]).toEqual({ role: "user", content: "fix the migration" });
    expect(d.response.content).toContain("npm run migrate");
  });

  it("redacts secrets and caps tool count", () => {
    const d = buildTurnDetail({
      sessionId: "s3",
      prompt: "Authorization: Bearer abc.def",
      response: "ok",
      tools: Array.from({ length: 80 }, (_, i) => ({ name: `t${i}`, input: "x", output: "y" })),
    });
    expect(d.request.messages[0].content).not.toContain("abc.def");
    expect(d.response.content.split("\n- ").length - 1).toBe(50);
  });
});
