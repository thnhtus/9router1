import { createTask } from "./types.js";

const tasks = new Map();

export const taskRegistry = {
  create(provider, prompt, metadata) {
    const t = createTask({ provider, prompt, metadata });
    tasks.set(t.id, t);
    return t;
  },
  get(id) { return tasks.get(id) || null; },
  list() { return Array.from(tasks.values()); },
  update(id, patch) {
    const t = tasks.get(id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: new Date().toISOString() });
    return t;
  },
  appendLog(id, line) {
    const t = tasks.get(id);
    if (t) t.logs.push({ ts: new Date().toISOString(), line });
    return t;
  },
};
