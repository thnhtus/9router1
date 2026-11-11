import { describe, it, expect } from "vitest";
import { continueOnLength, CONTINUE_PROMPT } from "../../open-sse/services/lengthContinuation.js";

const enc = new TextEncoder();
const frame = (delta, finish = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const sse = (frames) => new Response(new ReadableStream({
  start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); },
}), { status: 200, headers: { "content-type": "text/event-stream" } });

async function collect(res) {
  const raw = await res.text();
  const objs = raw.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));
  return {
    raw,
    text: objs.map((o) => o.choices[0].delta.content || "").join(""),
    finishes: objs.map((o) => o.choices[0].finish_reason).filter(Boolean),
  };
}

const body = { messages: [{ role: "user", content: "write long" }], stream: true };

describe("continueOnLength", () => {
  it("splices the next member's continuation into one stream", async () => {
    const calls = [];
    const first = sse([frame({ content: "Hello " }), frame({}, "length"), "data: [DONE]\n\n"]);
    const out = continueOnLength(first, {
      body, models: ["a", "b"], from: 0,
      handleSingleModel: async (b, m) => { calls.push({ b, m }); return sse([frame({ content: "world" }), frame({}, "stop"), "data: [DONE]\n\n"]); },
    });
    const r = await collect(out);
    expect(r.text).toBe("Hello world");
    expect(r.finishes).toEqual(["stop"]);
    expect(r.raw.match(/\[DONE\]/g)).toHaveLength(1);
    expect(calls[0].m).toBe("b");
    expect(calls[0].b.messages.slice(-2)).toEqual([{ role: "assistant", content: "Hello " }, { role: "user", content: CONTINUE_PROMPT }]);
  });

  it("trims a restarted word at the seam", async () => {
    const first = sse([frame({ content: "thirteen, fourte" }), frame({}, "length")]);
    const r = await collect(continueOnLength(first, { body, models: ["a", "b"], from: 0, handleSingleModel: async () => sse([frame({ content: "fourteen, fifteen" }), frame({}, "stop")]) }));
    expect(r.text).toBe("thirteen, fourteen, fifteen");
  });

  it("stops after maxHops and keeps finish_reason length", async () => {
    let n = 0;
    const leg = () => sse([frame({ content: `p${n++}` }), frame({}, "length"), "data: [DONE]\n\n"]);
    const out = continueOnLength(leg(), { body, models: ["a", "b"], from: 0, maxHops: 2, handleSingleModel: async () => leg() });
    const r = await collect(out);
    expect(r.text).toBe("p0p1p2");
    expect(r.finishes).toEqual(["length"]);
  });

  it("does not continue a cut-off tool call", async () => {
    let called = false;
    const first = sse([frame({ content: "x", tool_calls: [{ index: 0, function: { name: "f", arguments: "{" } }] }), frame({}, "length")]);
    const r = await collect(continueOnLength(first, { body, models: ["a", "b"], from: 0, handleSingleModel: async () => { called = true; } }));
    expect(called).toBe(false);
    expect(r.finishes).toEqual(["length"]);
  });

  it("ends with length + [DONE] when the continuation fails", async () => {
    const first = sse([frame({ content: "Hi" }), frame({}, "length"), "data: [DONE]\n\n"]);
    const r = await collect(continueOnLength(first, { body, models: ["a", "b"], from: 0, handleSingleModel: async () => new Response("x", { status: 503 }) }));
    expect(r.text).toBe("Hi");
    expect(r.finishes).toEqual(["length"]);
    expect(r.raw.match(/\[DONE\]/g)).toHaveLength(1);
  });
});

import { continueJsonOnLength, addUsage, joinSeam } from "../../open-sse/services/lengthContinuation.js";

const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

