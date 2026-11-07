import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    name: "9router",
    description: "9Router A2A agent",
    url: "/api/a2a",
    version: "0.1",
    capabilities: { streaming: true },
    skills: [
      { id: "chat", name: "Chat", description: "Proxy chat completions" },
      { id: "code-review", name: "Code Review", description: "Review code" },
    ],
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    // Minimal A2A task echo stub
    return NextResponse.json({
      jsonrpc: "2.0",
      id: body?.id ?? null,
      result: { status: "submitted", task: body },
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
