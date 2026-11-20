import { describe, it, expect } from "vitest";
import { parseToolCallsFromText, getToolNonce } from "../../open-sse/translator/webTools.js";

const tools = [{ type: "function", function: { name: "bash", parameters: { type: "object" } } }];

describe("gemini-web bare JSON tool call", () => {
  it("parses a multi-line shell command with raw newlines inside the string", () => {
    const nonce = getToolNonce(tools);
    const cmd = "cd /x\n && git status --short && echo ===\n && pnpm build";
    const reply = `{"name": "bash", "arguments": {"command":"${cmd}","timeout":600}, "_nonce": "${nonce}"}`;
    const r = parseToolCallsFromText(reply, "bash", tools);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].function.name).toBe("bash");
    const args = JSON.parse(r.toolCalls[0].function.arguments);
    expect(args.timeout).toBe(600);
    expect(args.command).toContain("git status");
  });

  it("strips the call from surrounding content", () => {
    const nonce = getToolNonce(tools);
    const reply = `intro {"name": "bash", "arguments": {"command":"ls"}, "_nonce": "${nonce}"} outro`;
    expect(parseToolCallsFromText(reply, "bash", tools).content).toBe("intro  outro");
  });
});
