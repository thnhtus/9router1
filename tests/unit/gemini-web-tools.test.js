import { describe, it, expect } from "vitest";
import { prepareToolMessages, serializeToolsToPrompt, parseToolCallsFromText, getToolNonce } from "../../open-sse/translator/webTools.js";
import { buildToolModeResponse } from "../../open-sse/executors/chatgptWebTools.js";

const tools = [
  { type: "function", function: { name: "get_weather", description: "Weather", parameters: { type: "object" } } },
];

function nonceFromPrompt() {
  const { effectiveMessages } = prepareToolMessages({ tools }, [{ role: "user", content: "x" }]);
  return /"_nonce": "([a-z0-9]+)"/.exec(effectiveMessages.at(-1).content)[1];
}

function completion(content) {
  return new Response(
    JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }),
    { status: 200 }
  );
}

describe("gemini-web tool emulation", () => {
  it("injects the tool contract into the prompt and returns the tool list", () => {
    const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages({ tools }, [
      { role: "user", content: "weather in Tokyo?" },
    ]);
    expect(hasTools).toBe(true);
    expect(requestedTools).toBe(tools);
    expect(effectiveMessages.at(-1).role).toBe("system");
    expect(effectiveMessages.at(-1).content).toContain("get_weather");
  });

  it("turns a <tool> reply into tool_calls with finish_reason tool_calls", async () => {
    const n = nonceFromPrompt();
    const res = await buildToolModeResponse(
      completion(`<tool>{"name":"get_weather","arguments":{"city":"Tokyo"},"_nonce":"${n}"}</tool>`),
      tools,
      false,
      { idSeed: "gweb" }
    );
    const json = await res.json();
    expect(json.choices[0].finish_reason).toBe("tool_calls");
    expect(json.choices[0].message.tool_calls[0].function).toEqual({
      name: "get_weather",
      arguments: '{"city":"Tokyo"}',
    });
  });

  it("accepts bare JSON only when it echoes the correct nonce", async () => {
    const n = nonceFromPrompt();
    const ok = await buildToolModeResponse(
      completion(`{"name":"get_weather","arguments":{"city":"Tokyo"},"_nonce":"${n}"}`),
      tools,
      false,
      { idSeed: "gweb" }
    );
    const okJson = await ok.json();
    expect(okJson.choices[0].finish_reason).toBe("tool_calls");
    expect(okJson.choices[0].message.tool_calls).toHaveLength(1);

    const bad = await buildToolModeResponse(
      completion('{"name":"get_weather","arguments":{},"_nonce":"WRONG"}'),
      tools,
      false,
      { idSeed: "gweb" }
    );
    const badJson = await bad.json();
    expect(badJson.choices[0].finish_reason).toBe("stop");
    expect(badJson.choices[0].message.tool_calls).toBeUndefined();
  });


  it("accepts a whole-reply bare JSON call even without a nonce", async () => {
    const res = await buildToolModeResponse(
      completion('{"name":"get_weather","arguments":{"city":"Tokyo"}}'),
      tools,
      false,
      { idSeed: "gweb" }
    );
    const json = await res.json();
    expect(json.choices[0].finish_reason).toBe("tool_calls");
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
  });


  it("rejects bare JSON missing the nonce even when the reply mentions _nonce", async () => {
    const res = await buildToolModeResponse(
      completion('I will not echo the _nonce.\n{"name":"get_weather","arguments":{"city":"Tokyo"}}'),
      tools,
      false,
      { idSeed: "gweb" }
    );
    const json = await res.json();
    expect(json.choices[0].finish_reason).toBe("stop");
    expect(json.choices[0].message.tool_calls).toBeUndefined();
  });

  it("does not emit the same call twice when the envelope also matches bare JSON", async () => {
    const n = nonceFromPrompt();
    const res = await buildToolModeResponse(
      completion(`<tool>{"name":"get_weather","arguments":{"city":"Tokyo"},"_nonce":"${n}"}</tool>`),
      tools,
      false,
      { idSeed: "gweb" }
    );
    const json = await res.json();
    expect(json.choices[0].message.tool_calls).toHaveLength(1);
  });

  it("replays a tool completion as an SSE stream with per-call index", async () => {
    const n = nonceFromPrompt();
    const res = await buildToolModeResponse(
      completion(`<tool>{"name":"get_weather","arguments":{"city":"Tokyo"},"_nonce":"${n}"}</tool>`),
      tools,
      true,
      { idSeed: "gweb", cid: "chatcmpl-test", created: 1, model: "gemini-web-auto" }
    );
    const text = await res.text();
    expect(text).toContain('"tool_calls":[{"index":0');
    expect(text).toContain('"finish_reason":"tool_calls"');
    expect(text).toContain("data: [DONE]");
  });
});

