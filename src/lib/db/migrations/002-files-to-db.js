// One-time import of state that used to live in loose files under DATA_DIR:
//   pxpipe/events.jsonl(.1) → pxpipeEvents, tunnel/state.json → kv('tunnel','state').
// Files are left in place (rollback = downgrade); schemaVersion stops a re-import.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";
import { TABLES, buildCreateTableSql } from "../schema.js";

function readLines(file) {
  try { return fs.readFileSync(file, "utf8").split("\n"); } catch { return []; }
}

export default {
  version: 2,
  name: "files-to-db",
  up(db) {
    db.exec(buildCreateTableSql("pxpipeEvents", TABLES.pxpipeEvents));
    for (const idx of TABLES.pxpipeEvents.indexes) db.exec(idx);

    const dir = path.join(DATA_DIR, "pxpipe");
    for (const file of ["events.jsonl.1", "events.jsonl"].map((f) => path.join(dir, f))) {
      for (const line of readLines(file)) {
        let ev;
        try { ev = JSON.parse(line); } catch { continue; } // blank/corrupt line
        if (!Number.isFinite(ev?.ts)) continue;
        db.run(`INSERT INTO pxpipeEvents(ts, data) VALUES(?, ?)`, [ev.ts, line]);
      }
    }

    try {
      const state = fs.readFileSync(path.join(DATA_DIR, "tunnel", "state.json"), "utf8");
      JSON.parse(state); // skip a corrupt file instead of storing it
      db.run(`INSERT OR IGNORE INTO kv(scope, key, value) VALUES('tunnel', 'state', ?)`, [state]);
    } catch { /* no state yet */ }
  },
};
