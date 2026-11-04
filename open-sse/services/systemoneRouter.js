/**
 * Pure System One router utilities for intelligent combo model selection.
 * Used by the "smart" combo strategy to pick the best model for a request
 * before generation begins, with session stickiness for prompt-cache retention.
 */

export const DEFAULT_SYSTEMONE_ROUTER_MODEL = "oc/jev-1.13-free";
export const DEFAULT_SYSTEMONE_TIMEOUT_MS = 8000;
// How long a request waits for Jev before routing by sticky/default order; a late answer
// still lands in the session sticky for the next turn.
export const SMART_WAIT_MS = 400;
export const MAX_STATE_CHARS = 2000;
// How many trailing user turns to include: a short follow-up ("continue", "again")
// only routes correctly with the turns before it, but full history wastes tokens.
const CONTEXT_TURNS = 3;
const EARLY_TURN_CHARS = 300;
export const MAX_STICKY_SESSIONS = 5000;
export const STICKY_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * In-memory session stickiness store for smart-routed combos.
 * Key: `${comboName}:${sessionId}` -> Value: { model, lastUsed }
 */
const comboSessionModelStore = new Map();

/**
 * Extract prompt text from the request body for System One classification.
 * Takes the last user turn (or prompt) and truncates to avoid token waste.
 *
 * @param {object} body - Request body
 * @param {number} [maxChars=MAX_STATE_CHARS] - Max character cap
 * @returns {string} Clean prompt state
 */

const _escalationBudget = new Map();
export function consumeEscalationBudget(comboName, model, limit) {
  const key = `${comboName}:${model}:${new Date().toISOString().slice(0, 10)}`;
  const used = _escalationBudget.get(key) || 0;
  if (used >= limit) return false;
  _escalationBudget.set(key, used + 1);
  return true;
}

export function resetEscalationBudget() { _escalationBudget.clear(); }

export function extractPromptState(body, maxChars = MAX_STATE_CHARS) {
  if (!body || typeof body !== "object") return "";

  // Messages array (OpenAI / Claude / etc.) or input array (Codex)
  const messages = Array.isArray(body.messages)
    ? body.messages
    : (Array.isArray(body.input) ? body.input : null);

  if (messages && messages.length > 0) {
    // Last few user turns (newest last). A short follow-up on its own is ambiguous;
    // the preceding turns disambiguate without sending the whole history.
    const userTexts = [];
    for (let i = messages.length - 1; i >= 0 && userTexts.length < CONTEXT_TURNS; i--) {
      const msg = messages[i];
      if (msg?.role === "user" || msg?.type === "message" || (!msg?.role && msg?.content)) {
        const text = extractTextFromContent(msg.content ?? msg.text);
        if (!text || text.trim().length === 0) continue;
        const cleaned = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
        if (!cleaned) continue;
        if (/^(This is an efficiency nudge|\[acp_delegate (completed|FAILED))/i.test(cleaned)) continue;
        userTexts.unshift(cleaned);
      }
    }
    if (userTexts.length > 0) return joinPromptContext(userTexts, maxChars);

    // Fallback: latest message of any role
    const lastMsg = messages[messages.length - 1];
    const text = extractTextFromContent(lastMsg?.content ?? lastMsg?.text);
    if (text) return text.trim().slice(0, maxChars);
  }

  // String prompt / input
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    return body.prompt.trim().slice(0, maxChars);
  }
  if (typeof body.input === "string" && body.input.trim()) {
    return body.input.trim().slice(0, maxChars);
  }

  return "";
}

// Newest turn keeps the budget; earlier turns are clipped and marked so Jev knows
// they are context, not the request itself.
function joinPromptContext(texts, maxChars) {
  const last = texts[texts.length - 1];
  if (texts.length === 1) return last.slice(0, maxChars);
  const earlier = texts.slice(0, -1).map((t) => `[earlier] ${t.slice(0, EARLY_TURN_CHARS)}`).join("\n");
  const current = `[current] ${last}`;
  // Prefer the current turn when over budget.
  return current.length >= maxChars ? last.slice(0, maxChars) : `${earlier}\n${current}`.slice(-maxChars);
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/**
 * Build choice criteria dictionary for System One from an array of models.
 * Criteria keys are the model names; values are null so System One uses its
 * native knowledge of models without manual descriptions.
 *
 * @param {string[]} models - Array of model IDs in the combo
 * @returns {Record<string, null>} Criteria map
 */
export function buildChoiceCriteria(models) {
  const criteria = {};
  if (!Array.isArray(models)) return criteria;
  for (const m of models) {
    if (typeof m === "string" && m.trim().length > 0) {
      criteria[m.trim()] = null;
    }
  }
  return criteria;
}

/**
 * Parse a System One route response JSON.
 *
 * @param {object} json - Upstream response payload
 * @returns {{ choice: string, confidence: number|null, probabilities: Record<string, number>|null } | null}
 */
export function parseSystemOneRouteAnswer(json) {
  if (!json || typeof json !== "object") return null;

  const route = json.answers?.route;
  if (!route || typeof route !== "object") return null;

  const rawChoice = typeof route.choice === "string" ? route.choice.trim() : "";
  if (!rawChoice) return null;

  const confidence = typeof route.confidence === "number" && Number.isFinite(route.confidence)
    ? route.confidence
    : null;

  let probabilities = null;
  if (route.probabilities && typeof route.probabilities === "object" && !Array.isArray(route.probabilities)) {
    probabilities = {};
    for (const [k, v] of Object.entries(route.probabilities)) {
      const num = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(num)) {
        probabilities[k] = num;
      }
    }
  }

  return {
    choice: rawChoice,
    confidence,
    probabilities,
  };
}

