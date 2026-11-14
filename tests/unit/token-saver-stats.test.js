// Hourly token-saver counters: one row per (hour, Jev level), aggregated per level and window.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-tsaver-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});
afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const flush = () => new Promise((r) => setTimeout(r, 50));

it("accumulates per level and sums the window", async () => {
  const { bumpTokenSaverHourly, tokenSaverStats } = await import("@/lib/db/repos/tokenSaverRepo.js");

  bumpTokenSaverHourly({ level: "L1", lossyApplied: 1, rtkHits: 3, headroomSaved: 120, caveman: 1 });
  await flush();
  bumpTokenSaverHourly({ level: "L1", lossyApplied: 1, rtkHits: 2, headroomSaved: 80, caveman: 1 });
  bumpTokenSaverHourly({ level: "L4", lossyBlocked: 1, rtkHits: 5 });
  bumpTokenSaverHourly({ lossyOff: 1, rtkHits: 1 }); // no Jev signal
  await flush();

  const { summary, byLevel, timeline } = await tokenSaverStats(24);
  expect(summary).toMatchObject({ total: 4, lossyApplied: 2, lossyBlocked: 1, lossyOff: 1, rtkHits: 11, headroomSaved: 200 });

  const l1 = byLevel.find((r) => r.level === "L1");
  expect(l1).toMatchObject({ total: 2, lossyApplied: 2, headroomSaved: 200 });
  expect(byLevel.find((r) => r.level === "L4")).toMatchObject({ total: 1, lossyBlocked: 1 });
  expect(byLevel.find((r) => r.level === "")).toMatchObject({ total: 1, lossyOff: 1 });

  expect(timeline).toHaveLength(1);
  expect(timeline[0].total).toBe(4);
});

it("returns zeros when nothing was recorded", async () => {
  const { tokenSaverStats } = await import("@/lib/db/repos/tokenSaverRepo.js");
  const { summary, byLevel } = await tokenSaverStats(24);
  expect(summary.total).toBe(0);
  expect(byLevel).toEqual([]);
});
