// Builds a read-only sample of the outgoing request after prompt injection,
// for the Prompt Instructions page. Static sources only: caveman, ponytail,
// legacy custom prompt, named instructions. Memory/skills are per-request and
// are listed as runtime-only, not rendered into the sample.
// Mirrors open-sse/rtk/systemInject.js for the four common wire formats.

import { resolvePromptInstructions } from "./promptInstructions";
import { CAVEMAN_PROMPTS } from "../../open-sse/rtk/cavemanPrompts";
import { PONYTAIL_PROMPTS } from "../../open-sse/rtk/ponytailPrompt";

const SEP = "\n\n";
const FORMATS = ["openai", "claude", "gemini", "responses"];

function baseRequest(format, provider, model, userText) {
  const m = `${provider}/${model}`;
  if (format === "openai") {
    return {
      model: m,
      messages: [{ role: "user", content: userText }],
      stream: true,
    };
  }
  if (format === "claude") {
    return {
      model: m,
      system: "",
      messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
      stream: true,
    };
  }
  if (format === "gemini") {
    return {
      model: m,
      systemInstruction: { parts: [] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
    };
  }
  return {
    model: m,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: userText }] }],
    stream: true,
  };
}

function appendSystem(body, format, prompt) {
  if (!prompt) return;
  if (format === "claude") {
    body.system = body.system ? `${body.system}${SEP}${prompt}` : prompt;
    return;
  }
  if (format === "gemini") {
    body.systemInstruction.parts.push({ text: prompt });
    return;
  }
  if (format === "responses") {
    body.input.unshift({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: prompt }],
    });
    return;
  }
  // openai chat
  const idx = body.messages.findIndex((m) => m && m.role === "system");
  if (idx >= 0) {
    body.messages[idx].content = body.messages[idx].content
      ? `${body.messages[idx].content}${SEP}${prompt}`
      : prompt;
  } else {
    body.messages.unshift({ role: "system", content: prompt });
  }
}

export function buildSampleRequest(settings, items, opts) {
  const st = settings || {};
  const format = FORMATS.includes(opts.format) ? opts.format : "openai";
  const body = baseRequest(format, opts.provider, opts.model, opts.userText);

  const injected = [];
  if (st.cavemanEnabled && st.cavemanLevel) {
    const prompt = Array.isArray(CAVEMAN_PROMPTS[st.cavemanLevel]) ? CAVEMAN_PROMPTS[st.cavemanLevel].join("\n\n") : String(CAVEMAN_PROMPTS[st.cavemanLevel] || st.cavemanLevel);
    injected.push({ source: "caveman", text: prompt });
  }
  if (st.ponytailEnabled && st.ponytailLevel) {
    const prompt = Array.isArray(PONYTAIL_PROMPTS[st.ponytailLevel]) ? PONYTAIL_PROMPTS[st.ponytailLevel].join("\n\n") : String(PONYTAIL_PROMPTS[st.ponytailLevel] || st.ponytailLevel);
    injected.push({ source: "ponytail", text: prompt });
  }
  const legacy = st.customPromptEnabled && typeof st.customPrompt === "string" ? st.customPrompt.trim() : "";
  if (legacy) injected.push({ source: "custom", text: legacy });
  if (st.promptInstructionsEnabled) {
    const block = resolvePromptInstructions(items, opts.provider, opts.model);
    if (block) injected.push({ source: "instructions", text: block });
  }

  for (const entry of injected) {
    appendSystem(body, format, entry.text);
  }
  return { format, body, injected };
}
