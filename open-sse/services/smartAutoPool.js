/**
 * Smart Router Cost Pool — extra model candidates appended for combos using the
 * "smart" strategy, so Jev (System One) can route to models the combo doesn't
 * list but the user has connected, when they're a cheaper fit for the task.
 * Mirrors capacityAdapter.js's augment pattern but keyed on comboStrategy, not caps.
 */

// Models not already in the combo, appended after it (Jev reorders by its own
// choice via orderModelsByChoice, so position here only matters as the no-decision fallback).
// A pool entry that is a combo is flattened recursively into its member models (via the
// async `getComboModels` resolver), so Jev never sees duplicates or routes back into a combo.
// `visited` stops combo cycles (A → B → A); MAX_DEPTH caps pathological nesting.
const MAX_DEPTH = 5;

async function flatten(entry, getComboModels, visited, depth) {
  if (visited.has(entry)) return [];
  const members = depth < MAX_DEPTH && getComboModels ? await getComboModels(entry) : null;
  if (!members) return [entry];
  visited.add(entry);
  const out = [];
  for (const m of members) {
    if (typeof m === "string" && m) out.push(...await flatten(m, getComboModels, visited, depth + 1));
  }
  return out;
}

export async function augmentModelsWithSmartPool(models, comboStrategy, settings, comboName = null, getComboModels = null) {
  if (comboStrategy !== "smart" || !Array.isArray(models) || models.length === 0) return models;
  const cfg = settings?.smartAutoPool;
  if (!cfg?.enabled || !Array.isArray(cfg.models) || cfg.models.length === 0) return models;
  const seen = new Set(models);
  const visited = new Set(comboName ? [comboName] : []);
  const out = [...models];
  for (const entry of cfg.models) {
    if (typeof entry !== "string" || !entry) continue;
    for (const m of await flatten(entry, getComboModels, visited, 0)) {
      if (!seen.has(m)) { seen.add(m); out.push(m); }
    }
  }
  return out;
}
