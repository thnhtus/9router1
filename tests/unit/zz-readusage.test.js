import fs from "node:fs";
import { describe, it, expect } from "vitest";

process.env.DATA_DIR = "/tmp/devcopy";

const { readKeyUsage } = await import("../../src/sse/services/keyLimits.js");

describe("readKeyUsage against real dev DB copy", () => {
  it("sums tokens and cost", async () => {
    const K = fs.readFileSync("/tmp/smoke_kb", "utf8").trim();
    const u = await readKeyUsage(K, "2026-11-23T00:00:00.000Z");
    console.log("USAGE:", u);
    expect(u.requests).toBeGreaterThan(0);
  });
});
