"use server";

import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

const SKILL_ROOTS = [".pi/agent/skills", ".claude/skills", ".agents/skills"];
const MAX_BYTES = 200_000;
const NAME_RE = /^[\w.@+ -]+$/;

// Only allow "<one of SKILL_ROOTS>/<single skill dir>" so a query string can never
// walk out of the skills tree. Symlinked dirs are allowed: the link itself sits in a root.
const resolveSkillDir = (raw) => {
  if (typeof raw !== "string" || !raw) return null;
  const abs = path.resolve(raw);
  const name = path.basename(abs);
  if (!NAME_RE.test(name) || name === "." || name === "..") return null;
  const parent = path.dirname(abs);
  const root = SKILL_ROOTS.map((rel) => path.join(os.homedir(), rel)).find((r) => path.resolve(r) === parent);
  return root ? { dir: abs, name } : null;
};

export async function GET(request) {
  const target = resolveSkillDir(new URL(request.url).searchParams.get("path"));
  if (!target) {
    return NextResponse.json({ error: { message: "path must be a skill dir under a skills root" } }, { status: 400 });
  }

  const skillMd = path.join(target.dir, "SKILL.md");
  let raw;
  try {
    raw = await fs.readFile(skillMd, "utf-8");
  } catch {
    return NextResponse.json({ error: { message: "No SKILL.md in this skill folder" } }, { status: 404 });
  }

  const resources = (await fs.readdir(target.dir).catch(() => [])).sort();
  const truncated = raw.length > MAX_BYTES;
  return NextResponse.json({
    path: skillMd,
    resources,
    truncated,
    raw: truncated ? raw.slice(0, MAX_BYTES) : raw,
  });
}
