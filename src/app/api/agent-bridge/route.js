import { NextResponse } from "next/server";
import { getMitmStatus } from "@/mitm/manager";
import { getMitmAlias } from "@/models";
import { MITM_TOOLS } from "@/shared/constants/cliTools";

// Read-only status of the MITM IDE bridge. Changes nothing.
export async function GET() {
  try {
    const [status, aliases] = await Promise.all([getMitmStatus(), getMitmAlias()]);
    const tools = Object.values(MITM_TOOLS)
      .filter((t) => t.configType === "mitm")
      .map((t) => ({
        id: t.id,
        name: t.name,
        domain: t.mitmDomain,
        dnsActive: !!status.dnsStatus[t.id],
        aliasCount: Object.keys(aliases?.[t.id] || {}).length,
      }));
    return NextResponse.json({
      running: status.running,
      pid: status.pid,
      certExists: status.certExists,
      certTrusted: status.certTrusted,
      tools,
    });
  } catch (e) {
    console.error("Error loading agent bridge status:", e.message);
    return NextResponse.json({ error: "Failed to load status" }, { status: 500 });
  }
}
