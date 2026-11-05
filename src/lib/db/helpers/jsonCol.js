export function parseJson(str, fallback = null) {
  if (str == null) return fallback;
  // BLOB written by an external tool comes back as bytes; spreading it corrupts the row.
  if (str instanceof Uint8Array) str = Buffer.from(str).toString("utf8");
  if (typeof str !== "string") return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

export function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}
