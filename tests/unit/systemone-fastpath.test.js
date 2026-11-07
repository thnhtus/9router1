import { describe, it, expect } from "vitest";
import { isTrivialPrompt } from "@/sse/services/systemoneRouter.js";

describe("isTrivialPrompt", () => {
  it("accepts greetings and bare arithmetic", () => {
    for (const s of ["hi", "Hello!", "chào", "2+2", " (3 * 4) = ? ", "ok"]) expect(isTrivialPrompt(s)).toBe(true);
  });
  it("rejects real tasks, follow-ups and long input", () => {
    for (const s of ["fix bug", "Giải thích closure", "hi, refactor the auth module", "[earlier] x\n[current] ok", "1".repeat(80), "", null])
      expect(isTrivialPrompt(s)).toBe(false);
  });
});
