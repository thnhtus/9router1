import { NextResponse } from "next/server";
import { execFileSync } from "child_process";

const BUILTIN_AGENTS = [
  { id: "codex", name: "OpenAI Codex", bin: "codex", versionArg: ["--version"], protocol: "stdio" },
  { id: "claude", name: "Claude Code", bin: "claude", versionArg: ["--version"], protocol: "stdio" },
  { id: "goose", name: "Goose", bin: "goose", versionArg: ["--version"], protocol: "stdio" },
  { id: "aider", name: "Aider", bin: "aider", versionArg: ["--version"], protocol: "stdio" },
  { id: "cline", name: "Cline", bin: "cline", versionArg: ["--version"], protocol: "stdio" },
  { id: "cursor", name: "Cursor CLI", bin: "cursor", versionArg: ["--version"], protocol: "stdio" },
  { id: "windsurf", name: "Windsurf", bin: "windsurf", versionArg: ["--version"], protocol: "stdio" },
  { id: "devin", name: "Devin CLI", bin: "devin", versionArg: ["--version"], protocol: "stdio" },
  { id: "kimi", name: "Kimi Coding", bin: "kimi", versionArg: ["--version"], protocol: "stdio" },
  { id: "command-code", name: "Command Code", bin: "command-code", versionArg: ["--version"], protocol: "stdio" },
  { id: "opencode", name: "OpenCode", bin: "opencode", versionArg: ["--version"], protocol: "stdio" },
  { id: "forge", name: "ForgeCode", bin: "forge", versionArg: ["--version"], protocol: "stdio" },
  { id: "amazon-q", name: "Amazon Q", bin: "q", versionArg: ["--version"], protocol: "stdio" },
  { id: "open-interpreter", name: "Open Interpreter", bin: "interpreter", versionArg: ["--version"], protocol: "stdio" },
  { id: "warp", name: "Warp", bin: null, versionArg: [], protocol: "gui" },
  { id: "openclaw", name: "OpenClaw", bin: "openclaw", versionArg: ["--version"], protocol: "stdio" },
];

function which(bin) {
  try {
    const out = execFileSync("which", [bin], { encoding: "utf8", timeout: 3000 });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function versionOf(bin, args) {
  try {
    const out = execFileSync(bin, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const agents = BUILTIN_AGENTS.map((a) => {
    if (!a.bin) {
      return { ...a, installed: false, path: null, version: null, status: "gui-only" };
    }
    const path = which(a.bin);
    const installed = !!path;
    const version = installed ? versionOf(a.bin, a.versionArg) : null;
    return { ...a, installed, path, version, status: installed ? "installed" : "not-found" };
  });
  return NextResponse.json({ agents });
}
