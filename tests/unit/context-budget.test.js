import { describe, it, expect } from "vitest";
import { applyContextBudget, estimateTokens } from "../../open-sse/services/contextBudget.js";

const big = (n) => "x".repeat(n);

function toolMsg(text) {
  return { role: "tool", tool_call_id: "t1", content: text };
}

describe("contextBudget", () => {
  it("leaves small bodies untouched", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const r = applyContextBudget(body, { budgetTokens: 100000 });
    expect(r.applied).toBe(false);
    expect(r.folded).toBe(0);
    expect(r.after).toBe(r.before);
  });

  it("folds old tool results and keeps the newest N verbatim", () => {
    const messages = [
      { role: "user", content: "do work" },
      toolMsg(big(4000)),       // old → folded
      toolMsg(big(4000)),       // old → folded
      toolMsg(big(4000)),       // newest → kept
    ];
    const body = { messages };
    const r = applyContextBudget(body, { budgetTokens: 100, keepToolResults: 1, foldCapChars: 100 });
    expect(r.applied).toBe(true);
    expect(r.folded).toBe(2);
    expect(messages[1].content.length).toBeLessThan(4000);
    expect(messages[2].content.length).toBeLessThan(4000);
    expect(messages[3].content.length).toBe(4000);
    expect(r.after).toBeLessThan(r.before);
  });

  it("keeps tool_call/tool_result pairing (never removes messages)", () => {
    const messages = [
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: "{}" } }] },
      toolMsg(big(4000)),
      { role: "assistant", content: null, tool_calls: [{ id: "t2", type: "function", function: { name: "f", arguments: "{}" } }] },
      toolMsg(big(4000)),
    ];
    const body = { messages };
    applyContextBudget(body, { budgetTokens: 100, keepToolResults: 1, foldCapChars: 100 });
    expect(messages).toHaveLength(4);
    expect(messages[0].tool_calls[0].id).toBe("t1");
    expect(messages[2].tool_calls[0].id).toBe("t2");
  });

  it("folds claude-style tool_result content blocks", () => {
    const messages = [
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: big(3000) }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "b", content: big(3000) }] },
    ];
    const body = { messages };
    const r = applyContextBudget(body, { budgetTokens: 100, keepToolResults: 1, foldCapChars: 50 });
    expect(r.applied).toBe(true);
    expect(r.folded).toBe(1);
    expect(messages[0].content[0].content.length).toBeLessThan(3000);
    expect(messages[1].content[0].content.length).toBe(3000);
  });

  it("folds openai-responses function_call_output items", () => {
    const body = {
      input: [
        { type: "function_call_output", call_id: "c1", output: big(3000) },
        { type: "function_call_output", call_id: "c2", output: big(3000) },
      ],
    };
    const r = applyContextBudget(body, { budgetTokens: 10, keepToolResults: 1, foldCapChars: 50 });
    expect(r.folded).toBe(1);
    expect(body.input[0].output.length).toBeLessThan(3000);
    expect(body.input[1].output.length).toBe(3000);
  });

  it("estimates tokens from body size", () => {
    expect(estimateTokens({ messages: [{ role: "user", content: "x".repeat(400) }] })).toBeGreaterThan(90);
    expect(estimateTokens(null)).toBe(0);
  });

  it("does nothing when there are no tool results", () => {
    const body = { messages: [{ role: "user", content: big(8000) }, { role: "assistant", content: big(8000) }] };
    const r = applyContextBudget(body, { budgetTokens: 10 });
    expect(r.applied).toBe(false);
    expect(r.folded).toBe(0);
  });
});
