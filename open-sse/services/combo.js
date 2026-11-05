/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { parseModel } from "./model.js";
import { startComboTrace } from "./comboTrace.js";
import { extractTextContent } from "../translator/formats/gemini.js";
import { peekStreamForContent, reconstructStream, isNoRetryFinish } from "./emptyFailover.js";
import {
  getStickyComboModel,
  setStickyComboModel,
  clearStickyComboSession,
  orderModelsByChoice,
  SMART_WAIT_MS,
} from "./systemoneRouter.js";
import { makeKv } from "../../src/lib/db/helpers/kvStore.js";

const fairnessKv = makeKv("comboFairness");

const LATE = Symbol("late");

// Wait at most waitMs for Jev so routing never blocks the request on it.
// A late answer goes to onLate (to update the session sticky for the next turn).
function raceSmartChoice(promise, onLate, waitMs = SMART_WAIT_MS) {
  let timer;
  const timeout = new Promise((res) => { timer = setTimeout(() => res(LATE), waitMs); });
  return Promise.race([promise, timeout]).then((r) => {
    clearTimeout(timer);
    if (r !== LATE) return r;
    promise.then(onLate, () => {});
    return null;
  }, (err) => { clearTimeout(timer); throw err; });
}

// Peek a 2xx combo response for real content. Returns null for non-SSE responses (leave
// them untouched). For SSE, returns { outcome: "content"|"empty", finishReason, response }
// where `response` is a faithful replay of the original stream (head buffer + live reader).
async function peekComboResponse(result, log) {
  const ct = (result.headers.get("content-type") || "").toLowerCase();
  if (!result.body || !ct.includes("text/event-stream")) return null;
  const peeked = await peekStreamForContent(result.body);
  const response = new Response(reconstructStream(peeked.head, peeked.reader, peeked.pendingRead), {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
  return { outcome: peeked.outcome, finishReason: peeked.finishReason, timedOut: peeked.timedOut, response };
}

// Hard capabilities = input modalities; missing one drops request data (e.g. image
// stripped). Must be prioritized. Soft (e.g. search) only degrades a feature.
const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

// Prefixes used when flattening tool turns into plain prose for panel models.
const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ";

// Flatten tool turns into prose so panel models keep the context but can't loop
// on tools: drop the request's tools, turn tool/function results into assistant
// text, and inline assistant tool_calls names instead of the structured field.
function flattenToolHistory(messages) {
  return messages
    .filter((msg) => msg)
    .map((msg) => {
      if (msg.role === "tool" || msg.role === "function") {
        return { role: "assistant", content: `${TOOL_RESULT_PREFIX}${extractTextContent(msg.content) || String(msg.content ?? "")}]` };
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const { tool_calls, ...rest } = msg;
        const names = tool_calls.map((c) => c?.function?.name || c?.name || "tool").join(", ");
        const base = extractTextContent(rest.content) || (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((c) => c.type === "tool_use");
        const hasToolResult = msg.content.some((c) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts = [];
          const toolNames = [];
          const toolResults = [];
          for (const block of msg.content) {
            if (block.type === "text" && block.text) textParts.push(block.text);
            if (block.type === "tool_use") toolNames.push(block.name || "tool");
            if (block.type === "tool_result") toolResults.push(extractTextContent(block.content) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return msg;
    });
}

// Reorder combo models by capability fit. Stable; never drops a model (fallback intact).
// Tier 0: satisfies all hard + all soft. Tier 1: all hard only. Tier 2: rest.
export function reorderByCapabilities(models, required) {
  if (!required || required.size === 0 || !Array.isArray(models) || models.length <= 1) return models;
  const hard = [...required].filter((c) => HARD_CAPS.has(c));
  const soft = [...required].filter((c) => !HARD_CAPS.has(c));

  const tierOf = (m) => {
    const slash = typeof m === "string" ? m.indexOf("/") : -1;
    const provider = slash > 0 ? m.slice(0, slash) : "";
    const model = slash > 0 ? m.slice(slash + 1) : m;
    const caps = getCapabilitiesForModel(provider, model);
    if (!hard.every((c) => caps[c] === true)) return 2;
    return soft.every((c) => caps[c] === true) ? 0 : 1;
  };

  // Stable sort by tier (Array.prototype.sort is stable in modern engines).
  return models
    .map((m, i) => ({ m, i, t: tierOf(m) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.m);
}

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();

// Trailing run of items after the last assistant/model turn = the current user
// turn. It may span several messages (e.g. text + image split across blocks),
// so we return all of them. History media (older turns) must not pin the combo
// to a vision model — those get stripped + placeholdered downstream instead.
function trailingUserItems(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const isAssistant = (r) => r === "assistant" || r === "model";
  let i = arr.length - 1;
  while (i >= 0 && !isAssistant(arr[i]?.role)) i--;
  return arr.slice(i + 1);
}

// Detect which capabilities a request needs. Modalities (vision/pdf) are scanned
// only on the current user turn; "search" is request-wide (lives in tools).
// Returns a Set of: "vision" | "pdf" | "search".
export function detectRequiredCapabilities(body) {
  const required = new Set();
  if (!body || typeof body !== "object") return required;

  const addByMime = (mime) => {
    if (typeof mime !== "string") return;
    if (mime.startsWith("image/")) required.add("vision");
    else if (mime === "application/pdf") required.add("pdf");
    else if (mime.startsWith("audio/")) required.add("audioInput");
    else if (mime.startsWith("video/")) required.add("videoInput");
  };

  const scanBlock = (b) => {
    if (!b || typeof b !== "object") return;
    const t = b.type;
    if (t === "image_url" || t === "image" || t === "input_image") required.add("vision");
    if (t === "input_audio" || t === "audio_url" || t === "audio") required.add("audioInput");
    if (t === "input_video" || t === "video_url" || t === "video") required.add("videoInput");
    if (t === "file" || t === "document" || t === "input_file") {
      // Infer modality from embedded mime when available; fall back to pdf for generic files.
      let fmime = null;
      if (b.input_audio?.format) fmime = `audio/${b.input_audio.format}`;
      else if (b.file?.file_data) fmime = String(b.file.file_data).match(/^data:([^;,]+)/)?.[1];
      else if (b.source?.media_type) fmime = b.source.media_type;
      else if (b.source?.data) fmime = String(b.source.data).match(/^data:([^;,]+)/)?.[1];
      if (fmime) addByMime(fmime);
      else required.add("pdf");
    }
    // gemini parts: inlineData/fileData carry a mime
    addByMime(b.inlineData?.mimeType || b.fileData?.mimeType);
  };

  const scanContent = (content) => {
    if (Array.isArray(content)) for (const b of content) scanBlock(b);
  };

  const scanMessage = (m) => {
    if (!m || typeof m !== "object") return;

    // Ollama / Hermes images array (strings or objects)
    if (Array.isArray(m.images) && m.images.length > 0) {
      required.add("vision");
    }

    // Vercel AI SDK / Hermes attachments / experimental_attachments
    const attachments = m.experimental_attachments || m.attachments;
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (!att) continue;
        const mime = att.contentType || att.mediaType || (typeof att.url === "string" && att.url.match(/^data:([^;,]+)/)?.[1]);
        if (mime) addByMime(mime);
        else if (att.url || att.data) required.add("vision");
      }
    }

    // Direct message-level modality properties
    if (m.image_url || m.image) required.add("vision");
    if (m.audio_url || m.audio) required.add("audioInput");

    // Scan array content blocks
    scanContent(m.content);

    // Scan string content for embedded data URIs
    if (typeof m.content === "string") {
      if (m.content.includes("data:image/")) required.add("vision");
      else if (m.content.includes("data:audio/")) required.add("audioInput");
      else if (m.content.includes("data:application/pdf")) required.add("pdf");
    }
  };

  // Modalities: current user turn only (trailing user run across each known shape).
  for (const m of trailingUserItems(body.messages)) scanMessage(m);              // openai / claude / hermes / ollama
  for (const it of trailingUserItems(body.input)) scanContent(it.content);       // responses
  const contents = body.contents || body.request?.contents;                      // gemini / antigravity
  for (const c of trailingUserItems(contents)) scanContent(c.parts);

  // search: temporarily disabled in auto-switch (feature not wired yet).

  return required;
}

function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function shuffleModels(models) {
  const out = [...models];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Per-combo member fairness, persisted in DB (kv scope "comboFairness") so it survives
// restarts and is shared by instances. Every member is tracked: a member not tried for
// FAIR_STALE_TURNS turns is promoted, a member that failed within FAIR_ERR_TURNS turns
// is demoted to the end, the rest keep the incoming (shuffled + Jev-scored) order.
// ok/fail counters are kept as the combo's model evaluation record.
// ponytail: last-write-wins per combo; concurrent instances can lose a tick. Move to a
// row-per-member table with atomic UPDATE if exact counts across instances matter.
export const FAIR_STALE_TURNS = 3;
export const FAIR_ERR_TURNS = 5;
const comboFairness = new Map(); // comboName -> { seq, exploreSeq, members: Map(model -> { lastSeq, errSeq, ok, fail }) }

const newFairness = () => ({ seq: 0, exploreSeq: 0, members: new Map() });

/** Reload the combo's fairness state from DB (shared across instances); keeps memory on DB error. */
export async function hydrateComboFairness(comboName) {
  if (!comboName) return;
  try {
    const raw = await fairnessKv.get(comboName, null);
    if (!raw) return;
    const local = comboFairness.get(comboName);
    if (local && local.seq > (raw.seq || 0)) return; // our unsaved state is newer
    comboFairness.set(comboName, { seq: raw.seq || 0, exploreSeq: raw.exploreSeq || 0, members: new Map(Object.entries(raw.members || {})) });
  } catch { /* fail open: in-memory state */ }
}

function persistFairness(comboName, s) {
  fairnessKv.set(comboName, { seq: s.seq, exploreSeq: s.exploreSeq, members: Object.fromEntries(s.members) }).catch(() => {});
}

export function getComboFairness(comboName) {
  return comboFairness.get(comboName) || null;
}

function fairnessState(comboName) {
  let s = comboFairness.get(comboName);
  if (!s) comboFairness.set(comboName, (s = newFairness()));
  return s;
}

export function markComboMember(comboName, model, failed = false) {
  const s = fairnessState(comboName);
  const m = s.members.get(model) || {};
  m.lastSeq = s.seq;
  if (failed) { m.errSeq = s.seq; m.fail = (m.fail || 0) + 1; }
  else { delete m.errSeq; m.ok = (m.ok || 0) + 1; }
  s.members.set(model, m);
  persistFairness(comboName, s);
}

/**
 * Advance the combo's turn and reorder: stale first, recent errors last.
 * `keepHead` (forced/sticky) always stays first.
 * `softHead` (per-turn Jev pick) stays first unless it failed recently (then demoted) or
 * this is an exploration turn: at most one turn per FAIR_STALE_TURNS lets stale members
 * run ahead of it, so Jev is overridden rarely and predictably.
 */
export function fairnessOrdered(models, comboName, keepHead = null, softHead = null) {
  const s = fairnessState(comboName);
  s.seq += 1;
  const hard = keepHead && models.includes(keepHead) ? keepHead : null;
  const soft = !hard && softHead && models.includes(softHead) ? softHead : null;
  const stale = [], ok = [], err = [];
  let softFailed = false;
  for (const m of models) {
    if (m === hard) continue;
    const st = s.members.get(m);
    const failed = st?.errSeq != null && s.seq - st.errSeq <= FAIR_ERR_TURNS;
    if (m === soft) { softFailed = failed; if (failed) err.push(m); continue; }
    if (failed) err.push(m);
    else if (!st || s.seq - st.lastSeq > FAIR_STALE_TURNS) stale.push(m);
    else ok.push(m);
  }
  let head = hard ? [hard] : [];
  if (soft && !softFailed) {
    if (stale.length && s.seq - (s.exploreSeq || 0) > FAIR_STALE_TURNS) {
      s.exploreSeq = s.seq;
      stale.push(soft); // explore: stale members first, Jev pick right after them
    } else head = [soft];
  }
  persistFairness(comboName, s);
  return [...head, ...stale, ...ok, ...err];
}

function rotateModelsFromIndex(models, currentIndex) {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(models, comboName, strategy, stickyLimit = 1) {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const existingState = comboRotationState.get(rotationKey);
  const state = typeof existingState === "number"
    ? { index: existingState, consecutiveUseCount: 0 }
    : (existingState || { index: 0, consecutiveUseCount: 0 });

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName) {
  if (comboName) {
    comboRotationState.delete(comboName);
    clearStickyComboSession(comboName);
  } else {
    comboRotationState.clear();
    clearStickyComboSession();
  }
}

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr, combosData) {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;
  
  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  
  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Detect whether a 2xx JSON response contains zero usable content
 * (e.g. empty assistant message with in_progress/incomplete)
 * so combo fallback can continue to the next model.
 */
export function isZeroContentResponse(data) {
  if (!data || typeof data !== "object") return false;

  // OpenAI chat format
  if (Array.isArray(data.choices)) {
    if (data.choices.length === 0) return true;
    const choice = data.choices[0];
    if (!choice) return true;

    const msg = choice.message || choice.delta;
    const content = msg?.content;
    const hasContent = typeof content === "string" ? content.trim().length > 0 : (Array.isArray(content) && content.length > 0);
    const hasToolCalls = (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) || Boolean(msg?.function_call);
    const hasReasoning = typeof msg?.reasoning_content === "string" ? msg.reasoning_content.trim().length > 0 : false;

    const finish = choice.finish_reason;
    const isNormalFinish = finish === "stop" || finish === "length" || finish === "tool_calls" || finish === "function_call";

    if (!hasContent && !hasToolCalls && !hasReasoning && (!isNormalFinish || finish === "in_progress" || finish === "incomplete")) {
      return true;
    }
  }

  // Anthropic messages format
  if (Array.isArray(data.content)) {
    const hasContent = data.content.some((c) => (c.type === "text" && c.text?.trim().length > 0) || c.type === "tool_use");
    const stopReason = data.stop_reason;
    if (!hasContent && (!stopReason || stopReason === "in_progress" || stopReason === "incomplete")) {
      return true;
    }
  }

  return false;
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback", "round-robin", or "smart"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @param {boolean} [options.autoSwitch=true] - Capability auto-switching
 * @param {string|null} [options.sessionId=null] - Client session identifier for prompt cache retention
 * @param {string} [options.smartPolicy="smart"] - Policy: "smart" (adaptive ≥80%), "strict" (lock 1st model), "per-turn", or "custom"
 * @param {boolean} [options.sessionSticky=true] - Keep chosen model across session requests to retain prompt cache
 * @param {number} [options.confidenceThreshold=0.7] - Minimum (tier-grouped) confidence required for model switch (0-1)
 * @param {number} [options.smartWaitMs=SMART_WAIT_MS] - Max wait for the router before using sticky/default order
 * @param {Function|null} [options.resolveSmartChoice=null] - Smart router resolver callback: (body, models) => Promise<{ choice, probabilities, confidence } | null>
 * @returns {Promise<Response>}
 */
export async function handleComboChat({
  body,
  models,
  handleSingleModel,
  log,
  comboName,
  comboStrategy,
  comboStickyLimit = 1,
  autoSwitch = true,
  sessionId = null,
  smartPolicy = "smart",
  sessionSticky = true,
  confidenceThreshold = 0.7,
  resolveSmartChoice = null,
  smartWaitMs = SMART_WAIT_MS,
  oneTurn = null,
  fallbackPool = [],
  forceModel = null,
  shuffle = false,
}) {
  // Shuffle first so equal-ranked members (and the no-answer fallback) vary per turn.
  const fair = shuffle && (comboStrategy === "smart" || comboStrategy === "fallback");
  if (fair) models = shuffleModels(models);
  let rotatedModels = models;
  let activeStickyModel = null;
  let jevPick = null; // per-turn Jev choice: soft head for fairness

  if (comboStrategy === "smart") {
    // One-turn escalation targets (e.g. team/council): only run when Jev picks them, never
    // become the session sticky (keeps the warm cache), never used as plain fallbacks.
    const oneTurnSet = new Set(Array.isArray(oneTurn?.models) ? oneTurn.models.filter((m) => models.includes(m)) : []);
    const oneTurnThreshold = Number.isFinite(oneTurn?.threshold) ? oneTurn.threshold : 0.4;
    if (oneTurnSet.size) rotatedModels = models = models.filter((m) => !oneTurnSet.has(m));
    const policy = (typeof smartPolicy === "string" ? smartPolicy : "smart").toLowerCase();
    const isPerTurn = policy === "per-turn" || sessionSticky === false;
    const isStrict = policy === "strict";

    let switchThreshold = 0.7;
    if (policy === "smart-switch-90") switchThreshold = 0.9;
    else if (policy === "custom" || policy.startsWith("smart-switch") || policy === "smart") {
      const custom = Number(confidenceThreshold);
      if (Number.isFinite(custom) && custom > 0) switchThreshold = custom > 1 ? custom / 100 : custom; // accept 70 as 70%
    }

    // Single exit point for "stay on this model": pins it first, keeps the rest in order.
    const pin = (model) => [model, ...models.filter((m) => m !== model)];

    if (!isPerTurn && sessionId) {
      activeStickyModel = getStickyComboModel(comboName, sessionId, models);
    }

    // Late Jev answer: remember it for this session's next turn (unless the current
    // sticky model is already in the chosen tier — keep its warm prompt cache).
    const onLate = (r) => {
      if (isPerTurn || !sessionId || !r?.choice || !models.includes(r.choice)) return; // one-turn picks never stick
      if (typeof r.confidence !== "number" || r.confidence < switchThreshold) return;
      const current = getStickyComboModel(comboName, sessionId, models);
      if (current === r.choice || (r.peers || []).includes(current)) return;
      setStickyComboModel(comboName, sessionId, r.choice);
      log.info("COMBO", `smart-router late decision → ${r.choice} for next turn (confidence: ${r.confidence})`);
    };

    if (forceModel && models.includes(forceModel)) {
      // Forced lane (X-Jev-Lane / X-Jev-Model): skip Jev, pin the forced model first.
      rotatedModels = pin(forceModel);
      log.info("COMBO", `smart-router [forced] ${forceModel} (lane override)`);
    } else if (activeStickyModel && isStrict) {
      // Strict Lock: re-use sticky model without invoking System One (0ms, 0 extra tokens)
      rotatedModels = pin(activeStickyModel);
      log.info("COMBO", `smart-router [strict] locked session "${sessionId}" → ${activeStickyModel}`);
    } else if (typeof resolveSmartChoice === "function") {
      try {
        const candidates = oneTurnSet.size ? [...models, ...oneTurnSet] : models;
        const smartResult = await raceSmartChoice(resolveSmartChoice(body, candidates), onLate, smartWaitMs);
        const choice = smartResult?.choice;
        const conf = typeof smartResult?.confidence === "number" ? smartResult.confidence : null;
        let escalated = false;
        if (oneTurnSet.has(choice) && (conf === null || conf >= oneTurnThreshold)) {
          const allowed = typeof oneTurn?.consume === "function" ? await Promise.resolve(oneTurn.consume(choice)).catch(() => true) : true;
          if (allowed) {
            const base = activeStickyModel ? pin(activeStickyModel) : models;
            rotatedModels = [choice, ...base];
            escalated = true;
            log.info("COMBO", `smart-router one-turn escalation → ${choice} (confidence: ${conf ?? "N/A"}); session stays on ${activeStickyModel || "default order"}`);
          } else {
            log.info("COMBO", `smart-router escalation budget for ${choice} used up, staying on regular models`);
          }
        }
        const sameTier = activeStickyModel && (smartResult?.peers || []).includes(activeStickyModel);
        const valid = choice && models.includes(choice);
        const confident = conf !== null && conf >= switchThreshold;

        if (escalated) {
          // handled above
        } else if (activeStickyModel) {
          // Smart Switch (Adaptive): only move off the sticky model when Jev is confident
          // the task changed to a different tier; otherwise keep the warm prompt cache.
          if (valid && confident && choice !== activeStickyModel && !sameTier) {
            rotatedModels = orderModelsByChoice(models, smartResult);
            log.info("COMBO", `smart-router [smart-switch] task changed → switched from ${activeStickyModel} to ${choice} (confidence: ${conf} >= ${switchThreshold})`);
            setStickyComboModel(comboName, sessionId, choice);
            activeStickyModel = choice;
          } else {
            rotatedModels = pin(activeStickyModel);
            log.info("COMBO", `smart-router [smart-switch] retained prompt cache model "${activeStickyModel}"`);
          }
        } else if (valid && !oneTurnSet.has(choice)) {
          // First pick has no warm cache to protect, so Jev's choice always wins; the threshold
          // only gates switching away from a sticky model (above).
          // Turn 1 or per-turn: evaluate System One to select initial model
          rotatedModels = orderModelsByChoice(models, smartResult);
          log.info("COMBO", `smart-router selected ${choice} (confidence: ${conf ?? "N/A"})`);
          if (isPerTurn) jevPick = choice;
          if (!isPerTurn && sessionId) {
            setStickyComboModel(comboName, sessionId, choice);
            activeStickyModel = choice;
          }
        } else {
          log.info("COMBO", choice
            ? `smart-router confidence (${conf}) below threshold (${switchThreshold}), fallback to order: [${models.join(", ")}]`
            : `smart-router no decision, fallback to order: [${models.join(", ")}]`);
        }
      } catch (err) {
        // Fail open: stay on the sticky model if we have one, else default order.
        if (activeStickyModel) rotatedModels = pin(activeStickyModel);
        log.warn("COMBO", `smart-router error, ${activeStickyModel ? `retained model "${activeStickyModel}"` : `fallback to order: [${models.join(", ")}]`}`, { error: err?.message || String(err) });
      }
    } else if (activeStickyModel) {
      rotatedModels = pin(activeStickyModel);
    }
  } else {
    // Apply rotation strategy if enabled
    rotatedModels = getRotatedModels(models, comboName, comboStrategy, comboStickyLimit);
    if (forceModel && models.includes(forceModel)) rotatedModels = [forceModel, ...rotatedModels.filter((m) => m !== forceModel)];
  }

  // Fairness: stale members jump ahead, recently-failed ones drop to the end;
  // forced/sticky model stays first so lane overrides and prompt cache hold.
  // Per-turn: Jev's pick becomes the soft head (stays first unless stale exploration).
  if (fair) {
    await hydrateComboFairness(comboName);
    const head = forceModel && models.includes(forceModel) ? forceModel : activeStickyModel;
    rotatedModels = fairnessOrdered(rotatedModels, comboName, head, jevPick);
  }

  // Auto-switch: float models that satisfy the request's required capabilities to the front.
  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }
  }
  
  // Last resort: pool models run only after every combo model failed (never rotated in).
  const extra = (fallbackPool || []).filter((m) => !rotatedModels.includes(m));
  if (extra.length) rotatedModels = [...rotatedModels, ...extra];

  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;
  let requestScopedResult = null;
  const trace = startComboTrace(comboName, comboStrategy, rotatedModels);

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);
    trace.trying(i);

    try {
      const result = await trace.run(i, () => handleSingleModel(body, modelStr));
      
      // Success (2xx). A 2xx is necessary but NOT sufficient: Gemini aborts (e.g.
      // MALFORMED_FUNCTION_CALL) still return 200 and stream empty content, which would
      // otherwise be delivered as a successful empty answer with no failover.
      // Peek the stream for real content before committing to this candidate.
      if (result.ok) {
        let peeked = null;
        try {
          peeked = await peekComboResponse(result, log);
        } catch (peekErr) {
          // peekStreamForContent is written not to throw; if reconstruction/Response
          // construction ever does, result.body is already locked by getReader() and can no
          // longer be streamed. Returning `result` would hand the client a locked, unreadable
          // body. Degrade to a clean, valid (empty) SSE stream instead.
          log.warn("COMBO", `empty-peek error on ${modelStr}, returning empty SSE: ${peekErr?.message || peekErr}`);
          trace.finish(i, 200, "empty-peek error");
          return new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          });
        }

        if (!peeked) {
          // Non-streaming (or non-SSE) response — not this peek's job. The zero-content
          // JSON check still applies on a non-final seat.
          const isLastModel = i === rotatedModels.length - 1;
          if (!isLastModel) {
            const contentType = result.headers?.get?.("content-type") || "";
            if (contentType.includes("application/json")) {
              try {
                const peekBody = await result.clone().json();
                if (isZeroContentResponse(peekBody)) {
                  log.warn("COMBO", `Model ${modelStr} returned HTTP 200 with zero usable content, falling back to next model`);
                  if (comboStrategy === "smart" && sessionId && modelStr === activeStickyModel) {
                    clearStickyComboSession(comboName, sessionId);
                  }
                  lastError = "Zero usable content";
                  lastStatus = 200;
                  if (fair) markComboMember(comboName, modelStr, true);
                  trace.failed(i, 200, lastError);
                  continue;
                }
              } catch {
                // Ignore JSON parse errors
              }
            }
          }

          log.info("COMBO", `Model ${modelStr} succeeded`);
          if (fair) markComboMember(comboName, modelStr);
          trace.answered(i);
          return result;
        }

        if (peeked.outcome === "content") {
          log.info("COMBO", `Model ${modelStr} succeeded${peeked.timedOut ? " (peek deadline; committed)" : ""}`);
          if (fair) markComboMember(comboName, modelStr);
          trace.answered(i);
          return peeked.response;
        }

        // Empty generation. Fall through to the next candidate unless this is a legitimately
        // empty class (content filter) or the last candidate — in which case return the
        // (empty) response as-is, preserving prior behaviour rather than manufacturing a 5xx.
        const reasonLabel = peeked.finishReason || "no-content";
        const isLast = i === rotatedModels.length - 1;
        if (isNoRetryFinish(peeked.finishReason) || isLast) {
          log.warn("COMBO", `Model ${modelStr} returned empty (${reasonLabel}) — ${isNoRetryFinish(peeked.finishReason) ? "no-retry class" : "last candidate"}, returning as-is`);
          trace.finish(i, 200, `empty (${reasonLabel})`);
          return peeked.response;
        }

        log.warn("COMBO", `Model ${modelStr} returned empty (${reasonLabel}) — falling through to next candidate`);
        if (comboStrategy === "smart" && sessionId && modelStr === activeStickyModel) {
          clearStickyComboSession(comboName, sessionId);
        }
        // Drain/close the discarded stream in the background so its usage logging still runs.
        peeked.response.body?.cancel?.().catch(() => {});
        lastError = `empty generation (${reasonLabel})`;
        if (fair) markComboMember(comboName, modelStr, true);
        trace.failed(i, 200, lastError);
        if (!lastStatus) lastStatus = 502;
        continue;
      }

      // If the model that failed was the session-sticky model, clear it so next turns re-evaluate
      if (comboStrategy === "smart" && sessionId && modelStr === activeStickyModel) {
        clearStickyComboSession(comboName, sessionId);
      }

      // Extract error info from response
      let errorText = result.statusText || "";
      let retryAfter = null;
      try {
        const errorBody = await result.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
      } catch {
        // Ignore JSON parse errors
      }

      // Track earliest retryAfter across all combo models
      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      // Normalize error text to string (Worker-safe)
      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      // Check if should fallback to next model
      const { provider } = parseModel(modelStr);
      const { shouldFallback, cooldownMs, requestScoped } = checkFallbackError(result.status, errorText, 0, provider);

      if (!shouldFallback && !requestScoped) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        trace.finish(i, result.status, errorText);
        return result;
      }

      // A request-scoped 4xx (validation failure, unsupported parameter, context
      // overflow) says this member cannot serve THIS request — not that the
      // credential is unhealthy. Members run on different providers with
      // different validation, so the next member may well serve it. Advance
      // without a cooldown, and without waiting: there is nothing to recover.
      // checkFallbackError() reports no account fallback here on purpose (a
      // request-scoped fault must not evict a healthy account from rotation).
      if (requestScoped) {
        log.warn("COMBO", `Model ${modelStr} rejected the request (${result.status}), trying next`, { status: result.status });
        lastError = errorText || String(result.status);
        if (!lastStatus) lastStatus = result.status;
        if (!requestScopedResult) requestScopedResult = result;
        if (fair) markComboMember(comboName, modelStr, true);
        trace.failed(i, result.status, errorText);
        continue;
      }

      // For transient errors (503/502/504), wait for cooldown before falling through
      // so a briefly-overloaded provider gets a chance to recover rather than being
      // skipped immediately (fixes: combo falls through on transient 503)
      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      // Fallback to next model
      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      if (fair) markComboMember(comboName, modelStr, true);
      trace.failed(i, result.status, errorText);
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error) {
      // Catch unexpected exceptions to ensure fallback continues
      if (comboStrategy === "smart" && sessionId && modelStr === activeStickyModel) {
        clearStickyComboSession(comboName, sessionId);
      }
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      if (fair) markComboMember(comboName, modelStr, true);
      trace.failed(i, 500, lastError);
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  // At least one member rejected the request itself. Hand back that member's own
  // response — status and body — rather than the synthesized envelope below: the
  // synthesized one reaches the client as a 200 carrying an error object, which
  // reads as an empty success, and it buries the member that named the real cause.
  // This is also what the caller saw before combos advanced on these errors.
  trace.finish(null);
  if (requestScopedResult) {
    log.warn("COMBO", `No model served the request; returning the first request-scoped failure (${requestScopedResult.status})`);
    return requestScopedResult;
  }

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Extract assistant text from a non-stream completion across formats
 * (OpenAI chat, Claude messages, Gemini, OpenAI Responses). Returns "" if none.
 * Panel responses are already translated to the client format by chatCore, so the
 * leaf content→string step reuses the translator's own extractTextContent.
 */
function extractPanelText(json) {
  if (!json || typeof json !== "object") return "";

  // OpenAI chat completion
  const choice = json.choices?.[0];
  if (choice) {
    const msg = choice.message ?? choice.delta ?? {};
    const t = extractTextContent(msg.content);
    if (t.trim()) return t;
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  // Claude messages (text blocks share OpenAI's {type:"text"} shape)
  const claudeText = extractTextContent(json.content);
  if (claudeText.trim()) return claudeText;

  // Gemini (parts carry .text without a type discriminator)
  const parts = json.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts.map((p) => p?.text || "").join("");
    if (t.trim()) return t;
  }

  // OpenAI Responses API
  if (Array.isArray(json.output)) {
    const t = json.output
      .flatMap((o) => (Array.isArray(o.content) ? o.content.map((c) => c?.text || "") : []))
      .join("");
    if (t.trim()) return t;
  }

  return "";
}

/**
 * Append a synthesized user turn to whichever message array the request format uses.
 * Preserves the original conversation + system prompt so the judge has full context.
 */
function appendUserTurn(body, text) {
  const next = { ...body };
  if (Array.isArray(body.messages)) {
    next.messages = [...body.messages, { role: "user", content: text }];
  } else if (Array.isArray(body.input)) {
    next.input = [...body.input, { role: "user", content: text }];
  } else if (Array.isArray(body.contents)) {
    next.contents = [...body.contents, { role: "user", parts: [{ text }] }];
  } else {
    next.messages = [{ role: "user", content: text }];
  }
  return next;
}

/**
 * Build the judge directive. Per OpenRouter's Fusion design, the judge does NOT
 * merge — it analyzes (consensus / contradictions / partial coverage / unique
 * insights / blind spots) then writes one answer grounded in that analysis.
 * ~3/4 of fusion's quality lift comes from this synthesis step.
 *
 * Sources are anonymized ("Source N") so the judge weighs substance, not the
 * reputation of a model brand.
 */
function buildJudgePrompt(answers) {
  const panel = answers
    .map((a, i) => `[Source ${i + 1}]\n${a.text}`)
    .join("\n\n");

  return [
    `You are the JUDGE in a model-fusion panel. ${answers.length} expert models independently answered the user's most recent request. Their responses are below, anonymized by source.`,
    "",
    "Do NOT mention that multiple models were used, and do NOT refer to the sources. Produce ONE authoritative final answer addressed directly to the user.",
    "",
    "First, internally analyze the panel along these dimensions: consensus (points most sources agree on — treat as higher-confidence), contradictions (where they disagree — resolve with your own judgment), partial coverage, unique insights only one source surfaced, and blind spots every source missed. Then write the best possible final answer grounded in that analysis — more complete and correct than any single response, with no filler.",
    "",
    "=== PANEL RESPONSES ===",
    panel,
    "=== END PANEL RESPONSES ===",
    "",
    "Now write the final answer to the user's original request.",
  ].join("\n");
}

// Fusion tuning. Overridable per-combo via settings.comboStrategies[name].

// Short-lived cooldown for panel models that just returned 429/503, so a later fusion
// run does not keep hammering a rate-limited upstream. In-memory, per process.
const PANEL_COOLDOWN_MS = 5 * 60 * 1000;
const panelCooldown = new Map();
function isPanelCoolingDown(model) { return (panelCooldown.get(model) || 0) > Date.now(); }
function markPanelCooldown(model) { panelCooldown.set(model, Date.now() + PANEL_COOLDOWN_MS); }
export function clearPanelCooldown() { panelCooldown.clear(); }

const FUSION_DEFAULTS = {
  minPanel: 2,             // answers needed before stragglers get a grace window
  stragglerGraceMs: 8000,  // wait this long for laggards once quorum is reached
  panelHardTimeoutMs: 90000, // absolute cap so one hung model can't stall forever
};

// Resolve a Response (or {__error}) within ms; the loser keeps running but is ignored.
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), ms);
    Promise.resolve(promise)
      .then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); resolve({ __error: e }); });
  });
}

