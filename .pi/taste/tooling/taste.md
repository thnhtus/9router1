# Tooling
- For UI clicks and checks in the running app, use the browseros-neo browser tool and review the actual responses yourself instead of asking the user to click. Confidence: 0.55
- Wants charts/data visualizations built with D3.js (https://d3js.org/). Confidence: 0.5
- To analyze external UI reference pages (e.g. affectui.com components) before adapting them into the project, use the `rea` tool (e.g. `rea capture-browser-scenario`). Confidence: 0.6
- Wants DB/schema integration and migration work gated (validated) through the Supabase MCP. Confidence: 0.55
- Prefers moving app state that fits a DB (file-based logs and state) into the DB, with migrations to import the existing data. Confidence: 0.35
- For UI polish tasks, apply the impeccable skill together with the /taste design principles. Confidence: 0.65
