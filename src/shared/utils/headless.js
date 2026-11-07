import { NextResponse } from "next/server";
import { isHeadless } from "@/shared/utils/headless";

/**
 * Headless mode check middleware for dashboard-only API routes / page guards.
 * Returns a 503 Service Unavailable response if headless mode is active.
 */
export function checkHeadlessMode() {
  if (isHeadless()) {
    return NextResponse.json(
      { error: "Dashboard APIs disabled in Headless mode (OMNIROUTE_HEADLESS=1)" },
      { status: 503 }
    );
  }
  return null;
}

export { isHeadless };
