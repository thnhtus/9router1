import { describe, it, expect } from "vitest";
import { shouldAutoApprove } from "@/lib/memory/evaluate.js";

describe("memory auto-approve gate", () => {
  it("approves only when opted in and both scores clear the strong gates", () => {
    expect(shouldAutoApprove({ enabled: true, taskSuccess: 0.95, mean: 0.9 })).toBe(true);
    expect(shouldAutoApprove({ enabled: false, taskSuccess: 1, mean: 1 })).toBe(false);
    expect(shouldAutoApprove({ enabled: true, taskSuccess: 0.8, mean: 0.9 })).toBe(false);
    expect(shouldAutoApprove({ enabled: true, taskSuccess: 0.95, mean: 0.8 })).toBe(false);
    expect(shouldAutoApprove({ enabled: true, taskSuccess: null, mean: 0.9 })).toBe(false);
  });
});
