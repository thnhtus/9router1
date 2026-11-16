// Optional export of finished combo runs to Langfuse (LLM observability).
// Off unless LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set. Sends run and
// attempt metadata only (model, status, latency, tokens, cost), never prompts or responses.
// ponytail: fire-and-forget, no retry queue; a failed POST is dropped.
// Upgrade path: retry queue, or the official Langfuse SDK.

export function langfuseConfig(env = process.env) {
  const pk = env.LANGFUSE_PUBLIC_KEY;
  const sk = env.LANGFUSE_SECRET_KEY;
  if (!pk || !sk) return null;
  return {
    auth: "Basic " + Buffer.from(`${pk}:${sk}`).toString("base64"),
    host: (env.LANGFUSE_HOST || "https://cloud.langfuse.com").replace(/\/$/, ""),
  };
}

// One trace per combo run, one generation per attempted model.
export function buildLangfuseBatch(run) {
  const start = new Date(run.startedAt).toISOString();
  const batch = [{
    id: `${run.id}-trace`,
    type: "trace-create",
    timestamp: start,
    body: {
      id: run.id,
      name: `combo:${run.combo}`,
      timestamp: start,
      metadata: { strategy: run.strategy, status: run.status, cost: run.cost },
    },
  }];
  run.attempts.forEach((a, i) => {
    if (a.status === "waiting" || a.status === "skipped") return;
    const t0 = a.at ?? run.startedAt;
    const id = `${run.id}-gen-${i}`;
    batch.push({
      id,
      type: "generation-create",
      timestamp: new Date(t0).toISOString(),
      body: {
        id,
        traceId: run.id,
        name: a.model,
        model: a.model,
        startTime: new Date(t0).toISOString(),
        endTime: a.ms != null ? new Date(t0 + a.ms).toISOString() : undefined,
        usage: a.tokens ? { input: a.tokens.in, output: a.tokens.out } : undefined,
        level: a.status === "failed" ? "ERROR" : "DEFAULT",
        statusMessage: a.reason ?? undefined,
        metadata: { status: a.status, code: a.code, cost: a.cost },
      },
    });
  });
  return batch;
}

export async function exportComboRun(run, { env = process.env, fetchImpl = fetch } = {}) {
  const cfg = langfuseConfig(env);
  if (!cfg) return false;
  const res = await fetchImpl(`${cfg.host}/api/public/ingestion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: cfg.auth },
    body: JSON.stringify({ batch: buildLangfuseBatch(run) }),
  });
  return res.ok;
}
