// Auto-continue a combo answer that hit the output cap (length / max_tokens / max_output_tokens).
// The truncated text is handed to the NEXT combo member as an assistant turn plus a
// "continue" prompt, and its output is spliced into the client's response, so one long
// answer is split across members instead of dying on one model's output limit.
// Supports OpenAI chat, Claude (/v1/messages), and OpenAI Responses (/v1/responses),
// both streaming (SSE) and non-streaming (JSON). Cut-off tool calls pass through.
// ponytail: usage of cut legs is summed into the client-visible usage (top-level token
// counts only; detail objects come from the final leg). 9Router's per-leg logging is separate.
import { parseSSELine } from "../utils/streamHelpers.js";

const MAX_HOPS = Math.max(0, parseInt(process.env.COMBO_CONTINUE_MAX_HOPS ?? "2", 10) || 0);
export const CONTINUE_PROMPT = "Your previous reply was cut off by the output limit. Continue exactly where it stopped. Do not repeat or summarize what was already written.";
const USAGE_KEYS = [
  "prompt_tokens", "completion_tokens", "total_tokens",
  "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens",
];

// Length of the longest prefix of `next` that `prev` already ends with (models often
// restart the cut-off word: "fourte" + "fourteen"). Min 4 chars to avoid eating real text.
export function overlap(prev, next) {
  for (let k = Math.min(prev.length, next.length, 200); k >= 4; k--) {
    if (prev.endsWith(next.slice(0, k))) return k;
  }
  return 0;
}

// Continuations often open with blank lines; fold them into one space so the seam reads as one answer.
const stripSeamNewlines = (prev, s) => s.replace(/^\n+/, /\s$/.test(prev) || !prev ? "" : " ");

export function joinSeam(prev, next) {
  const s = stripSeamNewlines(prev, next);
  return prev + s.slice(overlap(prev, s));
}

// Sum token counts of two usage objects; `b` supplies every other field.
export function addUsage(a, b) {
  if (!a || typeof a !== "object") return b;
  if (!b || typeof b !== "object") return a;
  const out = { ...b };
  for (const k of USAGE_KEYS) {
    if (typeof a[k] === "number" || typeof b[k] === "number") out[k] = (a[k] || 0) + (b[k] || 0);
  }
  // A leg may omit total_tokens; recompute so the sum stays consistent.
  if (typeof out.total_tokens === "number") {
    const inT = out.prompt_tokens ?? out.input_tokens, outT = out.completion_tokens ?? out.output_tokens;
    if (typeof inT === "number" && typeof outT === "number") out.total_tokens = inT + outT;
  }
  return out;
}

function buildContBody(body, text, stream) {
  if (Array.isArray(body.messages)) {
    return {
      ...body,
      ...(stream !== undefined ? { stream } : {}),
      messages: [...body.messages, { role: "assistant", content: text }, { role: "user", content: CONTINUE_PROMPT }],
    };
  }
  const prev = Array.isArray(body.input)
    ? body.input
    : [{ type: "message", role: "user", content: [{ type: "input_text", text: String(body.input) }] }];
  return {
    ...body,
    ...(stream !== undefined ? { stream } : {}),
    input: [
      ...prev,
      { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: CONTINUE_PROMPT }] },
    ],
  };
}

const hasContinuationInput = (body) => Array.isArray(body?.messages) || body?.input !== undefined;

