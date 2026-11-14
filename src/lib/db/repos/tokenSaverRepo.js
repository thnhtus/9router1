import { getAdapter } from "../driver.js";

// Hourly token-saver counters (see tokenSaverHourly in schema.js). Kept forever,
// small rows, so stats survive restarts and the requestDetails cap. Fire-and-forget:
// stats must never break the request path.

const hourOf = (ms = Date.now()) => new Date(Math.floor(ms / 3600000) * 3600000).toISOString();

export function bumpTokenSaverHourly({
  level = "",
  lossyApplied = 0,
  lossyBlocked = 0,
  lossyOff = 0,
  rtkHits = 0,
  headroomSaved = 0,
  caveman = 0,
  pxpipe = 0,
  custom = 0,
  ponytail = 0,
}) {
  getAdapter().then((a) => {
    a.run(
      `INSERT INTO tokenSaverHourly(hour, level, total, lossyApplied, lossyBlocked, lossyOff, rtkHits, headroomSaved, caveman, pxpipe, custom, ponytail)
       VALUES(?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(hour, level) DO UPDATE SET
         total = total + 1,
         lossyApplied = lossyApplied + excluded.lossyApplied,
         lossyBlocked = lossyBlocked + excluded.lossyBlocked,
         lossyOff = lossyOff + excluded.lossyOff,
         rtkHits = rtkHits + excluded.rtkHits,
         headroomSaved = headroomSaved + excluded.headroomSaved,
         caveman = caveman + excluded.caveman,
         pxpipe = pxpipe + excluded.pxpipe,
         custom = custom + excluded.custom,
         ponytail = ponytail + excluded.ponytail`,
      [hourOf(), level || "", lossyApplied, lossyBlocked, lossyOff, rtkHits, headroomSaved, caveman, pxpipe, custom, ponytail],
    );
  }).catch(() => { /* stats must not break requests */ });
}

/** Aggregates over the last `hours` (whole hour buckets, current included). */
export async function tokenSaverStats(hours = 24) {
  const a = await getAdapter();
  const since = hourOf(Date.now() - (hours - 1) * 3600000);

  const summary = a.get(
    `SELECT SUM(total) AS total, SUM(lossyApplied) AS lossyApplied, SUM(lossyBlocked) AS lossyBlocked,
            SUM(lossyOff) AS lossyOff, SUM(rtkHits) AS rtkHits, SUM(headroomSaved) AS headroomSaved
     FROM tokenSaverHourly WHERE hour >= ?`,
    [since],
  ) || {};

  const byLevel = a.all(
    `SELECT level, SUM(total) AS total, SUM(lossyApplied) AS lossyApplied, SUM(lossyBlocked) AS lossyBlocked,
            SUM(lossyOff) AS lossyOff, SUM(rtkHits) AS rtkHits, SUM(headroomSaved) AS headroomSaved
     FROM tokenSaverHourly WHERE hour >= ? GROUP BY level ORDER BY level`,
    [since],
  );

  const timeline = a.all(
    `SELECT substr(hour, 1, 10) AS date, SUM(total) AS total, SUM(lossyApplied) AS lossyApplied,
            SUM(lossyBlocked) AS lossyBlocked, SUM(headroomSaved) AS headroomSaved
     FROM tokenSaverHourly WHERE hour >= ? GROUP BY substr(hour, 1, 10) ORDER BY date`,
    [since],
  );

  const num = (k) => Number(summary[k] || 0);
  return {
    hours,
    summary: {
      total: num("total"),
      lossyApplied: num("lossyApplied"),
      lossyBlocked: num("lossyBlocked"),
      lossyOff: num("lossyOff"),
      rtkHits: num("rtkHits"),
      headroomSaved: num("headroomSaved"),
    },
    byLevel,
    timeline,
  };
}
