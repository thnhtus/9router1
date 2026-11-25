// DOM-based reply capture for the Gemini web client.
//
// The current Gemini web client streams chat turns over batchexecute rpcids
// that Google rotates freely (aPya6c at the time of writing), and those bodies
// cannot be re-read via CDP once the stream finishes. The DOM is the stable
// contract: assistant messages render into `model-response` bubbles, so we
// poll those and emit deltas as the text grows — immune to endpoint churn.

const POLL_INTERVAL_MS = 400;
const STABLE_POLLS_DONE = 5;
// Safety valve: finish even if the thinking overlay never clears (UI change).
const STABLE_POLLS_FORCE = 20;
const FIRST_TOKEN_TIMEOUT_MS = 30000;
const REPLY_TIMEOUT_MS = 60000;

const ASSISTANT_SELECTOR = "model-response, message-content";

const READ_REPLY_STATE = `(() => {
  const msgs = [...document.querySelectorAll(${JSON.stringify(ASSISTANT_SELECTOR)})];
  let last = '';
  let generating = false;
  if (msgs.length) {
    // KaTeX renders formulas as per-glyph spans, so raw innerText explodes one
    // character per line and duplicates the math when MathML + KaTeX both render.
    // Swap each .katex for its LaTeX source (annotation) on a detached clone
    // rendered offscreen, then read the text back — clone gets layout so
    // innerText keeps paragraph breaks.
    const clone = msgs[msgs.length - 1].cloneNode(true);
    Array.from(clone.querySelectorAll('.katex')).forEach((k) => {
      const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent || '';
      k.replaceWith(document.createTextNode(tex ? ' $' + tex + '$ ' : ' ' + (k.textContent || '').trim() + ' '));
    });
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:700px';
    host.appendChild(clone);
    document.body.appendChild(host);
    last = (host.innerText || host.textContent || '').trim();
    host.remove();
  }
  generating = !!document.querySelector('[data-test-id="thinking-overlay-content"], button[aria-label*="Stop" i]');
  return {
    count: msgs.length,
    lastText: last,
    generating,
  };
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Gemini appends follow-up suggestion chips to the answer text. They have no
// stable class we can rely on, so cut the trailing block: a heading line ending
// with ':' or '?' that asks the reader to continue, followed only by short
// title-like lines. Answers that merely contain a "Step 3:" heading keep their
// body because the lines after it are prose, not short titles.
// Chip headings are short prompts that end in "?" (e.g. "Want to see the simple
// science recipe behind photosynthesis?") or ":" (e.g. "Explore related...:").
// A "?" heading is treated as a chip prompt structurally — Gemini only emits
// these as trailing suggestion chips, and requiring a keyword misses novel
// phrasings (e.g. "Want to see...?"). A ":" heading still needs a chip-like
// keyword so ordinary section labels ("Step 3:", "Note:") are not stripped.
const CHIP_HEADING_KEYWORDS = /\b(?:want|see|show|know|learn|explore|verify|extend|generalize|test|practice|quiz|check|try|compare|calculate|more|deeper|further|related|continue|next|also|another)\b/i;

function isChipTitle(line) {
  const t = line.trim();
  return t.length > 0 && t.length <= 110 && !/[.;:]$/.test(t);
}

export function cleanReplyText(text) {
  const lines = (text || "").split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const isQuestion = line.endsWith("?");
    const isColon = line.endsWith(":");
    if (!isQuestion && !isColon) continue;
    if (line.length > 110) continue;
    if (isColon && !CHIP_HEADING_KEYWORDS.test(line)) continue;
    const tail = lines.slice(i + 1).map((l) => l.trim()).filter(Boolean);
    if (tail.length >= 1 && tail.length <= 4 && tail.every(isChipTitle)) {
      return lines.slice(0, i).join("\n").trim();
    }
  }
  return (text || "").trim();
}

export async function readReplyState(page) {
  try {
    const st = (await page.evaluate(READ_REPLY_STATE)) || { count: 0, lastText: "", generating: false };
    return { ...st, lastText: cleanReplyText(st.lastText) };
  } catch {
    // Page navigating mid-poll — treat as "no change yet".
    return { count: 0, lastText: "", generating: false };
  }
}

/**
 * Wait for the assistant reply that follows the just-sent message and return
 * its full text. `onDelta` (when given) receives each incremental chunk as the
 * bubble streams.
 *
 * Interim bubble texts ("Searching the web" …) are replaced wholesale by the
 * real answer while the thinking overlay is up, so deltas are only emitted
 * once the overlay is gone — a client must never receive an interim status as
 * content. Completion: unchanged text for STABLE_POLLS_DONE polls with the
 * overlay gone (STABLE_POLLS_FORCE fires regardless, as a UI-change valve).
 */
export async function waitForGeminiReply({
  page,
  baseCount = 0,
  baseText = "",
  timeoutMs = REPLY_TIMEOUT_MS,
  firstTokenMs = FIRST_TOKEN_TIMEOUT_MS,
  signal,
  onDelta,
}) {
  const started = Date.now();
  let emitted = "";
  let last = null;
  let stable = 0;
  let gotFirst = false;

  while (true) {
    if (signal?.aborted) throw new Error("Request aborted");
    const elapsed = Date.now() - started;
    if (elapsed > timeoutMs) throw new Error("Gemini reply timed out");
    if (!gotFirst && elapsed > firstTokenMs) throw new Error("no first token from Gemini");
    await sleep(POLL_INTERVAL_MS);

    const st = await readReplyState(page);
    const text = st.lastText || "";
    const isNew = st.count > baseCount || (text && text !== baseText);
    if (!isNew || !text) continue;

    gotFirst = true;
    if (text !== last) {
      last = text;
      stable = 0;
    } else {
      stable++;
    }

    if (!st.generating && text !== emitted) {
      const delta = text.startsWith(emitted) ? text.slice(emitted.length) : text;
      if (delta) {
        emitted = text;
        onDelta?.(delta);
      }
    }
    if (stable >= STABLE_POLLS_FORCE) return emitted || text;
    if (!st.generating && stable >= STABLE_POLLS_DONE && text === emitted) return emitted;
  }
}
