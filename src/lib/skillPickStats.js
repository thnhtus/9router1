import { getAdapter } from "@/lib/db/driver.js";
import { getSkillCatalog } from "@/lib/piSkills.js";

const hourOf = (ms = Date.now()) => new Date(Math.floor(ms / 3600000) * 3600000).toISOString();

/** Record one pick attempt. skills = names actually injected (possibly empty). */
export async function recordSkillPick({ source, skills = [] }) {
  try {
    const a = await getAdapter();
    const hour = hourOf();
    const withSkill = skills.length ? 1 : 0;
    const names = [...new Set(skills.filter(Boolean))];
    a.transaction(() => {
      a.run(
        `INSERT INTO skillPickHourly(hour, source, skill, picks, requests, withSkill) VALUES(?,?,?,?,?,?)
         ON CONFLICT(hour, source, skill) DO UPDATE SET requests = requests + excluded.requests, withSkill = withSkill + excluded.withSkill`,
        [hour, source || "unknown", "", 0, 1, withSkill],
      );
      for (const name of names) {
        a.run(
          `INSERT INTO skillPickHourly(hour, source, skill, picks, requests, withSkill) VALUES(?,?,?,?,?,?)
           ON CONFLICT(hour, source, skill) DO UPDATE SET picks = picks + excluded.picks`,
          [hour, source || "unknown", name, 1, 0, 0],
        );
      }
    });
  } catch {
    /* stats must never break routing */
  }
}

/** Aggregates for the last `hours` whole-hour buckets (current included). */
export async function skillPickStats(hours = 24) {
  const a = await getAdapter();
  const h = Math.min(Math.max(Number(hours) || 24, 1), 24 * 90);
  const since = hourOf(Date.now() - (h - 1) * 3600000);
  const rows = a.all(
    `SELECT source, skill, SUM(picks) AS picks, SUM(requests) AS requests, SUM(withSkill) AS withSkill
     FROM skillPickHourly WHERE hour >= ? GROUP BY source, skill`,
    [since],
  );
  const bySource = [];
  const bySourceMap = new Map();
  const skillMap = new Map();
  const flows = [];
  for (const r of rows) {
    if (!r.skill) {
      const s = { source: r.source, requests: r.requests || 0, withSkill: r.withSkill || 0 };
      bySource.push(s);
      bySourceMap.set(r.source, s);
    } else {
      skillMap.set(r.skill, (skillMap.get(r.skill) || 0) + (r.picks || 0));
      flows.push({ source: r.source, target: r.skill, n: r.picks || 0 });
    }
  }
  bySource.sort((a, b) => b.requests - a.requests);
  const topSkills = [...skillMap.entries()]
    .map(([skill, picks]) => ({ skill, picks }))
    .sort((a, b) => b.picks - a.picks)
    .slice(0, 12);
  flows.sort((a, b) => b.n - a.n);
  let catalog = [];
  try {
    catalog = (await getSkillCatalog()).skills;
  } catch {
    catalog = [];
  }
  const catOf = new Map(catalog.map((s) => [s.name, s.category]));
  for (const f of flows) f.category = catOf.get(f.target) || "Other";
  const catMap = new Map();
  for (const f of flows) {
    const c = catMap.get(f.category) || { category: f.category, picks: 0, skills: 0 };
    c.picks += f.n;
    c.skills += 1;
    catMap.set(f.category, c);
  }
  const categories = [...catMap.values()].sort((a, b) => b.picks - a.picks);
  return { hours: h, bySource, topSkills, flows, categories };
}