/**
 * Collect panel responses with quorum-grace: as soon as `minPanel` calls succeed,
 * start a short grace timer for the rest, then proceed with whatever arrived. This
 * caps the straggler penalty (the slowest model otherwise dominates wall time) while
 * still preferring a full panel when everyone is fast. Bounded by a hard timeout.
 * Returns a sparse array aligned to `calls` (undefined = not yet / dropped).
 */
function collectPanel(calls, { minPanel, stragglerGraceMs, panelHardTimeoutMs }) {
  return new Promise((resolve) => {
    const out = new Array(calls.length);
    let settled = 0;
    let ok = 0;
    let finished = false;
    let graceTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(out);
    };
    const hardTimer = setTimeout(finish, panelHardTimeoutMs);
    calls.forEach((p, i) => {
      Promise.resolve(p)
        .then((v) => { out[i] = v; })
        .catch((e) => { out[i] = { __error: e }; })
        .finally(() => {
          settled++;
          if (out[i] && out[i].ok) ok++;
          if (settled === calls.length) return finish();
          if (ok >= minPanel && !graceTimer) graceTimer = setTimeout(finish, stragglerGraceMs);
        });
    });
  });
}

/**
 * Handle a fusion combo: fan the prompt out to every panel model in parallel,
 * then a judge model synthesizes one final answer from all panel responses.
 *
 * Panel calls are forced non-streaming with tools stripped (the judge needs
 * complete prose to synthesize). The judge call keeps the client's original
 * stream flag + tools, so streaming and downstream tool use still work.
 *
 * Speed: quorum-grace collection caps the straggler penalty. Quality: the judge
 * runs the consensus/contradiction/blind-spot analysis before writing.
 *
 * Degrades gracefully: 0 panel answers -> 503, exactly 1 -> return it directly.
 *
 * @param {Object} options
 * @param {Object} options.body - Request body (client format)
 * @param {string[]} options.models - Panel model strings
 * @param {Function} options.handleSingleModel - (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger
 * @param {string} [options.comboName] - Combo name (logging)
 * @param {string} [options.judgeModel] - Judge model; falls back to panel[0]
 * @param {Object} [options.tuning] - Override FUSION_DEFAULTS (minPanel, grace, timeout)
 * @returns {Promise<Response>}
 */
