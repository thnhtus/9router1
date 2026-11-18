// Detects skills Pi will load twice: the same skill folder name present in more
// than one SKILL_ROOT, and skills whose descriptions are near-identical.
// Pi injects every root into the prompt, so duplicates compete with each other.

const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "when",
  "use", "used", "uses", "this", "that", "is", "are", "be", "by", "as", "it",
  "from", "your", "you", "or", "any", "into", "at", "so", "not", "but", "they",
]);

const tokens = (text) =>
  new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t))
  );

export const jaccard = (a, b) => {
  const A = a instanceof Set ? a : tokens(a);
  const B = b instanceof Set ? b : tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
};

// skills: [{ key, name, root, description }]
export const findDuplicateSkills = (skills, threshold = 0.5) => {
  const byName = new Map();
  for (const s of skills) {
    const list = byName.get(s.name) || [];
    list.push(s);
    byName.set(s.name, list);
  }

  const nameDup = new Map(); // key -> other roots
  const sameName = [];
  for (const [name, group] of byName) {
    const roots = [...new Set(group.map((s) => s.root))];
    if (roots.length < 2) continue;
    sameName.push({ name, roots, count: group.length });
    for (const s of group) {
      const others = group.filter((o) => o.key !== s.key && o.root !== s.root).map((o) => o.root);
      if (others.length) nameDup.set(s.key, [...new Set(others)]);
    }
  }

  const withDesc = skills.filter((s) => (s.description || "").trim().length > 0);
  const descTokens = withDesc.map((s) => ({ s, set: tokens(s.description) }));
  const closePairs = [];
  const closeWith = new Map(); // key -> [names]
  for (let i = 0; i < descTokens.length; i += 1) {
    for (let j = i + 1; j < descTokens.length; j += 1) {
      const a = descTokens[i];
      const b = descTokens[j];
      if (a.s.name === b.s.name) continue; // covered by sameName
      const ratio = jaccard(a.set, b.set);
      if (ratio < threshold) continue;
      closePairs.push({ a: a.s.key, b: b.s.key, aName: a.s.name, bName: b.s.name, ratio: Number(ratio.toFixed(2)) });
      closeWith.set(a.s.key, [...(closeWith.get(a.s.key) || []), b.s.name]);
      closeWith.set(b.s.key, [...(closeWith.get(b.s.key) || []), a.s.name]);
    }
  }

  return { sameName, nameDup, closePairs, closeWith };
};
