// Tool-call translation for web-cookie providers (DeepSeek Web, Perplexity Web, etc.).
//
// The web UIs accept only a single plain prompt string and have no native function
// calling — they reply with tool invocations as raw text. To let agentic clients use
// these providers we (a) serialize the OpenAI `tools` array into a system-prompt
// contract on the request side, and (b) parse the upstream `<tool>{...}</tool>` text
// back into OpenAI `tool_calls` on the response side.

import { findTagBlocks } from "../utils/tagBlocks.js";

const TOOL_OPEN_RE = /<tool>/g;
const TOOL_CLOSE_RE = /<\/tool>/g;
// Some web-cookie models (e.g. ds-web) wrap calls as `<tool_call name="...">{json}</tool_call>`
// instead of the canonical `<tool>{...}</tool>`. Capture the JSON body — the real tool name
// lives there, never in the tag's `name="..."` attribute.
// The attribute run stops at `<` as well as `>`: with `[^>]*` an unterminated `<tool_call ` scanned
// to the end of the text from every such tag, so a run of them was quadratic again.
const TOOL_CALL_OPEN_RE = /<tool_call(?:\s[^<>]*)?>/g;
const TOOL_CALL_CLOSE_RE = /<\/tool_call>/g;
// Raw-field dialect (Gemini Web): <tool name="bash" nonce="..."><command>RAW</command></tool>.
// The opening tag carries attributes; children are plain text, no JSON, no escaping.
const TOOL_RAW_OPEN_RE = /<tool\s[^<>]*>/g;
const TOOL_RAW_CLOSE_RE = /<\/tool>/g;

function parseRawToolCall(inner, openTag) {
  const attr = {};
  const attrRe = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let am;
  while ((am = attrRe.exec(openTag))) attr[am[1]] = am[2];
  const name = attr.name || null;
  const nonce = attr.nonce || null;
  const args = {};
  const childRe = /<([A-Za-z_][\w-]*)\s*>([\s\S]*?)<\/\1\s*>/g;
  let cm;
  while ((cm = childRe.exec(inner))) args[cm[1]] = cm[2];
  return { name, nonce, arguments: args };
}

const DSML_INVOKE_RE =
  /<(?<dsml>｜｜DSML｜｜|\|DSML\|)\s*invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/\k<dsml>\s*invoke\s*>/g;

function normalizeDsmlToolCalls(text) {
  DSML_INVOKE_RE.lastIndex = 0;
  return text
    .replace(DSML_INVOKE_RE, (_match, _dsml, name, body) => {
      const parameters = {};
      const parameterRe =
        /<(?:｜｜DSML｜｜|\|DSML\|)\s*parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/?(?:｜｜DSML｜｜|\|DSML\|)\s*parameter\s*>|(?=<(?:｜｜DSML｜｜|\|DSML\|)\s*parameter\s+name=|<\/(?:｜｜DSML｜｜|\|DSML\|)\s*invoke\s*>))/g;
      let parameter = null;
      while ((parameter = parameterRe.exec(body)) !== null) {
        const raw = parameter[2].trim();
        try {
          parameters[parameter[1]] = JSON.parse(raw);
        } catch {
          parameters[parameter[1]] = raw;
        }
      }
      if (Object.keys(parameters).length === 0) {
        try {
          const parsed = JSON.parse(body.trim() || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            Object.assign(parameters, parsed);
          }
        } catch {
          // Leave malformed arguments empty; the surrounding parser remains fail-safe.
        }
      }
      return `<tool>{"name":${JSON.stringify(name)},"arguments":${JSON.stringify(parameters)}}</tool>`;
    })
    .replace(/<\/?(?:｜｜DSML｜｜|\|DSML\|)\s*calls\s*>/g, "");
}

// Per-request nonce binding for tool envelopes. Associates a random nonce
// with each tools[] array reference so the serializer and parser can share it
// without threading extra parameters through executor call chains.
const toolNonceMap = new WeakMap();

export function getToolNonce(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  let nonce = toolNonceMap.get(tools);
  if (!nonce) {
    nonce = Math.random().toString(36).slice(2, 10);
    toolNonceMap.set(tools, nonce);
  }
  return nonce;
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

export function getRequestedToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  const names = [];
  const seen = new Set();
  for (const tool of tools) {
    const record = toRecord(tool);
    const fn = toRecord(record?.function);
    const name = typeof fn?.name === "string" ? fn.name.trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push({ original: name, normalized: normalizeToolName(name) });
  }
  return names;
}

