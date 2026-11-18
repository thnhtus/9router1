import { describe, it, expect } from "vitest";
import { scoreSkill } from "@/shared/utils/skillScore";
import { findDuplicateSkills, jaccard } from "@/shared/utils/skillDuplicates";

const GOOD = `---
name: foo
description: Use when the user needs to build foo widgets from a spec file.
license: MIT
allowed-tools: Read, Write
---
# Foo

## Usage
${"Build the widget from the spec. ".repeat(60)}

## Steps
\`\`\`sh
echo hi
\`\`\`

## Notes
${"Keep the spec in sync. ".repeat(40)}

## Output
Write the result next to the spec.
`;

describe("scoreSkill", () => {
  it("grades a complete skill as A", () => {
    const r = scoreSkill({ raw: GOOD, dirName: "foo", resources: ["scripts"] });
    expect(r.grade).toBe("A");
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.signals).toEqual([]);
  });

  it("returns 0/C when SKILL.md is missing", () => {
    expect(scoreSkill({ raw: "", dirName: "x" })).toEqual({
      score: 0,
      grade: "C",
      signals: ["missing SKILL.md"],
    });
  });

  it("caps the score at 40 when description is missing", () => {
    const r = scoreSkill({ raw: "---\nname: x\n---\n# X\n## A\n## B\n## C\n", dirName: "x" });
    expect(r.score).toBeLessThanOrEqual(40);
    expect(r.signals).toContain("no description");
  });

  it("flags a name that does not match the folder", () => {
    const r = scoreSkill({ raw: "---\nname: other\ndescription: Use when x.\n---\n# X", dirName: "x" });
    expect(r.signals).toContain("name ≠ folder");
  });

  it("flags a thin body", () => {
    const r = scoreSkill({ raw: "---\nname: x\ndescription: Use when x.\n---\n# X", dirName: "x" });
    expect(r.signals).toContain("thin instructions");
  });

  it("rewards bundled resources", () => {
    const withRes = scoreSkill({ raw: GOOD, dirName: "foo", resources: ["scripts"] });
    const withoutRes = scoreSkill({ raw: GOOD, dirName: "foo", resources: [] });
    expect(withRes.score - withoutRes.score).toBe(8);
  });
});

describe("findDuplicateSkills", () => {
  const skills = [
    { key: "r1:a", name: "a", root: "r1", description: "build and debug cloudflare agents using the agents package" },
    { key: "r2:a", name: "a", root: "r2", description: "build and debug cloudflare agents using the agents package" },
    { key: "r3:b", name: "b", root: "r1", description: "deploy workers to cloudflare with wrangler cli commands" },
    { key: "r4:c", name: "c", root: "r1", description: "deploy workers to cloudflare with wrangler cli" },
  ];

  it("detects the same skill name across two roots", () => {
    const { sameName, nameDup } = findDuplicateSkills(skills);
    expect(sameName).toHaveLength(1);
    expect(sameName[0].name).toBe("a");
    expect([...nameDup.get("r1:a")]).toEqual(["r2"]);
  });

  it("detects near-identical descriptions under different names", () => {
    const { closePairs, closeWith } = findDuplicateSkills(skills);
    expect(closePairs).toHaveLength(1);
    expect(closePairs[0].aName).toBe("b");
    expect(closeWith.get("r3:b")).toEqual(["c"]);
  });

  it("respects the similarity threshold", () => {
    expect(findDuplicateSkills(skills, 0.95).closePairs).toHaveLength(0);
  });

  it("jaccard is 1 for identical text and 0 for empty input", () => {
    expect(jaccard("alpha beta gamma", "alpha beta gamma")).toBe(1);
    expect(jaccard("", "alpha")).toBe(0);
  });
});