export function continueOnLength(response, { body, models, from, handleSingleModel, log, maxHops = MAX_HOPS }) {
  if (!response?.body || maxHops <= 0 || !hasContinuationInput(body) || !models?.length) return response;
  const enc = new TextEncoder();
  let reader = response.body.getReader();
  let dec = new TextDecoder();
  let buf = "", text = "", hasTools = false, cut = false, hops = 0, seam = false;
  let carried = null, legUsage = null, pendingEvent = null, dropped = false, lastFinish = null;
  let maxIdx = -1, idxOffset = 0, seq = -1, completedItems = [], legItemsStart = 0;

  const formatData = (obj) => (pendingEvent ? `${pendingEvent}\n` : "") + `data: ${JSON.stringify(obj)}`;
  const trimSeam = (s) => {
    if (!seam || !s) return s;
    s = stripSeamNewlines(text, s);
    if (!s.trim()) return s; // whitespace-only chunk: keep waiting for real text
    seam = false;
    const k = overlap(text, s);
    return k ? s.slice(k) : s;
  };

  const handleOpenAI = (line, obj) => {
    if (cut) { if (obj?.usage) carried = addUsage(carried, obj.usage); return null; }
    if (obj?.done) {
      if (!carried) return line;
      const trailer = `data: ${JSON.stringify({ id: "chatcmpl-cont", object: "chat.completion.chunk", choices: [], usage: carried })}\n\n`;
      carried = null;
      return trailer + line;
    }
    let dirty = false;
    if (carried && obj?.usage && !obj.done) {
      obj.usage = addUsage(carried, obj.usage);
      carried = null;
      dirty = true;
      if (!Array.isArray(obj.choices)) return `data: ${JSON.stringify(obj)}`;
    }
    if (!obj || !Array.isArray(obj.choices)) return line;
    for (const c of obj.choices) {
      const d = c.delta || {};
      if (typeof d.content === "string" && d.content) {
        const trimmed = trimSeam(d.content);
        if (trimmed !== d.content) { d.content = trimmed; dirty = true; }
        text += d.content;
      }
      if (d.tool_calls?.length) hasTools = true;
    }
    const choice = obj.choices[0];
    if (choice?.finish_reason !== "length" || hasTools || !text || hops >= maxHops) {
      return dirty ? `data: ${JSON.stringify(obj)}` : line;
    }
    lastFinish = { fmt: "openai", obj };
    cut = true;
    choice.finish_reason = null;
    if (obj.usage) { carried = addUsage(carried, obj.usage); delete obj.usage; }
    return `data: ${JSON.stringify(obj)}\n`;
  };

  const handleClaude = (obj) => {
    if (cut) return null;
    if (obj.type === "message_start") {
      const u = obj.message?.usage;
      if (u) legUsage = { ...u, output_tokens: 0 };
      return hops > 0 ? null : formatData(obj);
    }
    if (obj.type === "content_block_start" || obj.type === "content_block_delta" || obj.type === "content_block_stop") {
      if (typeof obj.index === "number") { obj.index += idxOffset; maxIdx = Math.max(maxIdx, obj.index); }
      if (obj.type === "content_block_start" && obj.content_block?.type === "tool_use") hasTools = true;
      if (obj.type === "content_block_delta" && obj.delta?.type === "text_delta" && typeof obj.delta.text === "string") {
        obj.delta.text = trimSeam(obj.delta.text);
        text += obj.delta.text;
      }
      return formatData(obj);
    }
    if (obj.type === "message_delta") {
      const mergedLeg = legUsage ? { ...legUsage, ...obj.usage } : obj.usage;
      if (obj.delta?.stop_reason === "max_tokens" && !hasTools && text && hops < maxHops) {
        carried = addUsage(carried, mergedLeg);
        lastFinish = { fmt: "claude", event: pendingEvent, obj };
        cut = true;
        return null;
      }
      if (carried || mergedLeg) { obj.usage = addUsage(carried, mergedLeg); carried = null; }
      return formatData(obj);
    }
    return formatData(obj);
  };

  const handleResponses = (obj) => {
    if (cut) return null;
    const emit = (o) => {
      if (typeof o.sequence_number === "number") o.sequence_number = ++seq;
      return formatData(o);
    };
    if (obj.type === "response.created" || obj.type === "response.in_progress") return hops > 0 ? null : emit(obj);
    if (typeof obj.output_index === "number") { obj.output_index += idxOffset; maxIdx = Math.max(maxIdx, obj.output_index); }
    if ((obj.type === "response.output_item.added" || obj.type === "response.output_item.done") &&
        (obj.item?.type === "function_call" || obj.item?.type === "custom_tool_call")) {
      hasTools = true;
    }
    if (obj.type === "response.output_text.delta" && typeof obj.delta === "string") {
      obj.delta = trimSeam(obj.delta);
      text += obj.delta;
    }
    if (obj.type === "response.output_item.done" && obj.item) completedItems.push(obj.item);
    if (obj.type === "response.incomplete" && obj.response?.incomplete_details?.reason === "max_output_tokens" && !hasTools && text && hops < maxHops) {
      carried = addUsage(carried, obj.response?.usage);
      if (!completedItems.length && Array.isArray(obj.response?.output)) completedItems = [...obj.response.output];
      lastFinish = { fmt: "responses", event: pendingEvent, obj };
      cut = true;
      return null;
    }
    if ((obj.type === "response.completed" || obj.type === "response.incomplete") && obj.response) {
      if (carried) { obj.response.usage = addUsage(carried, obj.response.usage || {}); carried = null; }
      if (hops > 0 && completedItems.length && Array.isArray(obj.response.output)) {
        const items = completedItems.length === legItemsStart ? [...completedItems, ...obj.response.output] : completedItems;
        obj.response.output = items;
      }
    }
    return emit(obj);
  };

  const processLine = (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("event:")) { pendingEvent = line; return null; }
    if (line === "") {
      if (dropped) { dropped = false; return null; }
      return "";
    }
    const obj = line.startsWith("data:") ? parseSSELine(line) : null;
    if (!obj) { pendingEvent = null; return cut ? null : line; }
    let out;
    if (!obj.done && typeof obj.type === "string" && !Array.isArray(obj.choices)) {
      out = obj.type.startsWith("response.") ? handleResponses(obj) : handleClaude(obj);
    } else {
      out = handleOpenAI(line, obj);
    }
    pendingEvent = null;
    if (out === null) { dropped = true; return null; }
    dropped = false;
    return out;
  };

  const emitFailedTail = (ctrl) => {
    if (lastFinish?.fmt === "claude") {
      if (carried) lastFinish.obj.usage = carried;
      const ev = lastFinish.event ? `${lastFinish.event}\n` : "event: message_delta\n";
      ctrl.enqueue(enc.encode(`${ev}data: ${JSON.stringify(lastFinish.obj)}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`));
    } else if (lastFinish?.fmt === "responses") {
      if (typeof lastFinish.obj.sequence_number === "number") lastFinish.obj.sequence_number = ++seq;
      if (carried && lastFinish.obj.response) lastFinish.obj.response.usage = carried;
      if (completedItems.length && Array.isArray(lastFinish.obj.response?.output)) lastFinish.obj.response.output = completedItems;
      const ev = lastFinish.event ? `${lastFinish.event}\n` : "event: response.incomplete\n";
      ctrl.enqueue(enc.encode(`${ev}data: ${JSON.stringify(lastFinish.obj)}\n\n`));
    } else if (lastFinish?.obj) {
      lastFinish.obj.choices[0].finish_reason = "length";
      if (carried) lastFinish.obj.usage = carried;
      ctrl.enqueue(enc.encode(`data: ${JSON.stringify(lastFinish.obj)}\n\ndata: [DONE]\n\n`));
    }
  };

  const nextLeg = async () => {
    hops++;
    const model = models[(from + hops) % models.length];
    log?.info?.("COMBO", `finish_reason=length → continuing on ${model} (hop ${hops}/${maxHops}, ${text.length} chars so far)`);
    const contBody = buildContBody(body, text);
    const res = await Promise.resolve(handleSingleModel(contBody, model)).catch(() => null);
    const ct = res?.headers?.get?.("content-type") || "";
    if (!res?.ok || !res.body || !ct.includes("text/event-stream")) {
      log?.warn?.("COMBO", `continuation on ${model} failed (${res?.status ?? "error"}), ending with length`);
      res?.body?.cancel?.().catch(() => {});
      return false;
    }
    reader = res.body.getReader();
    dec = new TextDecoder();
    buf = "";
    cut = false;
    seam = true;
    legUsage = null;
    pendingEvent = null;
    dropped = false;
    idxOffset = maxIdx + 1;
    legItemsStart = completedItems.length;
    return true;
  };

  const stream = new ReadableStream({
    async pull(ctrl) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          const tail = buf ? processLine(buf) : null;
          buf = "";
          if (tail !== null) ctrl.enqueue(enc.encode(tail + "\n"));
          if (cut && (await nextLeg())) continue;
          if (cut) emitFailedTail(ctrl);
          ctrl.close();
          return;
        }
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        const out = lines.map(processLine).filter((l) => l !== null);
        if (out.length) { ctrl.enqueue(enc.encode(out.join("\n") + "\n")); return; }
      }
    },
    cancel(reason) { reader.cancel(reason).catch(() => {}); },
  });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function inspectJsonLeg(json) {
  if (!json || typeof json !== "object") return null;
  if (Array.isArray(json.choices) && json.choices[0]?.message) {
    const c = json.choices[0];
    const piece = typeof c.message.content === "string" ? c.message.content : "";
    return {
      fmt: "openai", piece, usage: json.usage,
      truncated: c.finish_reason === "length" && !c.message.tool_calls?.length && piece.length > 0,
    };
  }
  if (json.type === "message" && Array.isArray(json.content)) {
    const piece = json.content.filter((b) => b?.type === "text").map((b) => b.text || "").join("");
    const hasTools = json.content.some((b) => b?.type === "tool_use");
    return {
      fmt: "claude", piece, usage: json.usage,
      truncated: json.stop_reason === "max_tokens" && !hasTools && piece.length > 0,
    };
  }
  if (json.object === "response" && Array.isArray(json.output)) {
    const piece = json.output.flatMap((o) => (o?.type === "message" && Array.isArray(o.content)
      ? o.content.filter((c) => c?.type === "output_text" || c?.type === "text").map((c) => c.text || "")
      : [])).join("");
    const hasTools = json.output.some((o) => o?.type === "function_call" || o?.type === "custom_tool_call");
    const truncated = ((json.status === "incomplete" && json.incomplete_details?.reason === "max_output_tokens") || json.status === "length")
      && !hasTools && piece.length > 0;
    return { fmt: "responses", piece, usage: json.usage, truncated };
  }
  return null;
}

