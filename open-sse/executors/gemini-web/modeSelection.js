// Per-model Gemini Web UI mode selection + verification.
//
// The executor's real selection step: for each advertised model (and for the
// Extended Thinking control), it tries the corresponding UI control, then READS
// BACK the active-mode indicator to confirm the switch actually took effect
// before the caller is allowed to proceed.
//
// Selectors below were calibrated against a live Gemini Pro account on
// 2026-11-19. The mode picker button carries `aria-label` "Open mode picker,
// currently <Mode>"; opening it reveals a `gem-menu` overlay (test-id
// `gem-mode-menu`) whose items are `gem-menu-item[role="menuitemradio"]`:
//   - Auto (default) → "Adapts to your needs"
//   - Everyday help → "4 Hydrogen"  → picks the Hydrogen mode
//   - Deeper analysis → "4 Neon"     → picks the Neon mode
//   - Code & complex work → "4 Carbon" (test-id ends `upsell_MODE_CATEGORY_ULTRA`)
//     is an UPSELL row — clicking it does NOT switch, so it is never matched.
// The "Thinking level" submenu is three radios: Low / Medium / High.
//
// The design stays fail-closed: a click landing is never treated as success —
// only a confirmed read-back of the aria-label / radio state is. If a selector
// is wrong, the lookup fails and the caller gets a clear 400
// (`unsupported_control_for_provider`) instead of a response silently labeled
// with a model/mode that never actually ran.

const MODE_BUTTON = '[data-test-id="bard-mode-menu-button"]';
const MENU_ITEM = 'gem-menu-item[role="menuitemradio"]';
const THINK_RADIO = 'gem-menu-item[role="menuitemradio"]';

// Model -> Gemini UI mode map for the advertised ids. Keep the two catalogs in
// sync: an advertised model with no entry here fails closed as `unknown_model`.
export const GEMINI_WEB_MODEL_MODES = {
  "gemini-web-auto": {
    id: "gemini-web-auto",
    isDefault: false,
    itemText: /Adapts to your needs/,
    indicatorPattern: /\bAuto\b/i,
  },
  "gemini-web-hydrogen": {
    id: "gemini-web-hydrogen",
    isDefault: false,
    itemText: /Hydrogen/,
    indicatorPattern: /\bHydrogen\b/i,
  },
  "gemini-web-neon": {
    id: "gemini-web-neon",
    isDefault: false,
    itemText: /Neon/,
    indicatorPattern: /\bNeon\b/i,
  },
};

// Pre-calibration gemini-web ids → closest real UI mode (backward compat).
const LEGACY_ALIASES = {
  "gemini-3.1-pro": "gemini-web-auto",
  "gemini-2.5-pro": "gemini-web-auto",
  "gemini-3.7-flash": "gemini-web-hydrogen",
  "gemini-3.1-flash-lite": "gemini-web-auto",
};


// Extended Thinking maps to the "Thinking level" radio most thorough option.
// Eligible accounts expose Low / Medium / High radios; we select High and only
// accept when it confirms as checked.
export const GEMINI_WEB_EXTENDED_THINKING_MODE = {
  id: "extended-thinking",
  isDefault: false,
  radioText: /^High\b/,
};

async function openModePicker(page, timeoutMs) {
  await page.waitForSelector(MODE_BUTTON, { timeout: timeoutMs });
  // Defensive close in case a previous interaction left an overlay/backdrop.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(350);
  await page.click(MODE_BUTTON);
  await page
    .waitForSelector('gem-menu[data-test-id="gem-mode-menu"]', { timeout: timeoutMs })
    .catch(() => null);
}

async function currentModeLabel(page) {
  const aria = await page.getAttribute(MODE_BUTTON, "aria-label").catch(() => null);
  const m = aria && /currently\s+([A-Za-z]+)/i.exec(aria);
  return m ? m[1] : null;
}

/**
 * Try to switch the live Gemini Web page to `descriptor`'s mode, then READ
 * BACK the active-mode indicator before reporting success. A click landing
 * is never itself treated as success — only a confirmed, pattern-matching
 * indicator is.
 */
export async function selectGeminiUiMode(page, descriptor, timeoutMs = 5000) {
  if (descriptor.isDefault) return { confirmed: true, descriptor };

  const { itemText, indicatorPattern } = descriptor;
  if (!itemText || !indicatorPattern) {
    return { confirmed: false, reason: "control_not_found", descriptor };
  }

  await openModePicker(page, timeoutMs);

  const item = page.locator(MENU_ITEM).filter({ hasText: itemText }).first();
  const count = await item.count().catch(() => 0);
  if (!count) return { confirmed: false, reason: "control_not_found", descriptor };

  await item.click({ timeout: timeoutMs }).catch(() => null);

  const label = await currentModeLabel(page);
  if (!label || !indicatorPattern.test(label)) {
    return { confirmed: false, reason: "indicator_mismatch", descriptor };
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(350);
  return { confirmed: true, descriptor };
}

export function resolveGeminiModelMode(modelId) {
  return GEMINI_WEB_MODEL_MODES[modelId] ?? GEMINI_WEB_MODEL_MODES[LEGACY_ALIASES[modelId]] ?? null;
}

/** Select + verify the requested advertised model's Gemini UI mode. */
export async function selectGeminiModel(page, modelId, timeoutMs) {
  const descriptor = resolveGeminiModelMode(modelId);
  if (!descriptor) return { confirmed: false, reason: "unknown_model" };
  return selectGeminiUiMode(page, descriptor, timeoutMs);
}

/** Select + verify the Extended Thinking control. */
export async function selectGeminiExtendedThinking(page, timeoutMs = 5000) {
  const descriptor = GEMINI_WEB_EXTENDED_THINKING_MODE;
  await openModePicker(page, timeoutMs);
  const item = page.locator(THINK_RADIO).filter({ hasText: descriptor.radioText }).first();
  const count = await item.count().catch(() => 0);
  if (!count) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(350);
    return { confirmed: false, reason: "control_not_found", descriptor };
  }
  await item.click({ timeout: timeoutMs }).catch(() => null);
  await page.waitForTimeout(300);
  const checked = await item.getAttribute("aria-checked").catch(() => null);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(350);
  return checked === "true"
    ? { confirmed: true, descriptor }
    : { confirmed: false, reason: "indicator_mismatch", descriptor };
}

const REASON_DETAIL = {
  unknown_model: "it is not one of the advertised, selectable gweb models",
  control_not_found: "the Gemini UI control used to switch modes was not found",
  indicator_not_found: "the active-mode indicator used to confirm the switch was not found",
  indicator_mismatch: "the active-mode indicator did not confirm the switch after attempting it",
};

/**
 * Client-facing explanation for a failed-closed selection, safe to put
 * directly in a response body (no selector text, no stack trace).
 */
export function describeModeSelectionFailure(controlLabel, reason) {
  const detail = (reason && REASON_DETAIL[reason]) || "the switch could not be verified";
  return (
    `Model provider "gemini-web" could not verify that "${controlLabel}" is actually active in ` +
    `the Gemini web UI (${detail}). Rather than silently answering under a model/mode label that ` +
    'may not be accurate, the request was rejected with "unsupported_control_for_provider".'
  );
}
