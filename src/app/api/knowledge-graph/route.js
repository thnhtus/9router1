import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

export const dynamic = "force-dynamic";

const run = promisify(execFile);
// Output dir is env-overridable so prod (global CLI, different cwd) can point at the repo snapshot.
const ROOT = process.env.GRAPHIFY_ROOT || process.cwd();
const OUT = path.join(ROOT, "graphify-out");
const GRAPHIFY_BIN = process.env.GRAPHIFY_BIN || "graphify";

let rebuilding = null;

// Re-skins graphify's graph.html with the dashboard palette and follows the parent page's
// light/dark class (same-origin iframe). Script goes right after <head> so localStorage is set
// before graph.html's own theme bootstrap reads it. Static string, no user input.
const THEME_PATCH = `<script>
(function () {
  var host = null;
  try { host = window.parent !== window ? window.parent.document.documentElement : null; } catch (e) {}
  function mode() { return host && host.classList.contains("dark") ? "dark" : "light"; }
  try { localStorage.setItem("graphify-theme", mode()); } catch (e) {}
  if (!host) return;
  new MutationObserver(function () {
    var m = mode();
    try { localStorage.setItem("graphify-theme", m); } catch (e) {}
    if (typeof window.applyTheme === "function") window.applyTheme(m);
  }).observe(host, { attributes: true, attributeFilter: ["class"] });
})();
</script>`;

// Appended before </head> so it wins over graph.html's own <style> (same specificity, later rule).
const STYLE_PATCH = `<style>
  :root {
    --bg: hsl(220 5% 7.5%); --panel: hsl(220 5% 10%); --border: hsl(220 5% 16%); --input-border: hsl(220 5% 20%);
    --text: hsl(0 0% 92%); --text-2: hsl(220 5% 64%); --text-3: hsl(0 0% 85%); --muted: hsl(220 5% 50%); --count: hsl(220 5% 56%);
    --neighbor-border: hsl(220 5% 22%); --node-label: hsl(0 0% 92%); --accent: hsl(220 75% 60%);
  }
  [data-theme="light"] {
    --bg: hsl(40 10% 99%); --panel: hsl(40 15% 96.5%); --border: hsl(40 8% 90%); --input-border: hsl(40 8% 84%);
    --text: hsl(220 15% 8%); --text-2: hsl(220 8% 40%); --text-3: hsl(220 15% 15%); --muted: hsl(220 8% 45%); --count: hsl(220 8% 45%);
    --neighbor-border: hsl(40 8% 84%); --node-label: hsl(220 15% 8%); --accent: hsl(220 70% 36%);
  }
  #theme-wrap { display: none !important; }
  #info-panel h3, #legend-wrap h3 { text-transform: none; letter-spacing: 0; font-size: 13px; font-weight: 600; color: var(--text); }
  #search:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent); }
  .legend-cb:checked, #select-all-cb:checked, #select-all-cb:indeterminate { background: var(--accent); border-color: var(--accent); }
  .legend-cb:focus-visible, #select-all-cb:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .legend-count, #stats { font-variant-numeric: tabular-nums; }
  ::selection { background: color-mix(in srgb, var(--accent) 30%, transparent); }
  * { scrollbar-width: thin; scrollbar-color: var(--input-border) transparent; }
</style>
`;

export async function GET() {
  try {
    let html = await readFile(path.join(OUT, "graph.html"), "utf8");
    html = html.replace("<head>", "<head>" + THEME_PATCH).replace("</head>", STYLE_PATCH + "</head>");
    return new NextResponse(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "frame-ancestors 'self'",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "graph.html not found. Click Rebuild or run: graphify update ." },
      { status: 404 },
    );
  }
}

// POST: rebuild graph (AST only, no LLM). Fixed argv, no user input. Single-flight.
// Listed in LOCAL_ONLY_PATHS in dashboardGuard.js since it spawns a process.
export async function POST() {
  if (!rebuilding) {
    rebuilding = run(GRAPHIFY_BIN, ["update", "."], { cwd: ROOT, timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 })
      .then(() => ({ ok: true }))
      .catch((e) => ({ ok: false, error: (e.stderr || e.message || "graphify failed").toString().slice(-2000) }))
      .finally(() => { rebuilding = null; });
  }
  const result = await rebuilding;
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
