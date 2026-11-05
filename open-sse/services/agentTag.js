// Tags usage rows with the calling OpenRig rig/seat (x-rig / x-seat request headers).
// AsyncLocalStorage keeps the tag through streamed responses, same pattern as comboTrace.js.
import { AsyncLocalStorage } from "node:async_hooks";

const als = (globalThis.__agentTagAls ??= new AsyncLocalStorage());
const clip = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);

export function runWithAgentTag(headers, fn) {
  const get = (k) => (typeof headers?.get === "function" ? headers.get(k) : headers?.[k]);
  const rig = clip(get("x-rig"));
  const seat = clip(get("x-seat"));
  if (!rig && !seat) return fn();
  return als.run({ rig, seat }, fn);
}

export const getAgentTag = () => als.getStore() || null;
