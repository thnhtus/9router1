import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

vi.mock("@/lib/db/helpers/kvStore.js", () => ({ makeKv: () => ({ get: async () => null, set: async () => {} }) }));
vi.mock("open-sse/providers/index.js", () => ({ PROVIDERS: {} }));
vi.mock("open-sse/services/lazyRuntime.js", () => ({ loadRuntimeDep: async () => { throw new Error("no playwright"); } }));
vi.mock("open-sse/executors/browserExecutableCheck.js", () => ({
  launchChromiumWithFallback: async () => { throw new Error("no chromium"); },
  resolveSystemChromeExecutable: () => null,
}));

// Fake checkout: <tmp>/fake-repo/open-sse/providers/registry/index.js
// Fake standalone cwd: <tmp>/fake-repo/.next/standalone
const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), "fake9router-"));
const fakeRegistryDir = path.join(fakeRepo, "open-sse", "providers", "registry");
const fakeStandalone = path.join(fakeRepo, ".next", "standalone");
fs.mkdirSync(fakeRegistryDir, { recursive: true });
fs.mkdirSync(fakeStandalone, { recursive: true });
fs.writeFileSync(
  path.join(fakeRegistryDir, "index.js"),
  '// Auto-generated\nimport p0 from "./a.js";\nexport default [\n  p0,\n];\n',
);

const { resolveRegistryRoot, installToRegistry } = await import("../../src/lib/providerSniffer.js");

let originalCwd;
beforeAll(() => {
  originalCwd = process.cwd();
});
afterAll(() => {
  fs.rmSync(fakeRepo, { recursive: true, force: true });
});

describe("provider registry source resolution (standalone-safe)", () => {
  it("resolveRegistryRoot walks up from the standalone cwd to the checkout root", () => {
    expect(resolveRegistryRoot(fakeStandalone)).toBe(fakeRepo);
  });

  it("resolveRegistryRoot keeps cwd when the registry source is right there", () => {
    expect(resolveRegistryRoot(fakeRepo)).toBe(fakeRepo);
  });

  it("installToRegistry writes into the resolved registry dir, not process.cwd()", async () => {
    process.chdir(fakeStandalone);
    try {
      const result = await installToRegistry({
        id: "Smoke Fake Provider",
        name: "Smoke Fake Provider",
        website: "https://example.com",
        baseUrl: "https://example.com/v1/chat/completions",
        validateUrl: "https://example.com/v1/models",
        format: "openai",
        models: [{ id: "default-model", name: "Default Model" }],
      });
      expect(result.id).toBe("smoke-fake-provider");

      const registryDir = path.join(fakeRepo, "open-sse", "providers", "registry");
      const written = path.join(registryDir, "smoke-fake-provider.js");
      expect(fs.existsSync(written)).toBe(true);
      expect(fs.existsSync(path.join(fakeStandalone, "open-sse"))).toBe(false);
      expect(fs.readFileSync(path.join(registryDir, "index.js"), "utf8")).toContain('./smoke-fake-provider.js');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
