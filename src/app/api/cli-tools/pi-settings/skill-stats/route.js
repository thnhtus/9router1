import { skillPickStats } from "@/lib/skillPickStats.js";

export async function GET(request) {
  const hours = Number(new URL(request.url).searchParams.get("hours")) || 24;
  const data = await skillPickStats(hours);
  return Response.json(data);
}
