// Memory MCP (Streamable HTTP, JSON-RPC 2.0) — read-only access to the review-gated
// memory store for MCP clients (pi / Claude Code / Codex). Approved memories only;
// candidates are listed so an agent can surface what awaits human review.
//
// ponytail: minimal MCP surface (initialize/tools/list/tools/call only).
// Ceiling: add resources/prompts or SSE when a client actually needs them.

import { NextResponse } from "next/server";
import { listMemories, getMemoryById } from "@/lib/db/repos/agentMemoriesRepo.js";
import { memoryStatus } from "@/lib/db/repos/agentMemoriesRepo.js";

export const dynamic = "force-dynamic";

const SERVER_INFO = { name: "9router-memory", version: "0.1.0" };
const ownerScope = (extra = {}) => ({
  ownerType: "agent",
  ...(process.env.MEMORY_OWNER_ID ? { ownerId: process.env.MEMORY_OWNER_ID } : {}),
  ...extra,
});
const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (msg) => ({ content: [{ type: "text", text: JSON.stringify({ error: msg }) }], isError: true });

const TOOLS = [
  {
    name: "search_memory",
    description: "Keyword search over approved agent memories.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, type: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
  },
  {
    name: "get_memory",
    description: "Fetch one approved memory by id.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "get_memory_context",
    description: "Compact context block built from approved memories matching the query.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, topK: { type: "number" } }, required: ["query"] },
  },
  {
    name: "list_candidates",
    description: "Memory candidates awaiting human review (review gate).",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name, a = {}) {
  if (name === "search_memory") {
    const q = String(a.query || "").toLowerCase();
    const list = await listMemories(ownerScope({ type: a.type, limit: a.limit || 10, status: "approved" }));
    return ok(list.filter((m) => m.content.toLowerCase().includes(q)).map(({ id, type, content, metadata }) => ({ id, type, content, metadata })));
  }
  if (name === "get_memory") {
    const m = await getMemoryById(a.id);
    if (!m || memoryStatus(m) !== "approved") return fail("not found");
    return ok(m);
  }
  if (name === "get_memory_context") {
    const q = String(a.query || "").toLowerCase();
    const n = a.topK || 4;
    const list = await listMemories(ownerScope({ limit: 200, status: "approved" }));
    return ok({ context: list.filter((m) => m.content.toLowerCase().includes(q)).slice(0, n).map(({ id, type, content }) => ({ id, type, content })) });
  }
  if (name === "list_candidates") {
    return ok(await listMemories(ownerScope({ status: "candidate", limit: 50 })));
  }
  return fail(`unknown tool: ${name}`);
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const { id, method, params } = body || {};
  let result;
  if (method === "initialize") {
    result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: SERVER_INFO };
  } else if (method === "tools/list") {
    result = { tools: TOOLS };
  } else if (method === "tools/call") {
    result = await callTool(params?.name, params?.arguments || {});
  } else if (method === "ping") {
    result = {};
  } else if (id === undefined) {
    return new NextResponse(null, { status: 202 }); // notification
  } else {
    return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
  const payload = { jsonrpc: "2.0", id: id ?? null, result };
  return NextResponse.json(result?.isError ? { ...payload, result } : payload);
}
