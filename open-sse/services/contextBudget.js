// Context budget: keep large agentic prompts under a token ceiling without breaking
// tool_call/tool_result pairing. We never delete messages (that breaks pairing) and
// never split requests across models (sequential/stateful). Instead we fold OLD
// tool-result content down to a cap, keeping the most recent N tool results
// verbatim so the model can still act on what it just read.
//
// ponytail: only folds tool-result content; assistant turns and system prompt are
// untouched. If more reduction is needed, add history folding (summarize old turns)
// as a second pass behind an env flag.

const DEFAULT_BUDGET_TOKENS = parseInt(process.env.CONTEXT_BUDGET_TOKENS || "60000", 10) || 60000;
const DEFAULT_KEEP_TOOL_RESULTS = parseInt(process.env.CONTEXT_BUDGET_KEEP_TOOL_RESULTS || "8", 10) || 8;
const DEFAULT_FOLD_CAP_CHARS = parseInt(process.env.CONTEXT_BUDGET_FOLD_CAP || "1500", 10) || 1500;
const FOLD_MARKER = "\n...[truncated by context-budget: old tool result]";

export function estimateTokens(body) {
  if (!body) return 0;
  try {
    const text = JSON.stringify(body);
    return Math.ceil(text.length / 4);
  } catch {
    return 0;
  }
}

function isToolResultMessage(m) {
  if (!m || typeof m !== "object") return false;
  if (m.role === "tool") return true;
  if (Array.isArray(m.content)) {
    return m.content.some((p) => p && (p.type === "tool_result" || p.type === "function_call_output" || p.type === "tool_use_result"));
  }
  if (m.type === "function_call_output") return true;
  return false;
}

function foldString(s, cap) {
  if (typeof s !== "string" || s.length <= cap) return s;
  return s.slice(0, cap) + FOLD_MARKER;
}

function foldMessage(m, cap) {
  if (!m || typeof m !== "object") return false;
  let changed = false;
  if (typeof m.content === "string" && isToolResultMessage(m)) {
    const next = foldString(m.content, cap);
    if (next !== m.content) { m.content = next; changed = true; }
  } else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "tool_result" && typeof part.content === "string") {
        const next = foldString(part.content, cap);
        if (next !== part.content) { part.content = next; changed = true; }
      } else if (part.type === "tool_result" && typeof part.text === "string") {
        const next = foldString(part.text, cap);
        if (next !== part.text) { part.text = next; changed = true; }
      } else if (typeof part.text === "string" && isToolResultMessage(m)) {
        const next = foldString(part.text, cap);
        if (next !== part.text) { part.text = next; changed = true; }
      }
    }
  }
  if (m.type === "function_call_output" && typeof m.output === "string") {
    const next = foldString(m.output, cap);
    if (next !== m.output) { m.output = next; changed = true; }
  }
  return changed;
}

// Returns { before, after, folded, applied }
export function applyContextBudget(body, opts = {}) {
  const budget = opts.budgetTokens || DEFAULT_BUDGET_TOKENS;
  const keep = opts.keepToolResults || DEFAULT_KEEP_TOOL_RESULTS;
  const cap = opts.foldCapChars || DEFAULT_FOLD_CAP_CHARS;
  const before = estimateTokens(body);
  if (before <= budget) return { before, after: before, folded: 0, applied: false };

  const messages = Array.isArray(body?.messages) ? body.messages
    : Array.isArray(body?.input) ? body.input
    : null;
  if (!messages || messages.length === 0) return { before, after: before, folded: 0, applied: false };

  // Identify tool-result message indices; keep the last `keep` verbatim.
  const toolIdx = [];
  for (let i = 0; i < messages.length; i++) if (isToolResultMessage(messages[i])) toolIdx.push(i);
  const foldSet = new Set(toolIdx.slice(0, Math.max(0, toolIdx.length - keep)));

  let folded = 0;
  for (const i of foldSet) {
    if (foldMessage(messages[i], cap)) folded++;
  }

  const after = estimateTokens(body);
  return { before, after, folded, applied: folded > 0 };
}
