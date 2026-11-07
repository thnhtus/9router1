import { NextResponse } from "next/server";
import { taskRegistry } from "@/lib/cloudAgent/registry.js";
import { AGENT_PROVIDERS } from "@/lib/cloudAgent/types.js";

export async function GET(request) {
  let searchParams;
  try { searchParams = new URL(request.url).searchParams; } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  const id = searchParams.get("id");
  if (id) {
    const t = taskRegistry.get(id);
    if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ task: t });
  }
  return NextResponse.json({ tasks: taskRegistry.list(), providers: AGENT_PROVIDERS });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { provider, prompt, metadata } = body || {};
    if (!provider || !AGENT_PROVIDERS.includes(provider)) {
      return NextResponse.json({ error: "invalid provider" }, { status: 400 });
    }
    if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });
    const task = taskRegistry.create(provider, prompt, metadata);
    // Stub: mark queued; real dispatch would call provider API.
    taskRegistry.update(task.id, { status: "queued" });
    taskRegistry.appendLog(task.id, `Task created for provider ${provider} (dispatch stub)`);
    return NextResponse.json({ task });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
