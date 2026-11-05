// x-rig / x-seat headers must reach getAgentTag() inside the wrapped call, and nothing outside it.
import { describe, it, expect } from "vitest";
import { runWithAgentTag, getAgentTag } from "../../open-sse/services/agentTag.js";

describe("agentTag", () => {
  it("carries rig/seat from Headers into the async scope", async () => {
    const h = new Headers({ "x-rig": " pi-team ", "x-seat": "dev-build@pi-team" });
    const seen = await runWithAgentTag(h, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getAgentTag();
    });
    expect(seen).toEqual({ rig: "pi-team", seat: "dev-build@pi-team" });
    expect(getAgentTag()).toBeNull();
  });

  it("is a no-op without the headers", () => {
    expect(runWithAgentTag({}, () => getAgentTag())).toBeNull();
  });
});
