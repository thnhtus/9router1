"use server";

import { NextResponse } from "next/server";
import { resolveCliApiKey } from "../resolveApiKey.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { scoreSkill } from "@/shared/utils/skillScore";
import { findDuplicateSkills } from "@/shared/utils/skillDuplicates";
import { skillCategory, mcpCategory } from "@/lib/piSkills.js";
import { mcpCallsByServer } from "@/lib/db/repos/mcpCallRepo.js";

const execAsync = promisify(exec);

const getPiModelsJsonPath = () => {
  const agentPath = path.join(os.homedir(), ".pi", "agent", "models.json");
  return agentPath;
};



const checkPiInstalled = async () => {
  const isWindows = os.platform() === "win32";
  try {
    const command = isWindows ? "where pi" : "which pi";
    await execAsync(command, { windowsHide: true });
    return true;
  } catch {
    try {
      await fs.access(getPiModelsJsonPath());
      return true;
    } catch {
      try {
        await fs.access(path.join(os.homedir(), ".pi", "models.json"));
        return true;
      } catch {
        return false;
      }
    }
  }
};

const has9RouterConfig = (settings) => {
  if (!settings || !settings.providers) return false;
  const p = settings.providers["9router"];
  if (p && p.baseUrl) return true;
  for (const prov of Object.values(settings.providers)) {
    if (prov.baseUrl && prov.baseUrl.includes("20128")) return true;
  }
  return false;
};

const getMcpPath = () => path.join(os.homedir(), ".pi", "agent", "mcp-adapter.json");

const readMcpServers = async () => {
  try {
    const raw = await fs.readFile(getMcpPath(), "utf-8");
    const d = JSON.parse(raw);
    return d && typeof d.mcpServers === "object" ? d.mcpServers : {};
  } catch {
    return null;
  }
};

const SKILL_ROOTS = [".pi/agent/skills", ".claude/skills", ".agents/skills"];