// A new user prompt, not a tool-result step of an agent loop.
function isFreshUserTurn(body) {
  const turn = body.messages || body.input || body.contents;
  const last = Array.isArray(turn) ? turn[turn.length - 1] : null;
  return last?.role === "user" && !(Array.isArray(last.content) && last.content.some((c) => c?.type === "tool_result"));
}

export async function handleFusionChat({ body, models, handleSingleModel, log, comboName, judgeModel, tuning }) {
  const panel = Array.isArray(models) ? models.filter(Boolean) : [];
  if (panel.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Fusion combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // A single-model fusion has nothing to fuse — just answer directly.
  if (panel.length === 1) {
    return handleSingleModel(body, panel[0]);
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0];
  // Opt-in (fusionTuning.freshTurnsOnly): in an agent tool loop the panel already deliberated
  // on the user turn, so tool-result steps go to the judge alone instead of re-running the panel.
  if (cfg.freshTurnsOnly && !isFreshUserTurn(body)) return handleSingleModel(body, judge);
  log.info("FUSION", `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`);

  // 1. Fan out to the panel in parallel: non-streaming, tools stripped (we want prose).
  const { tools, tool_choice, stream_options, ...rest } = body;
  // Fusion runs panel models non-streaming; drop stream_options too, or providers
  // like DeepSeek reject it with "stream_options should be set along with stream = true".
  // See issue #3024.
  const panelBody = { ...rest, stream: false };

  // Flatten tool turns to prose so panel models keep context without emitting tool_calls.
  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages);
  } else if (Array.isArray(panelBody.input)) {
    panelBody.input = flattenToolHistory(panelBody.input);
  }

  const t0 = Date.now();
  // Skip panel models currently cooling down; if that empties the panel, fall back to all.
  const activePanel = panel.filter((m) => !isPanelCoolingDown(m));
  const runPanel = activePanel.length >= 2 ? activePanel : panel;
  const calls = runPanel.map((m) => withTimeout(handleSingleModel(panelBody, m, true), cfg.panelHardTimeoutMs));
  const settled = await collectPanel(calls, { ...cfg, minPanel });
  log.info("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  // 2. Collect successful answers.
  const answers = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const model = runPanel[i];
    if (!res) { log.warn("FUSION", `Panel ${model} dropped (straggler/timeout)`); continue; }
    if (res.__timeout) { log.warn("FUSION", `Panel ${model} timed out`); continue; }
    if (res.__error) { log.warn("FUSION", `Panel ${model} threw`, { error: res.__error?.message || String(res.__error) }); continue; }
    if (!res.ok) { log.warn("FUSION", `Panel ${model} failed`, { status: res.status }); if (res.status === 429 || res.status === 503) markPanelCooldown(model); continue; }
    try {
      const json = await res.clone().json();
      const text = extractPanelText(json);
      if (text) {
        answers.push({ model, text });
        log.info("FUSION", `Panel ${model} ok (${text.length} chars)`);
      } else {
        log.warn("FUSION", `Panel ${model} returned empty content`);
      }
    } catch (e) {
      log.warn("FUSION", `Panel ${model} unparseable`, { error: e.message || String(e) });
    }
  }

  // 3. Degrade gracefully when the panel is too thin to fuse.
  if (answers.length === 0) {
    log.warn("FUSION", "All panel models failed");
    return new Response(
      JSON.stringify({ error: { message: "All fusion panel models failed" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (answers.length === 1) {
    log.info("FUSION", `Only ${answers[0].model} succeeded — answering directly (no fusion)`);
    return handleSingleModel(body, answers[0].model);
  }

  // 4. Judge analyzes + writes one final answer (streams to client if requested).
  const judgeBody = appendUserTurn(body, buildJudgePrompt(answers));
  log.info("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return handleSingleModel(judgeBody, judge);
}

// Orchestrate tuning. Overridable per-combo via settings.comboStrategies[name].orchestrateTuning.
// reviewRounds: planner checks worker results and resends rejected ones with feedback (capped at 2).
// maxTokens: rough input-token budget (chars/4) for one orchestrated turn; 0 = unlimited.
const ORCHESTRATE_DEFAULTS = {
  maxSubtasks: 4,
  plannerTimeoutMs: 60000,
  workerTimeoutMs: 120000,
  reviewRounds: 0,
  maxTokens: 0,
};

// ponytail: chars/4 estimate, not a tokenizer; good enough for a budget guard.
const estTokens = (v) => Math.ceil((typeof v === "string" ? v : JSON.stringify(v ?? "")).length / 4);

// profiles: { model: "role: X; cost: tier; ..." | null } from llmStats, so the planner assigns by capability.
function buildPlannerPrompt(max, workers, profiles = {}) {
  const list = workers.map((w) => (profiles[w] ? `- ${w} (${profiles[w]})` : `- ${w}`)).join("\n");
  return [
    "You are the PLANNER of a multi-agent team. Decide whether the user's latest request benefits from being split into independent subtasks that worker models solve in parallel (research angles, separate components, alternatives to compare).",
    `Available workers (pick the one whose role fits; prefer cheaper ones for simple subtasks):\n${list}\nWorkers see ONLY their instruction, not this conversation, so put every needed fact into it. Never include secrets, API keys or credentials.`,
    `Reply with ONLY a JSON object: {"subtasks":[{"title":"...","worker":"one of the available workers","instruction":"self-contained instruction with all needed context"}]} using 2-${max} subtasks, or {"subtasks":[]} when the request is simple, conversational, or not parallelizable.`,
  ].join("\n");
}

// Lenient: planners wrap JSON in prose or fences. Anything unparseable yields `fallback`.
function parseJsonObject(text) {
  const m = typeof text === "string" ? text.match(/\{[\s\S]*\}/) : null;
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function parsePlan(text, max, workers = []) {
  const list = parseJsonObject(text)?.subtasks;
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.instruction === "string" && s.instruction.trim())
    .slice(0, max)
    .map((s, i) => ({
      title: String(s.title || `Subtask ${i + 1}`),
      instruction: s.instruction.trim(),
      worker: workers.includes(s.worker) ? s.worker : workers[i % workers.length],
    }));
}

// Worker sees only its instruction: no history, no client system prompt (keeps context small,
// avoids leaking the conversation and provider-specific history fields like reasoning_content).
function isolatedTurn(base, text) {
  const { system, instructions, systemInstruction, ...b } = base;
  for (const k of ["messages", "input", "contents"]) if (Array.isArray(b[k])) b[k] = [];
  return appendUserTurn(b, text);
}

function buildWorkerPrompt(s, feedback) {
  const lines = [`You are a WORKER on a team. Do ONLY this task and return the result, no preamble.\n\nTask: ${s.title}\n${s.instruction}`];
  if (feedback) lines.push(`\nYour previous answer was rejected by the reviewer:\n${feedback}\nFix it and return the full corrected result.`);
  return lines.join("\n");
}

function buildReviewPrompt(results) {
  const body = results.map((r, i) => `[${i}] ${r.title}\n${r.text}`).join("\n\n");
  return [
    "You are the REVIEWER. Check each worker result below against the subtask you planned for the user's request.",
    'Reply with ONLY a JSON object: {"retry":[{"index":0,"feedback":"what is wrong and what to fix"}]} listing results that are wrong, incomplete or off-task, or {"retry":[]} when all are acceptable.',
    "",
    "=== WORKER RESULTS ===",
    body,
    "=== END WORKER RESULTS ===",
  ].join("\n");
}

function buildSynthesisPrompt(results) {
  const body = results.map((r) => `[${r.title}]\n${r.text}`).join("\n\n");
  return [
    "Your team of workers finished the subtasks you planned. Their results are below.",
    "Do NOT mention workers or subtasks. Verify the results, resolve conflicts with your own judgment, fill gaps, then write ONE complete final answer to the user's original request.",
    "",
    "=== WORKER RESULTS ===",
    body,
    "=== END WORKER RESULTS ===",
  ].join("\n");
}

const TOOL_RESULT_THRESHOLD = 6000;
const toolResultCache = new Map();

function toolResultText(msg) {
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) return msg.content.map((p) => p?.text || "").join("\n");
  if (msg?.content != null) return JSON.stringify(msg.content);
  return "";
}

async function summarizeOne(text, handleSingleModel, model) {
  const prompt = [
    "Summarize the following tool result for a planner agent.",
    "Return ONLY JSON: {\"summary\":\"...\",\"keyFacts\":[\"...\"],\"verbatim\":[\"critical lines verbatim\"]}.",
    "Keep error messages, stack traces, file paths, numbers and identifiers verbatim in `verbatim`.",
    "If the summary is insufficient, the caller may request the full content by emitting [NEED_FULL:<handle>].",
    "",
    "=== TOOL RESULT ===",
    text.slice(0, 40000),
    "=== END ===",
  ].join("\n");
  try {
    const res = await handleSingleModel({ messages: [{ role: "user", content: prompt }], stream: false }, model, true);
    if (!res?.ok) return null;
    const j = await res.clone().json().catch(() => null);
    const txt = extractPanelText(j);
    const parsed = parseJsonObject(txt);
    if (parsed?.summary) return parsed;
  } catch {}
  return null;
}

async function summarizeLargeToolResults(body, handleSingleModel, model, log, sessionId = null) {
  let clone;
  try { clone = JSON.parse(JSON.stringify(body || {})); } catch { clone = body ? { ...body } : {}; }
  const keys = ["messages", "input", "contents"];
  for (const k of keys) {
    const arr = clone?.[k];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const m = arr[i];
      const t = toolResultText(m);
      if (t.length <= TOOL_RESULT_THRESHOLD) continue;
      const handle = `tr:${sessionId || "anon"}:${Date.now()}:${i}`;
      toolResultCache.set(handle, t);
      const parsed = await summarizeOne(t, handleSingleModel, model);
      const replacement = parsed
        ? `SUMMARY: ${parsed.summary}\nKEY FACTS: ${(parsed.keyFacts || []).join("; ")}\nVERBATIM:\n${(parsed.verbatim || []).join("\n")}\n[FULL CONTENT CACHED AS ${handle}; length=${t.length}]`
        : `TOOL RESULT (truncated, full cached as ${handle}):\n${t.slice(0, 1500)}\n...\n${t.slice(-1500)}`;
      if (typeof m.content === "string") m.content = replacement;
      else if (Array.isArray(m.content)) m.content = [{ type: "text", text: replacement }];
      else m.content = replacement;
      log?.info?.("ORCHESTRATE", `Summarized large tool result ${t.length} -> ${replacement.length} (handle ${handle})`);
    }
  }
  return clone;
}

/**
 * Handle an orchestrate combo: a planner splits the request into subtasks and assigns
 * each to a combo model (round-robin when it names none/an unknown one), workers solve
 * them in parallel seeing only their instruction, the planner optionally reviews and
 * resends rejected results, then synthesizes.
 *
 * Only a fresh user turn is orchestrated; tool-result turns of an agent loop go
 * straight to the planner so one task is planned once, not every tool step.
 * Planner/worker calls are non-streaming and tool-free; the final call keeps the
 * client's stream flag + tools. Any planning/worker failure degrades to the planner
 * answering directly.
 *
 * @param {Object} options - same shape as handleFusionChat; plannerModel falls back to models[0]
 */
export async function handleOrchestrateChat({ body, models, handleSingleModel, log, comboName, plannerModel, tuning, profiles, sessionId = null }) {
  const workers = Array.isArray(models) ? models.filter(Boolean) : [];
  const planner = plannerModel && plannerModel.trim() ? plannerModel.trim() : workers[0];
  if (!planner) {
    return new Response(
      JSON.stringify({ error: { message: "Orchestrate combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  if (!isFreshUserTurn(body) || workers.length === 0) {
    // B-safe: summarize oversized tool results before the planner reads them,
    // keeping verbatim anchors so critical details are not lost.
    const summarized = await summarizeLargeToolResults(body, handleSingleModel, workers[0], log, sessionId);
    let res = await handleSingleModel(summarized, planner);
    // On-demand expansion: if planner asks for full raw via [NEED_FULL:handle],
    // re-run once with that tool result restored in full.
    try {
      const data = await res.clone().json().catch(() => null);
      const txt = extractPanelText(data) || "";
      const m = txt.match(/\[NEED_FULL:([^\]]+)\]/);
      if (m && toolResultCache.has(m[1])) {
        const full = toolResultCache.get(m[1]);
        const expanded = JSON.parse(JSON.stringify(summarized));
        for (const k of ["messages", "input", "contents"]) {
          const arr = expanded?.[k];
          if (!Array.isArray(arr)) continue;
          for (const msg of arr) {
            const t = toolResultText(msg);
            if (t.includes(m[1])) {
              if (typeof msg.content === "string") msg.content = full;
              else if (Array.isArray(msg.content)) msg.content = [{ type: "text", text: full }];
            }
          }
        }
        res = await handleSingleModel(expanded, planner);
      }
    } catch {}
    return res;
  }

  const cfg = { ...ORCHESTRATE_DEFAULTS, ...(tuning || {}) };
  const { tools, tool_choice, stream_options, ...rest } = body;
  const base = { ...rest, stream: false };
  if (Array.isArray(base.messages)) base.messages = flattenToolHistory(base.messages);
  else if (Array.isArray(base.input)) base.input = flattenToolHistory(base.input);
  const askPlanner = async (prompt) => {
    const res = await withTimeout(handleSingleModel(appendUserTurn(base, prompt), planner, true), cfg.plannerTimeoutMs);
    if (!res?.ok) return "";
    try { return extractPanelText(await res.clone().json()); } catch { return ""; }
  };
  // Budget: plan + synthesis each read the conversation once, each review round once more.
  const budget = Number(cfg.maxTokens) || 0;
  const reviewRounds = Math.min(Number(cfg.reviewRounds) || 0, 2);
  const convCost = estTokens(base.messages || base.input || base.contents) * (2 + reviewRounds);
  if (budget && convCost > budget) {
    log.info("ORCHESTRATE", `Combo "${comboName}" over budget before planning (${convCost} > ${budget}), planner answers directly`);
    return handleSingleModel(body, planner);
  }

  // 1. Plan.
  let subtasks = parsePlan(await askPlanner(buildPlannerPrompt(cfg.maxSubtasks, workers, profiles || {})), cfg.maxSubtasks, workers);
  if (budget) {
    let used = convCost;
    subtasks = subtasks.filter((s) => (used += estTokens(s.instruction)) <= budget);
  }
  log.info("ORCHESTRATE", `Combo "${comboName}" | planner=${planner} | subtasks=${subtasks.length}`);
  if (subtasks.length < 2) return handleSingleModel(body, planner);

  // One trace attempt per subtask (Fallback Chain card); attempt model follows failover.
  const trace = startComboTrace(comboName, "orchestrate", subtasks.map((s) => s.worker));
  const callWorker = (i, s, worker, feedback) => {
    trace.trying(i, worker);
    return withTimeout(trace.run(i, () => handleSingleModel(isolatedTurn(base, buildWorkerPrompt(s, feedback)), worker, true)), cfg.workerTimeoutMs)
      .then(async (res) => {
        if (!res?.ok) {
          const code = res?.__timeout ? 504 : res?.status ?? 500;
          log.warn("ORCHESTRATE", `Worker ${worker} failed on "${s.title}"`, { status: code });
          if (code === 429 || code === 503) markPanelCooldown(worker);
          trace.failed(i, code, res?.__timeout ? "timeout" : res?.__error?.message);
          return null;
        }
        const text = extractPanelText(await res.clone().json().catch(() => null));
        if (!text) { trace.failed(i, 200, "empty"); return null; }
        trace.answered(i, true);
        return { ...s, worker, text };
      });
  };
  // Next combo worker after `from` that is not cooling down; null when there is none.
  const nextWorker = (from) => {
    const start = workers.indexOf(from);
    for (let k = 1; k < workers.length; k++) {
      const w = workers[(start + k) % workers.length];
      if (w !== from && !isPanelCoolingDown(w)) return w;
    }
    return null;
  };
  // Failover: a failed/timed-out worker gets one retry on the next worker.
  const runWorker = async (i, s, feedback, worker = s.worker) => {
    const r = await callWorker(i, s, worker, feedback);
    if (r) return r;
    const alt = nextWorker(worker);
    return alt ? callWorker(i, s, alt, feedback) : null;
  };

  // 2. Fan out to the assigned workers.
  const t0 = Date.now();
  const done = await Promise.all(subtasks.map((s, i) => runWorker(i, s).then((r) => r && { ...r, i })));
  let results = done.filter(Boolean);
  log.info("ORCHESTRATE", `${results.length}/${subtasks.length} subtasks done in ${Date.now() - t0}ms`);
  if (results.length === 0) { trace.end("failed"); return handleSingleModel(body, planner); }

  // 3. Review: rejected results go back with feedback, to the same worker first, then to another
  // worker on the second rejection. A failed retry keeps the old result.
  const rejections = new Map();
  for (let round = 0; round < reviewRounds; round++) {
    const retry = (parseJsonObject(await askPlanner(buildReviewPrompt(results)))?.retry || [])
      .filter((r) => Number.isInteger(r?.index) && results[r.index] && typeof r.feedback === "string");
    log.info("ORCHESTRATE", `Review round ${round + 1}: ${retry.length} rejected`);
    if (retry.length === 0) break;
    const redone = await Promise.all(retry.map((r) => {
      const prev = results[r.index];
      const n = (rejections.get(prev.i) || 0) + 1;
      rejections.set(prev.i, n);
      const worker = n >= 2 ? nextWorker(prev.worker) || prev.worker : prev.worker;
      return runWorker(prev.i, prev, r.feedback, worker).then((x) => x && { ...x, i: prev.i });
    }));
    retry.forEach((r, k) => { if (redone[k]) results[r.index] = redone[k]; });
  }
  trace.end("answered");

  // 4. Synthesize (streams to client if requested).
  return handleSingleModel(appendUserTurn(body, buildSynthesisPrompt(results)), planner);
}

export {
  getStickyComboModel,
  setStickyComboModel,
  clearStickyComboSession,
  orderModelsByChoice,
} from "./systemoneRouter.js";