function normalizeToolName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    const temp = previous;
    previous = current;
    current = temp;
  }
  return previous[b.length];
}

function scoreToolName(emitted, requested) {
  if (emitted === requested.original) return 1;
  const normalized = normalizeToolName(emitted);
  if (!normalized || !requested.normalized) return 0;
  if (normalized === requested.normalized) return 0.98;

  const shorter = Math.min(normalized.length, requested.normalized.length);
  const longer = Math.max(normalized.length, requested.normalized.length);
  if (shorter >= 4) {
    if (normalized.includes(requested.normalized) || requested.normalized.includes(normalized)) {
      return 0.86 - (longer - shorter) / Math.max(longer, 1) / 4;
    }
  }

  const distance = levenshteinDistance(normalized, requested.normalized);
  const similarity = 1 - distance / Math.max(longer, 1);
  return similarity >= 0.72 ? similarity : 0;
}

export function resolveRequestedToolName(emitted, requestedTools) {
  if (requestedTools.length === 0) return emitted;

  let best = null;
  let secondBest = 0;
  for (const requested of requestedTools) {
    const score = scoreToolName(emitted, requested);
    if (!best || score > best.score) {
      secondBest = best?.score ?? 0;
      best = { name: requested.original, score };
    } else if (score > secondBest) {
      secondBest = score;
    }
  }

  if (!best || best.score < 0.72) return null;
  // Avoid correcting to an arbitrary tool when the fuzzy match is ambiguous.
  if (best.score < 0.98 && best.score - secondBest < 0.08) return null;
  return best.name;
}

function stripCodeFence(value) {
  return value
    .trim()
    .replace(/^```(?:json|javascript|js|python)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function convertSingleQuotedStrings(value) {
  let result = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of value) {
    if (escaped) {
      result += ch === '"' && inSingle ? '\\"' : ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      if (inSingle) {
        result += '\\"';
      } else {
        inDouble = !inDouble;
        result += ch;
      }
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      result += '"';
      continue;
    }

    result += ch;
  }

  return result;
}

function replacePythonLiterals(value) {
  let result = "";
  let inString = false;
  let escaped = false;
  let token = "";

  const flushToken = () => {
    if (token === "True") result += "true";
    else if (token === "False") result += "false";
    else if (token === "None") result += "null";
    else result += token;
    token = "";
  };

  for (const ch of value) {
    if (escaped) {
      if (token) flushToken();
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      if (token) flushToken();
      result += ch;
      escaped = inString;
      continue;
    }

    if (ch === '"') {
      if (token) flushToken();
      inString = !inString;
      result += ch;
      continue;
    }

    if (!inString && /[A-Za-z]/.test(ch)) {
      token += ch;
      continue;
    }

    if (token) flushToken();
    result += ch;
  }

  if (token) flushToken();
  return result;
}

function normalizeLooseJson(value) {
  return replacePythonLiterals(convertSingleQuotedStrings(value))
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    .replace(/,\s*([}\]])/g, "$1");
}

/** Escape raw newline/tab characters that sit inside a JSON string literal.
 *  Models often emit a multi-line shell command with literal line breaks. */
function escapeRawControlsInStrings(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch === "\n") { out += "\\n"; continue; }
      else if (ch === "\r") { out += "\\r"; continue; }
      else if (ch === "\t") { out += "\\t"; continue; }
    } else if (ch === '"') {
      inString = true;
    }
    out += ch;
  }
  return out;
}

const TRAILING_SIMPLE_PAIR_RE = /,\s*"([A-Za-z_][\w-]*)"\s*:\s*(-?\d+(?:\.\d+)?|true|false|null|"[^"\\\n]*")\s*$/;

/** `{"command": "<anything, even unescaped quotes>", "timeout": 600}`:
 *  peel simple trailing pairs off the end, then the single leading string value
 *  is everything up to the last quote. */
function parseGreedyStringObject(objText) {
  let inner = objText.trim().slice(1, -1);
  const tail = {};
  for (let m = TRAILING_SIMPLE_PAIR_RE.exec(inner); m; m = TRAILING_SIMPLE_PAIR_RE.exec(inner)) {
    tail[m[1]] = JSON.parse(m[2]);
    inner = inner.slice(0, m.index);
  }
  const head = /^\s*"([A-Za-z_][\w-]*)"\s*:\s*"([\s\S]*)"\s*$/.exec(inner);
  if (!head) return null;
  const body = escapeRawControlsInStrings(`"${head[2].replace(/(^|[^\\])"/g, '$1\\"').replace(/(^|[^\\])"/g, '$1\\"')}"`);
  try {
    return { [head[1]]: JSON.parse(body), ...Object.fromEntries(Object.entries(tail).reverse()) };
  } catch {
    return null;
  }
}

/** Last resort for the tool-call envelope web models emit with broken JSON in
 *  `arguments` (unescaped quotes / newlines inside a shell command). */
function parseToolEnvelopeLoose(text) {
  const m = /^\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*\})\s*(?:,\s*"_nonce"\s*:\s*"([^"]*)"\s*)?\}$/.exec(text.trim());
  if (!m) return null;
  let args = null;
  try {
    args = JSON.parse(escapeRawControlsInStrings(m[2]));
  } catch {
    args = parseGreedyStringObject(m[2]);
  }
  if (!args) return null;
  return m[3] === undefined ? { name: m[1], arguments: args } : { name: m[1], arguments: args, _nonce: m[3] };
}

