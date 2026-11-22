import { NextResponse } from "next/server";
import { getRequestDetailById } from "@/lib/usageDb";

/**
 * GET /api/usage/request-details/[id]
 * Returns the full stored payload for a single request detail (request,
 * providerRequest, providerResponse, response). The list endpoint
 * (/api/usage/request-details) redacts conversation payloads; this
 * endpoint is only called on demand after a row click, so the full body
 * is fetched for one record at a time.
 */
export async function GET(_request, { params }) {
  const { id } = await params;

  const detail = await getRequestDetailById(id);
  if (!detail) {
    return NextResponse.json({ error: "Request detail not found" }, { status: 404 });
  }

  return NextResponse.json({ detail });
}
