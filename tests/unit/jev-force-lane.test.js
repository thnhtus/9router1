import { it, expect } from "vitest";
import { resolveForcedLane } from "@/sse/handlers/chat.js";

const req = (h) => ({ headers: new Headers(h) });
const models = ["cc/claude-opus-5-5", "oc/beam-free"];

it("x-jev-model pins a combo member, ignores non-members and absent headers", async () => {
  expect(await resolveForcedLane(req({ "x-jev-model": "oc/beam-free" }), models)).toBe("oc/beam-free");
  expect(await resolveForcedLane(req({ "x-jev-model": "evil/model" }), models)).toBe(null);
  expect(await resolveForcedLane(req({}), models)).toBe(null);
});
