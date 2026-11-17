import { NextResponse } from "next/server";
import { listMemories, createMemory, MEMORY_STATUSES } from "@/lib/db/repos/agentMemoriesRepo.js";

export const dynamic = "force-dynamic";

const OWNER_TYPES = ["user", "agent", "team", "project"];
const TYPES = ["episodic", "semantic", "procedural", "preference", "working"];

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const ownerType = searchParams.get("ownerType") || undefined;
    const ownerId = searchParams.get("ownerId") || undefined;
    const type = searchParams.get("type") || undefined;
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    // list defaults to every status so the dashboard can surface candidates
    const status = searchParams.get("status") || "all";
    const items = await listMemories({ ownerType, ownerId, type, limit, status });
    return NextResponse.json({ memories: items });
  } catch (error) {
    console.log("Error fetching memories:", error);
    return NextResponse.json({ error: "Failed to fetch memories" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { ownerType, ownerId, type, content, metadata } = body || {};
    const status = body?.status;
    if (status !== undefined && !MEMORY_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (!OWNER_TYPES.includes(ownerType)) {
      return NextResponse.json({ error: "Invalid ownerType" }, { status: 400 });
    }
    if (!TYPES.includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    if (typeof content !== "string" || content.trim() === "" || content.length > 8000) {
      return NextResponse.json({ error: "Invalid content" }, { status: 400 });
    }
    if (typeof ownerId !== "string" || ownerId.trim() === "") {
      return NextResponse.json({ error: "ownerId is required" }, { status: 400 });
    }
    const mem = await createMemory({
      ownerType, ownerId, type, content,
      metadata: { ...(metadata && typeof metadata === "object" ? metadata : {}), ...(status ? { status } : {}) },
    });
    return NextResponse.json(mem, { status: 201 });
  } catch (error) {
    console.log("Error creating memory:", error);
    return NextResponse.json({ error: "Failed to create memory" }, { status: 500 });
  }
}
