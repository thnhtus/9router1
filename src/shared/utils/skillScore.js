// Heuristic quality score for a Pi/Claude skill folder, 0-100.
// Signals are structural only (frontmatter, description, body, resources) so the
// score is reproducible and needs no LLM call.

const GRADE = (n) => (n >= 80 ? "A" : n >= 60 ? "B" : "C");

export const RESOURCE_DIRS = ["references", "scripts", "assets", "examples", "templates"];

export const scoreSkill = ({ raw = "", dirName = "", resources = [] } = {}) => {
  const signals = [];
  if (!raw) return { score: 0, grade: "C", signals: ["missing SKILL.md"] };

  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = fmMatch?.[1] || "";
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  const fmValue = (key) => {
    const re = { description: /^description:\s*(.*)$/m, name: /^name:\s*(.*)$/m, license: /^license:\s*(.*)$/m, "allowed-tools": /^allowed-tools:\s*(.*)$/m }[key];
    if (!re) return "";
    return (fm.match(re)?.[1] || "").replace(/^["']|["']$/g, "").trim();
  };

  const description = fmValue("description");
  const fmName = fmValue("name");

  let score = 0;

  if (fm) score += 8;
  else signals.push("no frontmatter");

  if (fmName && fmName === dirName) score += 4;
  else if (fmName) signals.push("name ≠ folder");

  // Description is the only field every agent reads before loading the skill.
  let cap = 100;
  if (!description) {
    signals.push("no description");
    cap = 40;
  } else {
    score += 18;
    if (description.length >= 40) score += 6;
    else signals.push("short description");
    if (description.length >= 120) score += 4;
    if (/\b(use|used|when|trigger|apply)\b/i.test(description)) score += 8;
    else signals.push("no 'use when' trigger");
  }

  const len = body.trim().length;
  if (len >= 400) score += 12;
  if (len >= 1200) score += 6;
  if (len >= 3000) score += 4;
  if (len < 400) signals.push("thin instructions");

  const headings = (body.match(/^#{2,}\s+\S/gm) || []).length;
  if (headings >= 3) score += 6;
  if (headings >= 6) score += 4;
  if (headings < 3) signals.push("few sections");

  if (/```/.test(body)) score += 6;
  else signals.push("no code/example block");

  const extra = resources.filter((r) => RESOURCE_DIRS.includes(r));
  if (extra.length) score += 8;
  else signals.push("no bundled resources");

  if (fmValue("license")) score += 3;
  if (fmValue("allowed-tools")) score += 4;

  const clamped = Math.max(0, Math.min(cap, Math.round(score)));
  return { score: clamped, grade: GRADE(clamped), signals };
};
