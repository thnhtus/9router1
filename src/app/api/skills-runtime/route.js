import { NextResponse } from "next/server";
import "@/lib/skills/builtins.js";
import { listSkills, runSkill } from "@/lib/skills/index.js";

export async function GET() {
  return NextResponse.json({ skills: listSkills() });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { skill, input } = body || {};
    if (!skill) return NextResponse.json({ error: "skill required" }, { status: 400 });
    const result = await runSkill(skill, input || {});
    return NextResponse.json({ result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