export function parseLooseJsonObject(raw) {
  const trimmed = stripCodeFence(raw);
  const escaped = escapeRawControlsInStrings(trimmed);
  for (const candidate of [trimmed, normalizeLooseJson(trimmed), escaped, normalizeLooseJson(escaped)]) {
    try {
      return toRecord(JSON.parse(candidate));
    } catch {
      // Try the next, more permissive form.
    }
  }
  return null;
}

function findBareJsonCandidates(text) {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (depth === 0 && ch !== "{") {
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const raw = text.slice(start, i + 1);
        if (
          /[{,]\s*["']?(name|command)["']?\s*:/i.test(raw) &&
          /[{,]\s*["']?arguments["']?\s*:/i.test(raw)
        ) {
          candidates.push({ raw, start, end: i + 1, requireRequestedTool: true });
        }
        start = -1;
      }
    }
  }

  return candidates;
}

export function stripRanges(text, ranges) {
  let content = text;
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  for (const range of sorted) {
    const lineStart = content.lastIndexOf("\n", range.start - 1) + 1;
    const nextLineBreak = content.indexOf("\n", range.end);
    const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;
    const beforeOnLine = content.slice(lineStart, range.start);
    const afterOnLine = content.slice(range.end, lineEnd);
    const removeWholeLine = beforeOnLine.trim() === "" && afterOnLine.trim() === "";
    const start = removeWholeLine ? lineStart : range.start;
    const end =
      removeWholeLine && nextLineBreak !== -1
        ? nextLineBreak + 1
        : removeWholeLine
          ? lineEnd
          : range.end;
    content = `${content.slice(0, start)}${content.slice(end)}`;
  }
  return content.replace(/\n{3,}/g, "\n\n").trim();
}

export function toArgumentsString(value) {
  if (value === undefined) return "{}";
  if (typeof value === "string") {
    const parsed = parseLooseJsonObject(value);
    return parsed ? JSON.stringify(parsed) : value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

/**
 * Serialize an OpenAI `tools` array into a system-prompt block that instructs the
 * web UI model how to invoke a tool (emit a `<tool>{...}</tool>` block). Returns an
 * empty string when there are no usable tools.
 *
 * Each invocation generates a per-request nonce that is embedded in the tool format
 * instructions. The parser (parseToolCallsFromText) requires this nonce in the model's
 * `<tool>` JSON to distinguish legitimate tool calls from bare JSON, code-fenced JSON,
 * or copy-attacked envelopes.
 */
export function serializeToolsToPrompt(tools, opts) {
  if (!Array.isArray(tools) || tools.length === 0) return "";

  const nonce = getToolNonce(tools);
  if (!nonce) return "";

  if (opts?.dialect === "raw") {
    // Raw-field dialect: parameters are emitted as bare text inside child
    // tags instead of JSON, so shell commands with quotes/newlines/backslashes
    // need no escaping at all. Gemini Web follows this shape reliably (6/6
    // live) where JSON encoding of those bodies fails.
    const lines = [];
    for (const t of tools) {
      const fn = t?.function;
      if (!fn?.name) continue;
      const desc = typeof fn.description === "string" && fn.description ? fn.description : "";
      let params = "";
      try {
        params = fn.parameters ? JSON.stringify(fn.parameters) : "";
      } catch {
        params = "";
      }
      const fields = [];
      const pprops = fn.parameters?.properties;
      if (pprops && typeof pprops === "object") {
        for (const [key, schema] of Object.entries(pprops)) {
          fields.push(`  <${key}>RAW ${key}${schema?.type ? ` (${schema.type})` : ""}</${key}>`);
        }
      }
      lines.push(
        `- ${fn.name}${desc ? `: ${desc}` : ""}${params ? `\n  parameters: ${params}` : ""}` +
        (fields.length
          ? `\n  Invoke as:\n  <tool name="${fn.name}" nonce="${nonce}">\n${fields.join("\n")}\n  </tool>`
          : "")
      );
    }
    if (lines.length === 0) return "";
    return [
      "The client application provides tools beyond your built-in ones. They are invoked via a plain-text protocol: the client parses your reply and executes the tool on the user machine. To invoke one, reply with exactly one block of this shape:",
      `<tool name="<tool_name>" nonce="${nonce}">`,
      "<command>RAW TEXT, NO JSON, NO ESCAPING — quotes and newlines are fine</command>",
      "<timeout>600</timeout> (only if the tool declares it)",
      "</tool>",
      "Only emit the <tool> block when you actually want to call the tool; otherwise answer normally. Include the secret nonce exactly.",
      "",
      "Available tools:",
      ...lines,
    ].join("\n");
  }

  const lines = [];
  for (const t of tools) {
    const fn = t?.function;
    if (!fn?.name) continue;
    const desc = typeof fn.description === "string" && fn.description ? fn.description : "";
    let params = "";
    try {
      params = fn.parameters ? JSON.stringify(fn.parameters) : "";
    } catch {
      params = "";
    }
    lines.push(
      `- ${fn.name}${desc ? `: ${desc}` : ""}${params ? `\n  parameters: ${params}` : ""}`
    );
  }

  if (lines.length === 0) return "";

  return [
    "The client application provides tools beyond your built-in ones. They are NOT in your " +
    "native tool registry; they are invoked via a plain-text protocol: the client parses " +
    "your reply and executes the tool on the user machine. Treat these client tools as " +
    "fully available to you; never claim they are unavailable. To invoke one, reply with " +
    "a single line containing a <tool> block",
    `with JSON that includes the secret binding "_nonce": "${nonce}":`,
    `<tool>{"name": "<tool_name>", "arguments": { ... }, "_nonce": "${nonce}"}</tool>`,
    "These client tools ARE available to you in this conversation. Only emit the <tool> " +
    "block when you actually want to call a tool; otherwise answer normally.",
    "",
    "Available tools:",
    ...lines,
  ].join("\n");
}

/**
 * Parse `<tool>{...}</tool>` or `<tool_call>{...}</tool_call>` blocks out of
 * upstream text into OpenAI `tool_calls`.
 *
 * **Security hardening:** Bare JSON with name+arguments keys is NEVER
 * promoted to tool_calls — only explicit `<tool>` or `<tool_call>` envelopes are
 * accepted. When a nonce was embedded via serializeToolsToPrompt (stored from the
 * same tools[] reference), it MUST be present in the parsed JSON body as `_nonce`.
 * This prevents code-fenced JSON, prose JSON, and copy-attacked user envelopes from
 * triggering tool execution.
 *
 * Returns the content with the recognized blocks stripped, plus the tool calls
 * (or null when there are none). `arguments` is always a JSON *string*, matching
 * the OpenAI API.
 */
function isWholeJsonReply(text) {
  const t = stripCodeFence(text).trim();
  return t.startsWith("{") && t.endsWith("}");
}

export function parseToolCallsFromText(text, idSeed = "call", requestedTools) {
  const normalizedText = typeof text === "string" ? normalizeDsmlToolCalls(text) : text;
  const requestedToolNames = getRequestedToolNames(requestedTools);
  const nonce = getToolNonce(requestedTools);
  if (
    typeof normalizedText !== "string" ||
    (!normalizedText.includes("<tool>") &&
      !/<tool\s[^<>]*>/.test(normalizedText) &&
      !normalizedText.includes("<tool_call") &&
      !(nonce && (normalizedText.includes("_nonce") || isWholeJsonReply(normalizedText))))
  ) {
    return { content: text ?? "", toolCalls: null };
  }

  const candidates = [];

  // Candidate extraction runs on the DSML-normalized text: normalizeDsmlToolCalls rewrites
  // DeepSeek's native dialect into canonical <tool> blocks first, so both shapes are collected.
  for (const block of [
    ...findTagBlocks(normalizedText, TOOL_OPEN_RE, TOOL_CLOSE_RE),
    ...findTagBlocks(normalizedText, TOOL_CALL_OPEN_RE, TOOL_CALL_CLOSE_RE),
  ]) {
    candidates.push({
      raw: block.inner.trim(),
      start: block.start,
      end: block.end,
      requireRequestedTool: false,
      isEnvelope: true,
    });
  }

  // Raw-field dialect blocks: <tool name=".." nonce=".."><command>..</command></tool>.
  for (const block of findTagBlocks(normalizedText, TOOL_RAW_OPEN_RE, TOOL_RAW_CLOSE_RE)) {
    const openTag = normalizedText.slice(block.start).match(/^<tool\s[^<>]*>/)?.[0] || "";
    candidates.push({
      raw: block.inner.trim(),
      start: block.start,
      end: block.end,
      requireRequestedTool: true,
      rawDialect: parseRawToolCall(block.inner, openTag),
      isEnvelope: true,
    });
  }

  // Some models (Gemini Web) answer the contract with the bare JSON object and
  // drop the `<tool>` envelope. That shape is only accepted when it echoes the
  // per-request nonce exactly — a bare JSON without it could be prose or a
  // copy-attack, so it stays text.
  if (nonce) {
    const enveloped = candidates.map((c) => [c.start, c.end]);
    for (const candidate of findBareJsonCandidates(normalizedText)) {
      // A JSON body inside a `<tool>` envelope is already collected; adding it
      // again would emit the same call twice.
      if (enveloped.some(([s, e]) => candidate.start >= s && candidate.end <= e)) continue;
      candidates.push({ ...candidate, requireNonce: true });
    }
  }

  candidates.sort((a, b) => a.start - b.start);

  const toolCalls = [];
  const acceptedRanges = [];
  const allEnvelopeRanges = candidates.filter((c) => c.isEnvelope).map(({ start, end }) => ({ start, end }));
  for (const candidate of candidates) {
    const parsed = candidate.rawDialect
      ? candidate.rawDialect
      : parseLooseJsonObject(candidate.raw) || parseToolEnvelopeLoose(candidate.raw);
    const emittedName =
      parsed && typeof parsed.name === "string"
        ? parsed.name
        : parsed && typeof parsed.command === "string"
          ? parsed.command
          : null;
    if (!emittedName) continue;

    // Raw dialect requires the exact nonce (shell execution is dangerous; the
    // instruction tells the model to include it literally).
    if (candidate.rawDialect) {
      if (!nonce || candidate.rawDialect.nonce !== nonce) continue;
    }

    // Nonce binding check: when the tool prompt embedded a nonce, check
    // that any _nonce present in the JSON body matches. A wrong nonce (present but
    // does not match) means this is a copy-attack or hallucination — treat it as text
    // instead of executing it. A missing _nonce is tolerated for backward compatibility
    // with models that do not (yet) follow the nonce instruction.
    // Bare JSON needs the nonce, except when it IS the entire reply: Gemini
    // Web often drops `_nonce`, and a reply that is nothing but one call to a
    // requested tool is not prose quoting JSON. A wrong nonce is still rejected below.
    const wholeReply = candidate.start === 0 && normalizedText.slice(candidate.end).trim() === "" &&
      normalizedText.slice(0, candidate.start).trim() === "";
    if (candidate.requireNonce && parsed?._nonce !== nonce && !(wholeReply && parsed?._nonce === undefined)) continue;
    if (nonce && parsed && parsed._nonce !== undefined && parsed._nonce !== nonce) continue;

    const name =
      resolveRequestedToolName(emittedName, requestedToolNames) ||
      (candidate.requireRequestedTool ? null : emittedName);
    if (!name || (candidate.requireRequestedTool && requestedToolNames.length === 0)) continue;
    const args = toArgumentsString(
      candidate.rawDialect ? parsed.arguments : parsed?.arguments
    );
    toolCalls.push({
      id: `${idSeed}_${toolCalls.length}`,
      type: "function",
      function: { name, arguments: args },
    });
    acceptedRanges.push({ start: candidate.start, end: candidate.end });
  }

  // Incomplete trailing envelope (model stopped mid-block): strip it and flag.
  let incomplete = false;
  const openMatches = [...normalizedText.matchAll(/<tool(?:\s[^<>]*)?>|<tool_call(?:\s[^<>]*)?>/g)];
  const lastOpen = openMatches.length ? openMatches[openMatches.length - 1] : null;
  if (lastOpen) {
    const afterOpen = normalizedText.slice(lastOpen.index + lastOpen[0].length);
    if (!/<\/tool>|<\/tool_call>/.test(afterOpen)) {
      incomplete = true;
      allEnvelopeRanges.push({ start: lastOpen.index, end: normalizedText.length });
    }
  }

  const rejectedRanges = allEnvelopeRanges.filter(
    (r) => !acceptedRanges.some((a) => a.start === r.start && a.end === r.end)
  );
  const hadToolBlock = allEnvelopeRanges.length > 0;

  if (toolCalls.length === 0) {
    // A Gemini-style tool envelope that failed validation is protocol debris,
    // not useful assistant prose. Leave a signal for the executor to continue.
    const invalidRanges = candidates
      .filter((candidate) => candidate.isEnvelope)
      .map(({ start, end }) => ({ start, end }));
    if (invalidRanges.length > 0 || incomplete) {
      const ranges = invalidRanges.length > 0 ? invalidRanges : allEnvelopeRanges;
      return {
        content: stripRanges(normalizedText, ranges),
        toolCalls: null,
        invalidToolCall: true,
        incomplete,
        hadToolBlock: true,
      };
    }
    return { content: text, toolCalls: null, incomplete: false, hadToolBlock };
  }

  const content = stripRanges(normalizedText, [...acceptedRanges, ...rejectedRanges]);
  return { content, toolCalls, incomplete, hadToolBlock };
}

// ── Shared helpers for web-cookie executors ────────────────────────────────

/** One-line nudge appended to the latest user message. Web-UI models weigh the
 *  current user turn far more heavily than a large system block, and ChatGPT's
 *  injection heuristics distrust long instructions embedded in user content —
 *  so the full contract stays in the system block (trailing, see below) and the
 *  user turn only carries a short pointer back to it, naming the tools. */
function buildToolReminder(toolPrompt) {
  const names = (toolPrompt.match(/^- [^:\n]+/gm) || []).map((s) => s.slice(2).trim()).join(", ");
  return (
    "\n\n[Client protocol reminder: the client-tool contract in the system instructions " +
    "is active in this conversation. These client tools ARE available via the <tool> " +
    "block protocol" +
    (names ? ": " + names : "") +
    ".]"
  );
}

/**
 * Extract tools from an OpenAI request body and inject the tool contract when
 * tools are present. Every web-cookie executor that wants tool-call support
 * calls this once before building its upstream request body.
 *
 * Placement matters: the contract used to be PREPENDED as the first system
 * message. Executors fold all system messages into one block, so with agentic
 * clients whose system prompts exceed ~28K chars the contract sat at the head
 * of a huge block and observed web models ignored it, answering
 * "tool X is not in my tool set" instead of emitting <tool> blocks. Dual
 * placement fixes it: the full contract goes AFTER the client messages (folds
 * to the tail of the system block) and a one-line reminder rides at the end of
 * the latest user message.
 */
export function prepareToolMessages(bodyObj, messages, opts) {
  const requestedTools = bodyObj.tools;
  const hasTools = Array.isArray(requestedTools) && requestedTools.length > 0;
  if (!hasTools) return { hasTools: false, requestedTools, effectiveMessages: messages };

  const toolPrompt = serializeToolsToPrompt(requestedTools, opts);
  if (!toolPrompt) return { hasTools: true, requestedTools, effectiveMessages: messages };

  const effectiveMessages = [...messages];
  const reminder = buildToolReminder(toolPrompt);
  for (let i = effectiveMessages.length - 1; i >= 0; i--) {
    const msg = effectiveMessages[i];
    if (msg?.role !== "user") continue;
    if (typeof msg.content === "string") {
      effectiveMessages[i] = { ...msg, content: msg.content + reminder };
    } else if (Array.isArray(msg.content)) {
      effectiveMessages[i] = {
        ...msg,
        content: [...msg.content, { type: "text", text: reminder }],
      };
    }
    break;
  }
  effectiveMessages.push({ role: "system", content: toolPrompt });
  return { hasTools: true, requestedTools, effectiveMessages };
}

/**
 * Parse tool calls from a model's text response. Returns the cleaned content
 * (with `<tool>` blocks stripped), the parsed tool calls (or null), and the
 * appropriate finish_reason. Every web-cookie executor calls this on the
 * collected response text when `hasTools` is true.
 */
export function buildToolAwareResult(rawContent, requestedTools, idSeed = "call") {
  const { content, toolCalls } = parseToolCallsFromText(
    rawContent,
    `${idSeed}-${Date.now()}`,
    requestedTools
  );
  return {
    content,
    toolCalls,
    finishReason: toolCalls ? "tool_calls" : "stop",
  };
}
