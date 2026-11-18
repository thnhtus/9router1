import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const clampScore = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
};

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({ ratings: settings.piSkillRatings || {} });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}

// Body: { ratings: { "<rootPath>:<name>": 0-100 | null } }
export async function POST(request) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  const input = rawBody?.ratings;
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: { message: "ratings object is required" } }, { status: 400 });
  }

  try {
    const settings = await getSettings();
    const next = { ...(settings.piSkillRatings || {}) };
    for (const [key, raw] of Object.entries(input)) {
      const score = clampScore(raw);
      if (score === null) delete next[key];
      else next[key] = { score, updatedAt: new Date().toISOString() };
    }
    await updateSettings({ piSkillRatings: next });
    return NextResponse.json({ success: true, ratings: next });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}
