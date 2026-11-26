// Resolves the named prompt-instruction library into a single injected block.
// Entries are matched by scope against the request target:
//   global   → always applies
//   provider → applies when the provider id matches
//   model    → applies when "provider/model" (or bare model) matches
// Enabled entries are ordered by priority ascending, then by name for stability.

const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));

function matches(entry, provider, model) {
  if (!entry || entry.enabled === false) return false;
  const scope = entry.scope || "global";
  if (scope === "global") return true;
  const target = String(entry.target || "").trim().toLowerCase();
  if (!target) return false;
  if (scope === "provider") return target === String(provider || "").toLowerCase();
  if (scope === "model") {
    const full = `${provider || ""}/${model || ""}`.toLowerCase();
    return target === full || target === String(model || "").toLowerCase();
  }
  return false;
}

export function resolvePromptInstructions(list, provider, model) {
  if (!Array.isArray(list) || list.length === 0) return "";
  return list
    .filter((entry) => entry && typeof entry.text === "string" && entry.text.trim())
    .filter((entry) => matches(entry, provider, model))
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0) || byName(a, b))
    .map((entry) => entry.text.trim())
    .join("\n\n");
}
