// Session-memory evaluator — Beacon's "capture → candidate → review → reuse" loop,
// backed by the 9router Jev System One path instead of a separate beacon-gateway.
//
// Deliberately review-gated: Jev only says yes/no. It never auto-writes an
// approved memory; it creates a `candidate` that a human approves via /api/memory.

import { getModelInfo } from "@/sse/services/model.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { getRequestDetails } from "@/lib/db/repos/requestDetailsRepo.js";
import { createMemory } from "@/lib/db/repos/agentMemoriesRepo.js";
import { getApiKeys } from "@/lib/localDb.js";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { createHash } from "node:crypto";

// Beacon gate: task_success >= 0.50 AND mean(3 questions) >= 0.60.
const SUCCESS_GATE = 0.5;
const MEAN_GATE = 0.6;
// Auto-approve (opt-in) skips the human queue only for clearly strong sessions.
const AUTO_APPROVE_TASK = 0.9;
const AUTO_APPROVE_MEAN = 0.85;

export function shouldAutoApprove({ enabled, taskSuccess, mean }) {
  return enabled === true && typeof taskSuccess === "number" && taskSuccess >= AUTO_APPROVE_TASK && mean >= AUTO_APPROVE_MEAN;
}

export function memoryOwnerIdFromKey(apiKey) {
  if (typeof apiKey !== "string" || !apiKey) return null;
  return `key:${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

// ponytail: per-process idle debounce (eval runs ~10min after a session's last
// request); lost timers on restart just mean that session is evaluated later or never.
const evalTimers = new Map();
const EVAL_IDLE_MS = Number(process.env.MEMORY_EVAL_IDLE_MS) || 10 * 60 * 1000;

// Auto-file hook: call after every successful chat request. Debounces per
// sessionId and runs evaluateSession fire-and-forget when memoryEvalEnabled is on.
export function scheduleSessionEval(sessionId, { ownerType = "agent", ownerId } = {}) {
  if (!sessionId || typeof sessionId !== "string") return;
  const prev = evalTimers.get(sessionId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    evalTimers.delete(sessionId);
    evaluateSession({ sessionId, ownerType, ownerId }).catch(() => {});
  }, EVAL_IDLE_MS);
  if (typeof t.unref === "function") t.unref();
  evalTimers.set(sessionId, t);
}

// Reused as both the probe payload and the candidate record, so flip here only.
const MAX_STATE_CHARS = 2000;

const REDACTORS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /sk-[A-Za-z0-9\-_.]{8,}/g,
  /AIza[0-9A-Za-z\-_.]{10,}/g,
  /ya29\.[0-9A-Za-z\-_.]{10,}/g,
];

export function redact(text) {
  if (typeof text !== "string") return "";
  let s = text;
  for (const re of REDACTORS) s = s.replace(re, "[REDACTED]");
  return s;
}
const truncate = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
const msgText = (c) => {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => x?.text || x?.output || "").join(" ");
  return "";
};
const firstUser = (req) => {
  const msgs = Array.isArray(req?.request?.messages) ? req.request.messages : [];
  const m = msgs.find((x) => x?.role === "user");
  return msgText(m?.content);
};
const responseText = (req) => {
  const r = req?.response;
  if (!r || typeof r !== "object") return "";
  return msgText(r.content) || String(r.error || "");
};

export function groupSessions(details) {
  const map = new Map();
  for (const d of details) {
    const sid = d?.sessionId;
    if (!sid) continue;
    let s = map.get(sid);
    if (!s) {
      s = { sessionId: sid, count: 0, first: d, last: d, providers: new Set(), models: new Set(), errors: 0 };
      map.set(sid, s);
    }
    if (d.timestamp < s.first.timestamp) s.first = d;
    if (d.timestamp > s.last.timestamp) s.last = d;
    s.count += 1;
    if (d.provider) s.providers.add(d.provider);
    if (d.model) s.models.add(d.model);
    if (d.status === "error") s.errors += 1;
  }
  return [...map.values()].sort((a, b) => String(b.last.timestamp).localeCompare(String(a.last.timestamp)));
}

function buildState(session) {
  const { first, last } = session;
  const lines = [
    `Agent session ${session.sessionId}: ${session.count} requests, ${session.errors} errors, providers=${[...session.providers].join(",")}, models=${[...session.models].join(",")}.`,
    `First user request: ${truncate(redact(firstUser(first)), 600)}`,
    `Last user request: ${truncate(redact(firstUser(last)), 400)}`,
    `First assistant answer: ${truncate(redact(responseText(first)), 400)}`,
    `Last assistant answer: ${truncate(redact(responseText(last)), 500)}`,
  ];
  return lines.join("\n").slice(0, MAX_STATE_CHARS);
}

export function buildCandidateContent(session, scores) {
  const { first, last } = session;
  const providers = [...session.providers].join(",") || "-";
  const models = [...session.models].join(",") || "-";
  const parts = [
    `[candidate] Session ${session.sessionId} (${session.count} req, ${session.errors} err, mean=${scores?.mean ?? "?"}, task=${scores?.taskSuccess ?? "?"}, reusable=${scores?.reusable ?? "?"}, evidence=${scores?.evidence ?? "?"})`,
    `Providers: ${providers} | Models: ${models}`,
    `First user: ${truncate(redact(firstUser(first)), 350)}`,
  ];
  const lastU = truncate(redact(firstUser(last)), 250);
  if (lastU && lastU !== truncate(redact(firstUser(first)), 250)) parts.push(`Last user: ${lastU}`);
  const lastA = truncate(redact(responseText(last)), 500);
  if (lastA) parts.push(`Last answer: ${lastA}`);
  return parts.join("\n").slice(0, 1800);
}

export function yesProbability(answers, key) {
  const a = answers?.[key];
  if (!a) return null;
  const p = a.probabilities?.yes ?? a.probabilities?.YES ?? a.probabilities?.Yes;
  if (Number.isFinite(Number(p))) return Number(p);
  return String(a.choice || "").toLowerCase() === "yes" ? 1 : 0;
}

export async function loadSessionRequests(sessionId, limit = 400) {
  const all = [];
  let page = 1;
  for (;;) {
    const { details, pagination } = await getRequestDetails({ page, pageSize: 100 });
    if (!details.length) break;
    for (const d of details) if (d?.sessionId === sessionId) all.push(d);
    if (!pagination?.hasNext || all.length >= limit) break;
    page = pagination.page + 1;
  }
  return all.slice(0, limit);
}

export async function evaluateSession({ sessionId, ownerType = "agent", ownerId, model, dryRun = false, force = false } = {}) {
  if (!sessionId || typeof sessionId !== "string") return { error: "sessionId is required" };
  const requests = await loadSessionRequests(sessionId);
  if (!requests.length) return { error: `No detailed requests for session ${sessionId} (observability must be enabled)` };

  const grouped = groupSessions(requests)[0];
  const state = buildState(grouped);
  const settings = await getSettings().catch(() => null);
  const routerModel = (typeof model === "string" && model.trim()) || settings?.memoryEvalModel || "typesafe/jev-latest";

  const modelInfo = await getModelInfo(routerModel);
  if (!modelInfo?.provider) return { error: `Unrecognized evaluator model "${routerModel}"` };
  const credentials = await getProviderCredentials(modelInfo.provider, new Set(), modelInfo.model);
  if (!credentials || credentials.allRateLimited) {
    return { error: `No credentials for evaluator provider "${modelInfo.provider}"` };
  }
  const refreshed = await checkAndRefreshToken(modelInfo.provider, credentials);
  const questions = {
    task_success: { type: "choice", instructions: "Did the agent complete the user's task successfully in this session?", criteria: { yes: null, no: null } },
    reusable: { type: "choice", instructions: "Does this session contain a reusable pattern, decision, or constraint worth remembering for future sessions?", criteria: { yes: null, no: null } },
    evidence: { type: "choice", instructions: "Does the transcript contain concrete evidence (files changed, commands run, errors fixed, decisions made)?", criteria: { yes: null, no: null } },
  };
  const result = await handleSystemoneCore({
    body: { model: modelInfo.model, state, questions },
    modelInfo: { provider: modelInfo.provider, model: modelInfo.model },
    credentials: refreshed,
    log: null,
    onRequestSuccess: () => {},
    timeoutMs: 10000,
  });
  if (!result?.success || !result.response) {
    return { error: `Evaluator call failed (${result?.status || "error"})`, state };
  }
  const json = await result.response.json();
  const answers = json?.answers || {};
  const taskSuccess = yesProbability(answers, "task_success");
  const reusable = yesProbability(answers, "reusable");
  const evidence = yesProbability(answers, "evidence");
  const scores = [taskSuccess, reusable, evidence].filter((v) => v !== null);
  if (!scores.length) return { error: "Evaluator response was missing answers", state, raw: json };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const passed = taskSuccess !== null && taskSuccess >= SUCCESS_GATE && mean >= MEAN_GATE;

  const out = { sessionId, requests: requests.length, provider: modelInfo.provider, model: modelInfo.model, scores: { taskSuccess, reusable, evidence, mean: Number(mean.toFixed(3)) }, passed, state };
  if (dryRun) return { ...out, dryRun: true };
  if (!passed) return { ...out, candidateCreated: false };

  // Candidate memories are only written when the user has turned evaluation on.
  if (!force && settings?.memoryEvalEnabled !== true) {
    return { ...out, candidateCreated: false, skipped: "memoryEvalEnabled is false (enable it to let Jev file candidates)" };
  }
  const fallbackOwner = memoryOwnerIdFromKey(await firstActiveKeyId()) || "system";
  const owner = memoryOwnerIdFromKey(ownerId) || ownerId || fallbackOwner;
  // Opt-in auto-approve: still a human gate, it only skips the queue for strong
  // sessions and leaves an audit trail; any auto-approved row can be Rejected later.
  const autoApprove = shouldAutoApprove({ enabled: settings?.memoryAutoApprove === true, taskSuccess, mean: out.scores.mean });
  const mem = await createMemory({
    ownerType,
    ownerId: owner,
    type: "episodic",
    content: buildCandidateContent(grouped, out.scores),
    metadata: {
      status: autoApprove ? "approved" : "candidate",
      autoApproved: autoApprove || undefined,
      autoApproveReason: autoApprove ? `Jev task=${taskSuccess} mean=${out.scores.mean} (gates ${AUTO_APPROVE_TASK}/${AUTO_APPROVE_MEAN})` : undefined,
      sessionId,
      taskSuccess,
      reusable,
      evidence,
      mean: out.scores.mean,
      providers: [...grouped.providers],
      models: [...grouped.models],
      evaluator: `${modelInfo.provider}/${modelInfo.model}`,
    },
    importance: 0.6,
  });
  return { ...out, candidateCreated: true, autoApproved: autoApprove, memory: mem };
}

async function firstActiveKeyId() {
  try {
    const keys = await getApiKeys();
    const k = Array.isArray(keys) ? keys.find((x) => x?.id && x?.isActive !== false) : null;
    return k?.id || k?.key || null;
  } catch {
    return null;
  }
}
