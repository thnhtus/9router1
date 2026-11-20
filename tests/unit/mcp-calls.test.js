// MCP tool-call counting from model output (open-sse/utils/mcpCalls.js).
import { describe, it, expect } from "vitest";
import { parseMcpName, collectMcpCalls } from "../../open-sse/utils/mcpCalls.js";

const count = (out) => Object.fromEntries([...out.entries()]);

describe("parseMcpName", () => {
  it("splits server and tool", () => {
    expect(parseMcpName("mcp__exa__web_search")).toEqual({ server: "exa", tool: "web_search" });
  });
  it("proxy-only name has an empty tool", () => {
    expect(parseMcpName("mcp__clickup")).toEqual({ server: "clickup", tool: "" });
  });
  it("ignores non-MCP names", () => {
    expect(parseMcpName("read")).toBeNull();
    expect(parseMcpName(undefined)).toBeNull();
  });
});

describe("collectMcpCalls", () => {
  it("counts an OpenAI streamed tool call once across repeated id deltas", () => {
    const seen = new Set();
    const out = new Map();
    collectMcpCalls({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "mcp__exa__web_search" } }] } }] }, seen, out);
    collectMcpCalls({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { arguments: "{\"q\"" } }] } }] }, seen, out);
    expect(count(out)).toEqual({ "exa\nweb_search": 1 });
  });

  it("counts Claude tool_use blocks", () => {
    const out = new Map();
    collectMcpCalls({ type: "content_block_start", content_block: { type: "tool_use", id: "t1", name: "mcp__github__list_repos" } }, new Set(), out);
    expect(count(out)).toEqual({ "github\nlist_repos": 1 });
  });

  it("does not count argument text that mentions an MCP name", () => {
    const out = new Map();
    collectMcpCalls({ type: "tool_use", id: "t2", name: "read", input: { path: "mcp__exa__x" } }, new Set(), out);
    expect(out.size).toBe(0);
  });

  it("counts distinct calls to the same tool separately", () => {
    const seen = new Set();
    const out = new Map();
    collectMcpCalls({ tool_calls: [{ id: "a", function: { name: "mcp__exa__web_search" } }] }, seen, out);
    collectMcpCalls({ tool_calls: [{ id: "b", function: { name: "mcp__exa__web_search" } }] }, seen, out);
    expect(count(out)).toEqual({ "exa\nweb_search": 2 });
  });
});
