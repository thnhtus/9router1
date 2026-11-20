// Counts MCP tool calls from provider-native chunks.
//
// A Pi MCP tool reaches the model as `mcp__<server>__<tool>`; a proxy-only server
// registers one tool `mcp__<server>` whose args pick the real tool. The calls are
// only visible as tool names in the model's output, so we walk the chunk object
// BEFORE translation — the same code then works for OpenAI, Claude, Responses and
// Gemini shapes.

/** `mcp__exa__web_search` → { server: "exa", tool: "web_search" }; null otherwise. */
export function parseMcpName(name) {
  if (typeof name !== "string" || !name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const i = rest.indexOf("__");
  return i < 0 ? { server: rest, tool: "" } : { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

/**
 * Add every MCP tool call found in `value` to `out` (Map `"server\ntool"` → count).
 * `seen` dedupes across streaming chunks: the call id is repeated in later
 * argument deltas, and the name may arrive in a separate fragment.
 */
function isMcpName(name) {
  return typeof name === "string" && name.startsWith("mcp__");
}

const MCP_NAME_FIELDS = ["name", "function", "content_block"];

function fieldName(value, field) {
  if (!value || typeof value !== "object") return null;
  const v = value[field];
  if (field === "function") {
    return v && typeof v === "object" && typeof v.name === "string" ? v.name : null;
  }
  return typeof v === "string" ? v : null;
}

export function collectMcpCalls(value, seen, out) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectMcpCalls(item, seen, out);
    return;
  }

  let name = null;
  for (const f of MCP_NAME_FIELDS) {
    name = fieldName(value, f);
    if (isMcpName(name)) break;
  }
  if (isMcpName(name)) {
    const id = value.id ?? value.call_id ?? value.function?.id ?? value.content_block?.id;
    const mcp = parseMcpName(name);
    const key = id ? `${mcp.server}\n${mcp.tool}\n${id}` : null;
    if (!key || !seen.has(key)) {
      if (key) seen.add(key);
      const k = `${mcp.server}\n${mcp.tool}`;
      out.set(k, (out.get(k) || 0) + 1);
    }
    // The name is consumed here; deeper fields only hold arguments, not new calls.
    return;
  }

  for (const v of Object.values(value)) {
    if (v && typeof v === "object") collectMcpCalls(v, seen, out);
  }
}