import { flattenToolHistory, buildGeminiPrompt, isGeminiRefusal } from "../../open-sse/executors/gemini-web.js";

describe("gemini-web tool history", () => {
  it("keeps tool results visible to the model in the flattened prompt", () => {
    const flat = flattenToolHistory([
      { role: "user", content: "Read /tmp/a.txt" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"/tmp/a.txt"}' } }] },
      { role: "tool", tool_call_id: "c1", content: "hello world" },
      { role: "user", content: "What does it say?" },
    ]);
    const prompt = buildGeminiPrompt(flat);
    expect(prompt).toContain("Tool result (read_file): hello world");
    expect(prompt).toContain('<tool>{"name": "read_file", "arguments": {"path":"/tmp/a.txt"}}</tool>');
  });
});

describe("serializeToolsToPrompt raw-field dialect", () => {
  const BashTool = {
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command",
      parameters: {
        type: "object",
        properties: { command: { type: "string" }, timeout: { type: "integer" } },
      },
    },
  };
  // Nonces are keyed by the tools array identity, so reuse one array.
  const tools = [BashTool];

  it("emits a raw-field contract without JSON instructions", () => {
    const prompt = serializeToolsToPrompt(tools, { dialect: "raw" });
    expect(prompt).toContain('nonce="');
    expect(prompt).toContain("<command>");
    expect(prompt).toContain("RAW TEXT, NO JSON");
    expect(prompt).not.toContain("_nonce\": \"");
  });

  it("parses a raw block with multiline shell command verbatim", () => {
    const nonce = getToolNonce(tools);
    const text = `<tool name="bash" nonce="${nonce}">\n<command>cd /x\n && grep -E "error|fail" log\n && echo "done"</command>\n<timeout>600</timeout>\n</tool>`;
    const r = parseToolCallsFromText(text, "raw", tools);
    expect(r.toolCalls?.length).toBe(1);
    const args = JSON.parse(r.toolCalls[0].function.arguments);
    expect(args.command).toBe('cd /x\n && grep -E "error|fail" log\n && echo "done"');
    expect(r.content).toBe("");
  });

  it("rejects a raw block with the wrong nonce", () => {
    const text = '<tool name="bash" nonce="wrong">\n<command>rm -rf ~</command>\n</tool>';
    const r = parseToolCallsFromText(text, "raw", tools);
    expect(r.toolCalls).toBeNull();
  });

  it("rejects a raw block naming an unrequested tool", () => {
    const nonce = getToolNonce(tools);
    const text = `<tool name="delete_everything" nonce="${nonce}">\n<command>rm -rf /</command>\n</tool>`;
    const r = parseToolCallsFromText(text, "raw", tools);
    expect(r.toolCalls).toBeNull();
  });

  it("does not leak a rejected raw block into content", () => {
    const text = '<tool name="bash" nonce="wrong">\n<command>rm -rf ~</command>\n</tool>\nhere is prose';
    const r = parseToolCallsFromText(text, "raw", tools);
    expect(r.toolCalls).toBeNull();
    expect(r.content).not.toContain("<tool");
    expect(r.content).toContain("here is prose");
    expect(r.invalidToolCall).toBe(true);
    expect(r.hadToolBlock).toBe(true);
  });

  it("strips an incomplete trailing raw block and flags incomplete", () => {
    const nonce = getToolNonce(tools);
    const text = `<tool name="bash" nonce="${nonce}">\n<command>cd /x`;
    const r = parseToolCallsFromText(text, "raw", tools);
    expect(r.toolCalls).toBeNull();
    expect(r.content).toBe("");
    expect(r.incomplete).toBe(true);
    expect(r.invalidToolCall).toBe(true);
  });

  it("strips rejected envelopes even when another call is accepted", () => {
    const nonce = getToolNonce(tools);
    const text =
      `<tool name="bash" nonce="${nonce}">\n<command>ls</command>\n</tool>\n` +
      `<tool name="bash" nonce="wrong">\n<command>rm -rf /</command>\n</tool>`;
    const r = parseToolCallsFromText(text, "raw", tools);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.content).not.toContain("<tool");
    expect(r.content).not.toContain("rm -rf");
  });
});

describe("isGeminiRefusal", () => {
  it("matches Gemini's canned transient refusals", () => {
    expect(isGeminiRefusal("I'm having a hard time fulfilling your request. Can I help you with something else instead?")).toBe(true);
    expect(isGeminiRefusal("I encountered an error doing what you asked. Could you try again?")).toBe(true);
  });
  it("ignores normal answers and long text quoting the phrase", () => {
    expect(isGeminiRefusal("Branch: master")).toBe(false);
    expect(isGeminiRefusal("x".repeat(400) + " I'm having a hard time fulfilling your request")).toBe(false);
    expect(isGeminiRefusal(null)).toBe(false);
  });
});
