import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { makeKv } from "@/lib/db/helpers/kvStore.js";

const TUNNEL_DIR = path.join(DATA_DIR, "tunnel"); // still holds the cloudflared pid file
const tunnelKv = makeKv("tunnel");

const SHORT_ID_LENGTH = 6;
const SHORT_ID_CHARS = "abcdefghijklmnpqrstuvwxyz23456789";

export function ensureTunnelDir() {
  if (!fs.existsSync(TUNNEL_DIR)) fs.mkdirSync(TUNNEL_DIR, { recursive: true });
}

// { shortId, tunnelUrl } — shortId must survive restarts: it is the public URL.
export async function loadState() {
  return await tunnelKv.get("state", null);
}

export async function saveState(state) {
  await tunnelKv.set("state", state);
}

export function generateShortId() {
  let result = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    result += SHORT_ID_CHARS.charAt(Math.floor(Math.random() * SHORT_ID_CHARS.length));
  }
  return result;
}

export { TUNNEL_DIR };