describe("usage + other formats", () => {
  it("sums usage of cut legs into the final usage frame", async () => {
    const first = sse([frame({ content: "a" }), `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`]);
    const second = sse([frame({ content: "b" }), `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } })}\n\n`]);
    const r = await collect(continueOnLength(first, { body, models: ["a", "b"], from: 0, handleSingleModel: async () => second }));
    expect(r.text).toBe("ab");
    expect(r.raw).toContain('"completion_tokens":8');
    expect(r.raw).toContain('"prompt_tokens":22');
  });

  it("splices a Claude stream", async () => {
    const leg1 = sse([ev("message_start", { message: { usage: { input_tokens: 4, output_tokens: 0 } } }), ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }), ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hi " } }), ev("message_delta", { delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 2 } }), ev("message_stop", {})]);
    const leg2 = sse([ev("message_start", { message: { usage: { input_tokens: 9, output_tokens: 0 } } }), ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }), ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "there" } }), ev("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }), ev("message_stop", {})]);
    const r = await (await continueOnLength(leg1, { body, models: ["a", "b"], from: 0, handleSingleModel: async () => leg2 })).text();
    const text = [...r.matchAll(/"text_delta","text":"([^"]*)"/g)].map((m) => m[1]).join("");
    expect(text).toBe("Hi there");
    expect(r.match(/event: message_stop/g)).toHaveLength(1);
    expect(r).toContain('"stop_reason":"end_turn"');
  });

  it("splices a Responses stream", async () => {
    const leg1 = sse([ev("response.output_text.delta", { delta: "Yo " }), ev("response.incomplete", { response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 3, output_tokens: 2 } } })]);
    const leg2 = sse([ev("response.output_text.delta", { delta: "you" }), ev("response.completed", { response: { status: "completed", usage: { input_tokens: 5, output_tokens: 1 } } })]);
    const r = await (await continueOnLength(leg1, { body, models: ["a", "b"], from: 0, handleSingleModel: async () => leg2 })).text();
    const text = [...r.matchAll(/"delta":"([^"]*)"/g)].map((m) => m[1]).join("");
    expect(text).toBe("Yo you");
    expect(r).toContain('"output_tokens":3');
    expect(r).toContain("response.completed");
  });

  it("joins non-stream OpenAI JSON legs and sums usage", async () => {
    const first = json({ choices: [{ message: { role: "assistant", content: "Hello " }, finish_reason: "length" }], usage: { prompt_tokens: 2, completion_tokens: 4 } });
    const out = await continueJsonOnLength(first, { body: { messages: body.messages }, models: ["a", "b"], from: 0, handleSingleModel: async () => json({ choices: [{ message: { content: "world" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } }) });
    const j = await out.json();
    expect(j.choices[0].message.content).toBe("Hello world");
    expect(j.choices[0].finish_reason).toBe("stop");
    expect(j.usage).toEqual({ prompt_tokens: 5, completion_tokens: 6 });
  });

  it("passes complete non-stream JSON through untouched", async () => {
    const res = json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    expect(await continueJsonOnLength(res, { body, models: ["a"], from: 0, handleSingleModel: async () => { throw new Error("no"); } })).toBe(res);
  });

  it("addUsage sums only numeric token keys", () => {
    expect(addUsage({ prompt_tokens: 1 }, { prompt_tokens: 2, completion_tokens: 3 })).toEqual({ prompt_tokens: 3, completion_tokens: 3 });
  });

  it("folds leading seam newlines cleanly", () => {
    expect(joinSeam("twenty,", "\n\ntwenty-one")).toBe("twenty, twenty-one");
    expect(joinSeam("twenty, ", "\n\ntwenty-one")).toBe("twenty, twenty-one");
  });

  it("joins non-stream Claude JSON legs and sums usage", async () => {
    const first = json({ id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "One, " }], stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 4 } });
    const out = await continueJsonOnLength(first, {
      body: { messages: body.messages }, models: ["a", "b"], from: 0,
      handleSingleModel: async () => json({ id: "msg_2", type: "message", role: "assistant", content: [{ type: "text", text: "two" }], stop_reason: "end_turn", usage: { input_tokens: 15, output_tokens: 2 } }),
    });
    const j = await out.json();
    expect(j.content).toEqual([{ type: "text", text: "One, two" }]);
    expect(j.stop_reason).toBe("end_turn");
    expect(j.usage).toEqual({ input_tokens: 25, output_tokens: 6 });
  });

  it("joins non-stream Responses JSON legs and clears incomplete_details", async () => {
    const first = json({
      id: "resp_1", object: "response", status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Alpha " }] }],
      usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
    });
    const out = await continueJsonOnLength(first, {
      body: { input: "list" }, models: ["a", "b"], from: 0,
      handleSingleModel: async () => json({
        id: "resp_2", object: "response", status: "completed",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "\nBeta" }] }],
        usage: { input_tokens: 12, output_tokens: 2, total_tokens: 14 },
      }),
    });
    const j = await out.json();
    expect(j.status).toBe("completed");
    expect(j.incomplete_details).toBeUndefined();
    expect(j.output[0].content[0].text).toBe("Alpha Beta");
    expect(j.usage).toEqual({ input_tokens: 20, output_tokens: 5, total_tokens: 25 });
  });

  it("remaps Responses output_index and sequence_number across spliced SSE legs", async () => {
    const leg1 = sse([
      ev("response.created", { sequence_number: 0, response: { id: "r1", status: "in_progress" } }),
      ev("response.output_item.added", { sequence_number: 1, output_index: 0, item: { id: "m1", type: "message" } }),
      ev("response.output_text.delta", { sequence_number: 2, output_index: 0, delta: "A" }),
      ev("response.output_item.done", { sequence_number: 3, output_index: 0, item: { id: "m1", type: "message", content: [{ type: "output_text", text: "A" }] } }),
      ev("response.incomplete", { sequence_number: 4, response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [], usage: { input_tokens: 5, output_tokens: 1 } } }),
    ]);
    const leg2 = sse([
      ev("response.created", { sequence_number: 0, response: { id: "r2", status: "in_progress" } }),
      ev("response.output_item.added", { sequence_number: 1, output_index: 0, item: { id: "m2", type: "message" } }),
      ev("response.output_text.delta", { sequence_number: 2, output_index: 0, delta: "B" }),
      ev("response.output_item.done", { sequence_number: 3, output_index: 0, item: { id: "m2", type: "message", content: [{ type: "output_text", text: "B" }] } }),
      ev("response.completed", { sequence_number: 4, response: { status: "completed", output: [], usage: { input_tokens: 7, output_tokens: 1 } } }),
    ]);
    const raw = await (await continueOnLength(leg1, { body: { input: "hi" }, models: ["a", "b"], from: 0, handleSingleModel: async () => leg2 })).text();
    const objs = raw.split("\n").filter((l) => l.startsWith("data: {")).map((l) => JSON.parse(l.slice(6)));
    expect(objs.filter((o) => o.type === "response.created")).toHaveLength(1);
    expect(objs.map((o) => o.sequence_number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(objs.filter((o) => o.type === "response.output_item.added").map((o) => o.output_index)).toEqual([0, 1]);
    const done = objs.find((o) => o.type === "response.completed");
    expect(done.response.output.map((i) => i.id)).toEqual(["m1", "m2"]);
    expect(done.response.usage).toEqual({ input_tokens: 12, output_tokens: 2 });
  });
});
