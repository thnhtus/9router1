import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: text-only arrays become a joined string,
// otherwise the array is returned as-is.
export function collapseTextParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return parts;
  if (parts.every((p) => p?.type === OPENAI_BLOCK.TEXT)) {
    return parts.map((p) => p.text || "").join("\n");
  }
  return parts.length === 1 && parts[0].type === OPENAI_BLOCK.TEXT ? parts[0].text : parts;
}