function mergeJsonResult(first, last, fmt, text, usage) {
  if (fmt === "openai") {
    const fc = first.choices[0];
    return {
      ...first,
      choices: [{ ...fc, message: { ...fc.message, content: text }, finish_reason: last.choices[0].finish_reason }],
      ...(usage ? { usage } : {}),
    };
  }
  if (fmt === "claude") {
    const nonText = first.content.filter((b) => b?.type !== "text");
    return { ...first, content: [...nonText, { type: "text", text }], stop_reason: last.stop_reason, ...(usage ? { usage } : {}) };
  }
  const nonMsg = first.output.filter((o) => o?.type !== "message");
  const msgOut = { type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] };
  const merged = { ...first, output: [...nonMsg, msgOut], status: last.status, ...(usage ? { usage } : {}) };
  if (last.incomplete_details) merged.incomplete_details = last.incomplete_details;
  else delete merged.incomplete_details;
  return merged;
}

// Non-stream counterpart (OpenAI chat, Claude, Responses JSON). Loops over legs and merges.
export async function continueJsonOnLength(response, { body, models, from, handleSingleModel, log, maxHops = MAX_HOPS }) {
  const ct = response?.headers?.get?.("content-type") || "";
  if (!ct.includes("application/json") || maxHops <= 0 || !hasContinuationInput(body) || !models?.length) return response;
  const first = await response.clone().json().catch(() => null);
  const firstLeg = inspectJsonLeg(first);
  if (!firstLeg?.truncated) return response;
  response.body?.cancel?.().catch(() => {});

  let json = first, leg = firstLeg, text = "", usage = null, hops = 0;
  for (;;) {
    text = hops ? joinSeam(text, leg.piece) : leg.piece;
    usage = addUsage(usage, leg.usage);
    if (!leg.truncated || hops >= maxHops) break;
    hops++;
    const model = models[(from + hops) % models.length];
    log?.info?.("COMBO", `finish_reason=length → continuing on ${model} (hop ${hops}/${maxHops}, ${text.length} chars so far)`);
    const res = await Promise.resolve(handleSingleModel(buildContBody(body, text, false), model)).catch(() => null);
    const next = res?.ok ? await res.json().catch(() => null) : null;
    const nextLeg = inspectJsonLeg(next);
    if (!nextLeg || nextLeg.fmt !== firstLeg.fmt) {
      log?.warn?.("COMBO", `continuation on ${model} failed (${res?.status ?? "error"}), ending with length`);
      break;
    }
    json = next;
    leg = nextLeg;
  }

  const merged = mergeJsonResult(first, json, firstLeg.fmt, text, usage);
  return new Response(JSON.stringify(merged), { status: response.status, headers: { "Content-Type": "application/json" } });
}
