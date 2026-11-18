// Shared Pi-skill helpers used by the proxy (auto-inject) and the Jev router.
// One source of truth for scanning ~/.pi/agent/skills + friends and for building
// the injected prompt text.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const SKILL_ROOTS = [".pi/agent/skills", ".claude/skills", ".agents/skills"];
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

let catalogCache = null; // { version, skills: [{ name, description, path }] }

export function clearSkillCatalog() {
  catalogCache = null;
}

export async function getSkillCatalog() {
  if (catalogCache) return catalogCache;
  const skills = [];
  for (const rel of SKILL_ROOTS) {
    const root = path.join(os.homedir(), rel);
    let entries = [];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const name of entries.sort()) {
      const full = path.join(root, name);
      const st = await fs.stat(full).catch(() => null);
      if (!st?.isDirectory()) continue;
      let raw = "";
      try {
        raw = await fs.readFile(path.join(full, "SKILL.md"), "utf-8");
      } catch {
        raw = "";
      }
      skills.push({ name, description: frontmatterDescription(raw).slice(0, 200), path: full });
    }
  }
  const version = createHash("sha256")
    .update(skills.map((s) => s.name + s.description).join("\n"))
    .digest("hex")
    .slice(0, 12);
  catalogCache = { version, skills };
  return catalogCache;
}

export function frontmatterDescription(raw) {
  const m = raw.match(FRONTMATTER_RE);
  const fm = m ? m[1] : "";
  const d = (fm.match(/^description:\s*(.*)$/m) || [])[1];
  if (!d) return "";
  return d.replace(/^["']|["']$/g, "").trim();
}

export async function loadSkillContent(name, maxBytes = 6000) {
  const { skills } = await getSkillCatalog();
  const s = skills.find((x) => x.name === name);
  if (!s) return null;
  let raw = "";
  try {
    raw = await fs.readFile(path.join(s.path, "SKILL.md"), "utf-8");
  } catch {
    return null;
  }
  return raw.length > maxBytes ? raw.slice(0, maxBytes) + "\n…[truncated]" : raw;
}

export function hasClientSkillCatalog(body) {
  const msgs = body?.messages || body?.input;
  if (!Array.isArray(msgs)) return false;
  for (const m of msgs) {
    const c = m?.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p?.text || "").join(" ") : "";
    if (text && /<available_skills\b/i.test(text)) return true;
  }
  return false;
}

// Request -> selected skill prompt text
const skillPrompts = new WeakMap();
export function setSkillPrompt(request, text) {
  if (text) skillPrompts.set(request, text);
}
export function getSkillPrompt(request) {
  return skillPrompts.get(request);
}
export function hasSkillPrompt(request) {
  return skillPrompts.has(request);
}
export function deleteSkillPrompt(request) {
  skillPrompts.delete(request);
}

export async function buildSkillPrompt(names, { maxChars = 8000 } = {}) {
  if (!names?.length) return "";
  const parts = [];
  let total = 0;
  for (const name of names) {
    const content = await loadSkillContent(name);
    if (!content) continue;
    const block = `## ${name}\n\n${content}`;
    if (total + block.length > maxChars) break;
    parts.push(block);
    total += block.length;
  }
  if (!parts.length) return "";
  return `Relevant skills for this task:\n\n${parts.join("\n\n---\n\n")}`;
}

export async function pickSkillsEmbedding(query, { topK = 2, threshold = 0.3 } = {}) {
  const { version, skills } = await getSkillCatalog();
  if (!skills.length) return { names: [], confidence: 0, source: "embedding", catalogVersion: version };
  const { embedText } = await import("@/lib/memory/embed.js");
  const q = await embedText(query);
  if (!q) return { names: [], confidence: 0, source: "embedding", catalogVersion: version };
  const embeds = await Promise.all(skills.map((s) => embedText(`${s.name}: ${s.description}`)));
  const scored = skills
    .map((s, i) => ({ name: s.name, score: cos(q, embeds[i]) }))
    .sort((a, b) => b.score - a.score);
  const picked = scored.filter((x) => x.score >= threshold).slice(0, topK);
  return { names: picked.map((x) => x.name), confidence: picked[0]?.score || 0, source: "embedding", catalogVersion: version };
}

export async function pickSkillsLLM({ query, request, apiKey, topK = 2 }) {
  const { version, skills } = await getSkillCatalog();
  if (!skills.length) return { names: [], confidence: 0, source: "llm", catalogVersion: version };
  const catalogText = skills.map((s) => `- ${s.name}: ${s.description || "(no description)"}`).join("\n");
  const system = `You are a skill selector. Pick up to ${topK} most relevant skill names for the task. Reply ONLY with a JSON array of exact skill names, e.g. ["skill-a"]. No other text.\n\nCatalog:\n${catalogText}`;
  const origin = new URL(request.url).origin;
  let res;
  try {
    res = await fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-9r-skill-pick": "1",
      },
      body: JSON.stringify({
        model: "auto",
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Task: ${query}` },
        ],
        temperature: 0,
        max_tokens: 128,
      }),
    });
  } catch (e) {
    return { names: [], confidence: 0, source: "llm", catalogVersion: version, error: e?.message };
  }
  const data = await res.json().catch(() => ({}));
  const text = (data.choices?.[0]?.message?.content || "").trim();
  let names = [];
  try {
    names = JSON.parse(text);
  } catch {
    names = [];
  }
  const arr = Array.isArray(names) ? names : [];
  names = arr.filter((n) => skills.some((s) => s.name === n)).slice(0, topK);
  return { names, confidence: names.length ? 1 : 0, source: "llm", catalogVersion: version };
}

function cos(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}