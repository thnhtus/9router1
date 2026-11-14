import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db/helpers/kvStore.js", () => ({ makeKv: () => ({}) }));
vi.mock("open-sse/providers/index.js", () => ({ PROVIDERS: {} }));
const { addToRegistryIndex } = await import("../../src/lib/providerSniffer.js");

const SRC = `// Auto-generated
import p0 from "./a.js";
import p2 from "./b.js";
export default [
  p0,
  p2,
];
`;

describe("addToRegistryIndex", () => {
  it("adds import above export and entry inside the array", () => {
    const out = addToRegistryIndex(SRC, "new-p");
    expect(out).toContain('import p2 from "./b.js";\nimport p3 from "./new-p.js";\nexport default [');
    expect(out).toMatch(/ {2}p2,\n {2}p3,\n\];\n$/);
  });
  it("rejects duplicates", () => {
    expect(() => addToRegistryIndex(SRC, "a")).toThrow(/already present/);
  });
});
