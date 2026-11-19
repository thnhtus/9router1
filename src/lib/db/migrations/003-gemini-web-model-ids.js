// gemini-web advertised model ids were re-calibrated against the real
// gemini.google.com mode picker (Auto / Everyday help / Deeper analysis).
// Instances that ran the old ids keep two kinds of residue:
//   1. kv('customModels') rows for gemini-* ids that were never real UI modes
//      (so the dashboard lists a model the executor cannot select), and
//   2. modelLock_<old-id> fields on gemini-web connections. Those ids are still
//      accepted by the executor's LEGACY_ALIASES map, but the lock key can
//      never be cleared by a request for the new id, so it sticks forever and
//      makes the connection look unhealthy.
// Runtime resolution is unaffected either way — this only cleans stored state.
import registry from "../../../../open-sse/providers/registry/gemini-web.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const PROVIDER = "gemini-web";

function currentModelIds() {
    return new Set((registry.models || []).map((m) => m.id));
}

export default {
    version: 3,
    name: "gemini-web-model-ids",
    up(db) {
        const ids = currentModelIds();
        if (!ids.size) return;

        // 1. Drop phantom custom models for this provider (unknown ids only —
        //    a user-added alias that still resolves is left alone).
        const rows = db.all(
            `SELECT key, value FROM kv WHERE scope = 'customModels'`,
        );
        for (const row of rows) {
            const entry = parseJson(row.value);
            if (!entry || entry.providerAlias !== PROVIDER) continue;
            if (ids.has(entry.id)) continue;
            db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [
                row.key,
            ]);
        }

        // 2. Drop modelLock_* keys naming an id that is no longer advertised.
        const conns = db.all(
            `SELECT id, data FROM providerConnections WHERE provider = ?`,
            [PROVIDER],
        );
        for (const conn of conns) {
            const data = parseJson(conn.data);
            if (!data) continue;
            const stale = Object.keys(data).filter(
                (k) =>
                    k.startsWith("modelLock_") &&
                    !ids.has(k.slice("modelLock_".length)),
            );
            if (!stale.length) continue;
            for (const k of stale) delete data[k];
            db.run(`UPDATE providerConnections SET data = ? WHERE id = ?`, [
                stringifyJson(data),
                conn.id,
            ]);
        }
    },
};
