import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

describe("skillPickStats", () => {
  let mod;
  beforeAll(async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "skillpick-"));
    delete global._dbAdapter;
    vi.resetModules();
    mod = await import("@/lib/skillPickStats.js");
  });

  it("counts attempts, injections and per-skill picks by source", async () => {
    await mod.recordSkillPick({ source: "jev", skills: ["impeccable"] });
    await mod.recordSkillPick({ source: "jev", skills: [] });
    await mod.recordSkillPick({ source: "llm", skills: ["impeccable", "graphify"] });
    const s = await mod.skillPickStats(24);
    expect(s.bySource).toEqual([
      { source: "jev", requests: 2, withSkill: 1 },
      { source: "llm", requests: 1, withSkill: 1 },
    ]);
    expect(s.topSkills).toEqual([{ skill: "impeccable", picks: 2 }, { skill: "graphify", picks: 1 }]);
  });
});
