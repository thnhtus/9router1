import { NextResponse } from "next/server";
import { getMemoryById, updateMemory, deleteMemory, MEMORY_STATUSES } from "@/lib/db/repos/agentMemoriesRepo.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const mem = await getMemoryById(id);
    if (!mem) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(mem);
  } catch (error) {
    console.log("Error fetching memory:", error);
    return NextResponse.json({ error: "Failed to fetch memory" }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getMemoryById(id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = await request.json();
    const { status, metadata, id: _ignored, ownerId: _ignored2, ownerType: _ignored3, ...rest } = body || {};
    if (status !== undefined && !MEMORY_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    // status lives in metadata; merge it rather than clobber other keys
    const mergedMetadata = { ...(existing.metadata || {}), ...(metadata && typeof metadata === "object" ? metadata : {}), ...(status ? { status } : {}) };
    const updated = await updateMemory(id, { ...rest, metadata: mergedMetadata });
    return NextResponse.json(updated);
  } catch (error) {
    console.log("Error updating memory:", error);
    return NextResponse.json({ error: "Failed to update memory" }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const ok = await deleteMemory(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting memory:", error);
    return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 });
  }
}