/**
 * Collapse a route onto cost tiers: near-duplicate models (sonnet-5 vs sonnet-5-5) split
 * Jev's probability mass, so per-model confidence stays ~0.5 even when the tier is clear.
 * Picks the tier with the highest summed probability, the best model inside it, and
 * reports the tier sum as confidence plus `peers` (all models of that tier).
 * Models with no known tier stay their own group.
 *
 * @param {object|null} route - Parsed route ({ choice, confidence, probabilities })
 * @param {Record<string,string>} tiers - model → "free"|"cheap"|"mid"|"premium"|"unknown"
 */
export function groupRouteByTier(route, tiers) {
  const probs = route?.probabilities;
  if (!probs || !tiers || Object.keys(probs).length === 0) return route;
  const groupOf = (m) => (tiers[m] && tiers[m] !== "unknown" ? tiers[m] : m);
  const sums = {};
  for (const [m, p] of Object.entries(probs)) sums[groupOf(m)] = (sums[groupOf(m)] || 0) + p;
  const tier = Object.keys(sums).reduce((a, b) => (sums[b] > sums[a] ? b : a));
  const peers = Object.keys(probs).filter((m) => groupOf(m) === tier);
  const choice = peers.includes(route.choice) ? route.choice : peers.reduce((a, b) => (probs[b] > probs[a] ? b : a));
  return { ...route, choice, confidence: Math.min(1, Math.round(sums[tier] * 100) / 100), peers, tier };
}

/**
 * Order combo models based on System One choice result:
 * 1. The selected choice is placed at index 0.
 * 2. Remaining models are ordered by probabilities descending.
 * 3. Models without probabilities retain their relative order at the end.
 *
 * @param {string[]} models - Original models array
 * @param {object} choiceResult - Parsed System One choice
 * @returns {string[]} Reordered models array
 */
export function orderModelsByChoice(models, choiceResult) {
  if (!Array.isArray(models) || models.length <= 1) return models || [];
  if (!choiceResult?.choice || !models.includes(choiceResult.choice)) return [...models];

  const { choice, probabilities } = choiceResult;
  const others = models.filter((m) => m !== choice);

  if (probabilities && typeof probabilities === "object") {
    others.sort((a, b) => {
      const pA = probabilities[a] ?? 0;
      const pB = probabilities[b] ?? 0;
      return pB - pA;
    });
  }

  return [choice, ...others];
}

/**
 * Check if a session already has a sticky model assigned for this combo.
 *
 * @param {string} comboName - Combo name
 * @param {string|null} sessionId - Client session identifier
 * @param {string[]} models - Currently available combo models
 * @returns {string|null} Model to use, or null if no sticky model
 */
export function getStickyComboModel(comboName, sessionId, models) {
  if (!sessionId || !comboName || !Array.isArray(models)) return null;

  const key = `${comboName}:${sessionId}`;
  const entry = comboSessionModelStore.get(key);
  if (!entry) return null;

  // Check TTL (2 hours)
  if (Date.now() - entry.lastUsed > STICKY_SESSION_TTL_MS) {
    comboSessionModelStore.delete(key);
    return null;
  }

  // Ensure stored model still belongs to combo
  if (!models.includes(entry.model)) {
    comboSessionModelStore.delete(key);
    return null;
  }

  entry.lastUsed = Date.now();
  return entry.model;
}

/**
 * Record sticky model for this session so subsequent turns keep prompt-cache warm.
 *
 * @param {string} comboName - Combo name
 * @param {string|null} sessionId - Client session identifier
 * @param {string} model - Selected model
 */
export function setStickyComboModel(comboName, sessionId, model) {
  if (!sessionId || !comboName || !model) return;

  pruneStickyComboSessions();
  const key = `${comboName}:${sessionId}`;
  comboSessionModelStore.set(key, { model, lastUsed: Date.now() });
}

/**
 * Clear a sticky session mapping (e.g. after a model fails or resets).
 *
 * @param {string} comboName - Combo name
 * @param {string|null} [sessionId] - Specific session ID; omit to clear all for combo
 */
export function clearStickyComboSession(comboName, sessionId = null) {
  if (!comboName) {
    comboSessionModelStore.clear();
    return;
  }
  if (sessionId) {
    comboSessionModelStore.delete(`${comboName}:${sessionId}`);
    return;
  }
  // Clear all for this combo
  const prefix = `${comboName}:`;
  for (const k of comboSessionModelStore.keys()) {
    if (k.startsWith(prefix)) comboSessionModelStore.delete(k);
  }
}

/**
 * Prune old or excess sticky sessions to prevent unbounded memory growth.
 */
export function pruneStickyComboSessions() {
  if (comboSessionModelStore.size < MAX_STICKY_SESSIONS) return;

  const now = Date.now();
  // Remove expired
  for (const [k, v] of comboSessionModelStore.entries()) {
    if (now - v.lastUsed > STICKY_SESSION_TTL_MS) {
      comboSessionModelStore.delete(k);
    }
  }

  // If still above ceiling, drop oldest entries
  if (comboSessionModelStore.size >= MAX_STICKY_SESSIONS) {
    const sorted = [...comboSessionModelStore.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const toDrop = sorted.slice(0, Math.floor(MAX_STICKY_SESSIONS / 4));
    for (const [k] of toDrop) {
      comboSessionModelStore.delete(k);
    }
  }
}

/**
 * Reset sticky store (for testing).
 */
export function resetStickyComboStore() {
  comboSessionModelStore.clear();
}
