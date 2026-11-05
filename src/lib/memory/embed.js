// ponytail: no model configured → try common embedding models in order; first that answers wins.
const DEFAULT_MODELS = [
  "gemini/gemini-embedding-001",
  "openrouter/openai/text-embedding-3-small",
  "openai/text-embedding-3-small",
];

async function localKey() {
  try {
    const { getApiKeys } = await import("@/lib/localDb.js");
    const active = ((await getApiKeys?.()) || []).filter((k) => k?.isActive !== false);
    return (active.find((k) => !k?.access?.restricted) || active[0])?.key || null;
  } catch {
    return null;
  }
}

async function configuredModel() {
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    return (await getSettings())?.memoryEmbeddingModel || process.env.MEMORY_EMBEDDING_MODEL || null;
  } catch {
    return process.env.MEMORY_EMBEDDING_MODEL || null;
  }
}

export async function embedText(text) {
  if (!text) return null;
  const configured = await configuredModel();
  const models = configured ? [configured] : DEFAULT_MODELS;
  const headers = { "Content-Type": "application/json" };
  const key = await localKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  const url = `http://127.0.0.1:${process.env.PORT || 20127}/api/v1/embeddings`;
  for (const model of models) {
    try {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model, input: text }), signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const emb = (await res.json())?.data?.[0]?.embedding;
      if (Array.isArray(emb)) return emb;
    } catch {}
  }
  return null;
}
