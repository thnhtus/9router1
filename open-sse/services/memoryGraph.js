import { StateGraph, Annotation, END } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "node:path";
import { DATA_DIR } from "../../src/lib/dataDir.js";
import { retrieveMemories, createMemory, updateMemory, touchMemory } from "../../src/lib/db/repos/agentMemoriesRepo.js";
import { embedText } from "../../src/lib/memory/embed.js";

const MEMORY_DB = path.join(DATA_DIR, "db", "memory.sqlite");

let _saver = null;
function getSaver() {
  if (!_saver) _saver = SqliteSaver.fromConnString(MEMORY_DB);
  return _saver;
}

const MemoryState = Annotation.Root({
  ownerId: Annotation({ reducer: (_, v) => v, default: () => null }),
  ownerType: Annotation({ reducer: (_, v) => v, default: () => "user" }),
  query: Annotation({ reducer: (_, v) => v, default: () => "" }),
  retrieved: Annotation({ reducer: (_, v) => v, default: () => [] }),
  newFacts: Annotation({ reducer: (_, v) => v, default: () => [] }),
  consolidated: Annotation({ reducer: (_, v) => v, default: () => [] }),
  status: Annotation({ reducer: (_, v) => v, default: () => "idle" }),
});

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return na && nb ? dot / (Math.sqrt(na)*Math.sqrt(nb)) : 0;
}

async function retrieveNode(state) {
  try {
    const qe = await embedText(state.query || "");
    const retrieved = await retrieveMemories({ ownerType: state.ownerType, ownerId: state.ownerId, queryEmbedding: qe, topK: 8 });
    for (const m of retrieved) { try { await touchMemory(m.id); } catch {} }
    return { status: "retrieved", retrieved };
  } catch {
    return { status: "retrieved", retrieved: [] };
  }
}

export function extractFacts(text) {
  // ponytail: sentence-start heuristic only; ceiling = misses implicit facts; upgrade = LLM extraction via 9Router combo.
  const t = String(text || "").trim();
  const lower = t.toLowerCase();
  return /^(remember|nhớ|always|never|luôn)(\s|$)/.test(lower) ? [t] : [];
}

async function extractNode(state) {
  return { status: "extracted", newFacts: extractFacts(state.query) };
}

// Same-process dedup: combo/retry fires concurrent lifecycles for one message; skip identical facts within 60s.
const recentFacts = new Map();

async function consolidateNode(state) {
  const consolidated = [];
  for (const fact of state.newFacts || []) {
    const key = `${state.ownerType}|${state.ownerId}|${fact}`;
    if (Date.now() - (recentFacts.get(key) || 0) < 60_000) continue;
    recentFacts.set(key, Date.now());
    try {
      const existing = await retrieveMemories({ ownerType: state.ownerType, ownerId: state.ownerId, queryEmbedding: null, topK: 5000 });
      let match = existing.find((m) => m.content === fact);
      if (!match) {
        const fe = await embedText(fact);
        match = existing.find((m) => cosine(m.embedding, fe) >= 0.92);
      }
      if (match) {
        const fe = await embedText(fact);
        await updateMemory(match.id, { content: fact, embedding: fe });
        consolidated.push(match.id);
      } else {
        const fe = await embedText(fact);
        const mem = await createMemory({ ownerType: state.ownerType, ownerId: state.ownerId, type: "semantic", content: fact, embedding: fe });
        consolidated.push(mem.id);
      }
    } catch (err) {
      console.warn("[memory] consolidate failed:", err?.message || err);
    }
  }
  return { status: "consolidated", consolidated };
}

export function buildMemoryGraph() {
  const graph = new StateGraph(MemoryState)
    .addNode("retrieve", retrieveNode)
    .addNode("extract", extractNode)
    .addNode("consolidate", consolidateNode)
    .addEdge("__start__", "retrieve")
    .addEdge("retrieve", "extract")
    .addEdge("extract", "consolidate")
    .addEdge("consolidate", END);
  return graph.compile({ checkpointer: getSaver() });
}

export async function runMemoryLifecycle(input, threadId = "default") {
  const app = buildMemoryGraph();
  return app.invoke(input, { configurable: { thread_id: threadId } });
}
