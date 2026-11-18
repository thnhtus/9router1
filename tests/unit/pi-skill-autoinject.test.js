import { describe, it, expect, vi } from "vitest";
import {
  hasClientSkillCatalog,
  frontmatterDescription,
} from "../../src/lib/piSkills.js";

describe("pi skill auto-inject helpers", () => {
  it("detects a client-shipped <available_skills> catalog in messages and input", () => {
    expect(
      hasClientSkillCatalog({
        messages: [{ role: "system", content: "<available_skills><skill/></available_skills>" }],
      })
    ).toBe(true);
    expect(
      hasClientSkillCatalog({
        input: [{ role: "user", content: [{ type: "text", text: "hi <available_skills>" }] }],
      })
    ).toBe(true);
    expect(hasClientSkillCatalog({ messages: [{ role: "user", content: "ordinary task" }] })).toBe(false);
    expect(hasClientSkillCatalog({})).toBe(false);
  });

  it("parses frontmatter description (mirror of the real helper)", () => {
    expect(frontmatterDescription('---\nname: x\ndescription: "Do the thing"\n---\nbody')).toBe("Do the thing");
    expect(frontmatterDescription("no frontmatter")).toBe("");
    expect(frontmatterDescription("---\nname: x\ndescription: plain\n---")).toBe("plain");
  });

  it("builds a skill prompt from catalog names (uses real installed skills)", async () => {
    const { getSkillCatalog, loadSkillContent, buildSkillPrompt } = await import("../../src/lib/piSkills.js");
    const { skills } = await getSkillCatalog();
    expect(Array.isArray(skills)).toBe(true);
    if (skills.length) {
      const content = await loadSkillContent(skills[0].name);
      expect(content).toBeTruthy();
      const prompt = await buildSkillPrompt([skills[0].name], { maxChars: 8000 });
      expect(prompt).toContain(`## ${skills[0].name}`);
    }
  });
});
