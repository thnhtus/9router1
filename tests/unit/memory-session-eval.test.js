import { describe, it, expect } from "vitest";
import { yesProbability, groupSessions, redact, memoryOwnerIdFromKey, buildCandidateContent } from "@/lib/memory/evaluate.js";
import { memoryStatus, MEMORY_STATUSES } from "@/lib/db/repos/agentMemoriesRepo.js";

describe("memory session evaluation", () => {
  it("yesProbability reads probabilities.yes, falls back to choice", () => {
    expect(yesProbability({ a: { probabilities: { yes: 0.7 } } }, "a")).toBe(0.7);
    expect(yesProbability({ a: { choice: "yes" } }, "a")).toBe(1);
    expect(yesProbability({ a: { choice: "no" } }, "a")).toBe(0);
    expect(yesProbability({}, "a")).toBeNull();
  });

  it("memoryStatus defaults legacy rows to approved", () => {
    expect(memoryStatus({ metadata: {} })).toBe("approved");
    expect(memoryStatus({ metadata: { status: "candidate" } })).toBe("candidate");
    expect(MEMORY_STATUSES).toEqual(["candidate", "approved", "rejected"]);
  });

  it("redact strips bearer tokens and API keys", () => {
    const out = redact("Authorization: Bearer abc.def sk-123456789012345678");
    expect(out).not.toContain("abc.def");
    expect(out).not.toContain("sk-123456789012345678");
  });

  it("groupSessions keeps one group per sessionId", () => {
    const groups = groupSessions([
      { sessionId: "s1", provider: "a", model: "m", timestamp: "2026-01-01T00:00:00Z" },
      { sessionId: "s1", provider: "b", model: "n", timestamp: "2026-01-01T00:00:01Z" },
    ]);
    expect(groups.length).toBe(1);
  });

  it("candidate content keeps scores, models and a redacted last answer", () => {
    const req = (txt, ans) => ({
      sessionId: "s9",
      timestamp: "2026-01-01T00:00:00Z",
      request: { messages: [{ role: "user", content: txt }] },
      response: { content: ans },
    });
    const session = groupSessions([req("fix the migration", "ran Bearer abc.def then npm run migrate")])[0];
    const out = buildCandidateContent(session, { mean: 0.8, taskSuccess: 0.9, reusable: 0.7, evidence: 0.8 });
    expect(out).toContain("mean=0.8");
    expect(out).toContain("fix the migration");
    expect(out).toContain("npm run migrate");
    expect(out).not.toContain("abc.def");
    expect(out.length).toBeLessThanOrEqual(1800);
  });

  it("hashes api keys for memory owner id", () => {
    const a = memoryOwnerIdFromKey("sk-secret-123");
    const b = memoryOwnerIdFromKey("sk-secret-123");
    const c = memoryOwnerIdFromKey("sk-secret-456");
    expect(a).toMatch(/^key:[a-f0-9]{16}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("sk-secret");
  });
});
