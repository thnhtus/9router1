// Cloud agent types
export const AGENT_PROVIDERS = ["codex", "devin", "jules", "antigravity"];

export function createTask({ provider, prompt, metadata = {} }) {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    provider,
    prompt,
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
    artifacts: [],
    metadata,
  };
}