// Read SKILL.md, then score it structurally. status: ok | no-description | missing-SKILL.md
const readSkillInfo = async (dir, name) => {
  let raw = "";
  try {
    raw = await fs.readFile(path.join(dir, "SKILL.md"), "utf-8");
  } catch {
    raw = "";
  }
  const resources = await fs.readdir(dir).catch(() => []);
  const { score, grade, signals } = scoreSkill({ raw, dirName: name, resources });
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || "";
  const description = (fm.match(/^description:\s*(.*)$/m)?.[1] || "").replace(/^["']|["']$/g, "").trim();
  const status = !raw ? "missing-SKILL.md" : description ? "ok" : "no-description";
  return { status, description, category: skillCategory(name, description), autoScore: score, autoGrade: grade, signals };
};

// stat() follows symlinks, so linked skill dirs are counted (readdir isDirectory() skips them).
const scanSkills = async () => {
  const out = [];
  for (const rel of SKILL_ROOTS) {
    const root = path.join(os.homedir(), rel);
    let skills = [];
    try {
      const entries = await fs.readdir(root);
      const dirs = [];
      for (const name of entries.sort()) {
        const full = path.join(root, name);
        const st = await fs.stat(full).catch(() => null);
        if (!st?.isDirectory()) continue;
        const link = await fs.readlink(full).catch(() => null);
        dirs.push({ name, full, link });
      }
      skills = await Promise.all(
        dirs.map(async ({ name, full, link }) => ({ name, link, ...(await readSkillInfo(full, name)) }))
      );
    } catch {
      /* root missing */
    }
    const linked = skills.filter((s) => s.link).length;
    out.push({ path: root, count: skills.length, linked, local: skills.length - linked, skills });
  }
  return out;
};

const getPiDir = () => path.join(os.homedir(), ".pi", "agent");

const readMcpCacheStats = async () => {
  try {
    const raw = await fs.readFile(path.join(getPiDir(), "mcp-cache.json"), "utf-8");
    const d = JSON.parse(raw);
    const stats = {};
    for (const [name, s] of Object.entries(d?.servers || {})) {
      const tools = Array.isArray(s?.tools) ? s.tools : [];
      stats[name] = { tools: tools.length, toolList: tools.map((t) => ({ name: t.name, description: t.description || "" })) };
    }
    return stats;
  } catch {
    return {};
  }
};

const commandExists = async (command) => {
  if (!command) return false;
  if (command.includes("/")) {
    try {
      await fs.access(command);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await execAsync(`command -v ${JSON.stringify(command)}`, { windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

const summarizeServers = async (servers) => {
  const cache = await readMcpCacheStats();
  return Promise.all(
    Object.entries(servers || {}).map(async ([name, cfg]) => {
      const isHttp = !cfg?.command;
      const cached = cache[name];
      let state = "unknown";
      if (cached) {
        state = "ready";
      } else if (isHttp) {
        state = "never connected";
      } else if (await commandExists(cfg.command)) {
        state = "installed";
      } else {
        state = "missing";
      }
      return {
        name,
        category: mcpCategory(name, cfg?.url || [cfg?.command, ...(Array.isArray(cfg?.args) ? cfg.args : [])].filter(Boolean).join(" ")),
        transport: cfg?.type || (isHttp ? "http" : "stdio"),
        target: cfg?.url || [cfg?.command, ...(Array.isArray(cfg?.args) ? cfg.args : [])].filter(Boolean).join(" "),
        state,
        tools: cached?.tools ?? null,
        toolList: cached?.toolList ?? [],
      };
    })
  );
};

const resolveModelsJsonPath = async () => {
  const agentPath = path.join(os.homedir(), ".pi", "agent", "models.json");
  const rootPath = path.join(os.homedir(), ".pi", "models.json");
  try {
    await fs.access(agentPath);
    return agentPath;
  } catch {
    try {
      await fs.access(rootPath);
      return rootPath;
    } catch {
      return agentPath;
    }
  }
};

const readConfig = async () => {
  try {
    const targetPath = await resolveModelsJsonPath();
    const content = await fs.readFile(targetPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
};

export async function GET() {
  try {
    const installed = await checkPiInstalled();
    if (!installed) {
      return NextResponse.json({
        installed: false,
        config: null,
        message: "Pi CLI is not installed",
      });
    }

    const config = await readConfig();
    const configPath = await resolveModelsJsonPath();
    const mcpServers = await readMcpServers();
    const skills = await scanSkills();
    const flatSkills = skills.flatMap((root) =>
      root.skills.map((s) => ({
        key: `${root.path}:${s.name}`,
        name: s.name,
        root: root.path,
        description: s.description,
      }))
    );
    const dup = findDuplicateSkills(flatSkills);

    return NextResponse.json({
      installed: true,
      config,
      has9Router: has9RouterConfig(config),
      configPath,
      mcpPath: getMcpPath(),
      mcpServers: await summarizeServers(mcpServers),
      mcpCallTotals: await mcpCallsByServer(24 * 30).catch(() => ({})),
      exaMcpEnabled: !!mcpServers?.exa,
      skills,
      duplicates: {
        sameName: dup.sameName,
        closePairs: dup.closePairs,
        nameDup: Object.fromEntries(dup.nameDup),
        closeWith: Object.fromEntries(dup.closeWith),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}

export async function POST(request) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body" } }, { status: 400 });
  }

  try {
    const { baseUrl, apiKey, model } = rawBody || {};
    if (!baseUrl) {
      return NextResponse.json({ error: { message: "baseUrl is required" } }, { status: 400 });
    }

    const configPath = await resolveModelsJsonPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });

    let existing = {};
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      /* No existing config */
    }

    if (!existing.providers) existing.providers = {};

    const existingProvider = existing.providers["9router"] || {};
    const prevModels = new Map(
      (Array.isArray(existingProvider.models) ? existingProvider.models : [])
        .map((m) => (typeof m === "string" ? { id: m } : m))
        .filter((m) => m?.id)
        .map((m) => [m.id, m])
    );

    const cap = (v, fallback, max) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= max ? n : fallback;
    };

    const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const withDefaults = (m) => {
      const prev = prevModels.get(m.id) || {};
      return {
        ...prev,
        ...m,
        // The card always sends name === id, so treat that as "unset" and keep
        // a display name the user set by hand in models.json.
        name: m.name && m.name !== m.id ? m.name : (prev.name || m.id),
        contextWindow: cap(m.contextWindow ?? prev.contextWindow, 200000, 2000000),
        maxTokens: cap(m.maxTokens ?? prev.maxTokens, 64000, 200000),
      };
    };

    let modelList = [];
    if (Array.isArray(rawBody.models) && rawBody.models.length > 0) {
      modelList = rawBody.models.map((m) =>
        typeof m === "string"
          ? withDefaults({ id: m })
          : withDefaults({ ...m, id: m.id || "provider/model-id" })
      );
    } else {
      const modelId = model || "provider/model-id";
      modelList = [withDefaults({ id: modelId })];
    }

    existing.providers["9router"] = {
      ...existingProvider,
      baseUrl: normalizedBaseUrl,
      apiKey: apiKey || existingProvider.apiKey || await resolveCliApiKey(null),
      api: existingProvider.api || "openai-completions",
      models: modelList,
    };

    await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf-8");

    return NextResponse.json({
      success: true,
      message: "Pi settings applied! Use /model in Pi to select the 9Router model.",
      configPath,
      mcpPath: getMcpPath(),
    });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const configPath = await resolveModelsJsonPath();
    let existing = {};
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      return NextResponse.json({ success: true, message: "No config file to reset" });
    }

    if (existing.providers && existing.providers["9router"]) {
      delete existing.providers["9router"];
      if (Object.keys(existing.providers).length === 0) delete existing.providers;
      await fs.writeFile(configPath, JSON.stringify(existing, null, 2), "utf-8");
    }

    return NextResponse.json({ success: true, message: "9Router removed from Pi" });
  } catch (err) {
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}
