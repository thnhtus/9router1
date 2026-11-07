// Runtime skills framework for 9router1
const registry = new Map();

export function registerSkill(id, skill) {
  registry.set(id, skill);
}

export function listSkills() {
  return Array.from(registry.entries()).map(([id, s]) => ({
    id,
    name: s.name,
    description: s.description,
  }));
}

export async function runSkill(id, input) {
  const skill = registry.get(id);
  if (!skill) throw new Error(`Unknown skill: ${id}`);
  return skill.run(input);
}

export function hasSkill(id) {
  return registry.has(id);
}
