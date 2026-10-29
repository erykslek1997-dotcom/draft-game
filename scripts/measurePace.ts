import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { normalizePlayerName } from '../src/data/schema';

/**
 * 2026-10-28, step 8 (tempo; TODO: "every game is 200 possessions; NBA teams differ by SD ~2.4"):
 * does a team's pace follow its players? Each player-season's pace = his team's pace over that
 * season's league (BBRef team-seasons). For every team-season from `FROM` on: its pace over the
 * league against the minutes-weighted mean of its players' paces in their OTHER seasons (so the
 * team's own season is not read back). Also each era's league pace.
 *
 *   FROM=1997 npx tsx scripts/measurePace.ts
 */
const FROM = Number(process.env.FROM ?? 1997);
type TS = { season: string; team: string; pace: number };
const ts = teamSeasons as TS[];
const end = (s: string) => parseInt(s.slice(0, 4), 10) + 1;
const leaguePace = new Map<number, number>();
for (const [y, g] of Object.entries(Object.groupBy(ts, (t) => String(end(t.season))))) leaguePace.set(Number(y), g!.reduce((a, t) => a + t.pace, 0) / g!.length);
const paceOf = new Map(ts.map((t) => [`${end(t.season)}|${t.team}`, t.pace - leaguePace.get(end(t.season))!]));
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: normalizePlayerName(m[2].replace(/^"|"$/g, '')), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null && paceOf.has(`${r.end}|${r.team}`));
const byPlayer = Object.groupBy(roster, (r) => r.name);
const playerPaceExcept = (name: string, year: number, team: string) => {
  const g = (byPlayer[name] ?? []).filter((r) => !(r.end === year && r.team === team) && r.minutes >= 500);
  const w = g.reduce((a, r) => a + r.minutes, 0);
  return w > 0 ? { pace: g.reduce((a, r) => a + r.minutes * paceOf.get(`${r.end}|${r.team}`)!, 0) / w, w } : null;
};
const rows: { y: number; x: number }[] = [];
for (const [key, g] of Object.entries(Object.groupBy(roster, (r) => `${r.end}|${r.team}`))) {
  const [year, team] = [Number(key.split('|')[0]), key.slice(key.indexOf('|') + 1)];
  if (year < FROM) continue;
  const top = [...g!].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  let w = 0, s = 0;
  for (const r of top) {
    const p = playerPaceExcept(r.name, year, team);
    if (!p) continue;
    s += r.minutes * p.pace;
    w += r.minutes;
  }
  if (w < 0.6 * top.reduce((a, r) => a + r.minutes, 0)) continue;
  rows.push({ y: paceOf.get(key)!, x: s / w });
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
const mx = mean(rows.map((r) => r.x)), my = mean(rows.map((r) => r.y));
let a = 0, b = 0, c = 0;
for (const r of rows) { a += (r.x - mx) * (r.y - my); b += (r.x - mx) ** 2; c += (r.y - my) ** 2; }
console.log(`${rows.length} team-seasons from ${FROM}: team pace over league SD ${sd(rows.map((r) => r.y)).toFixed(2)}; players' pace elsewhere SD ${sd(rows.map((r) => r.x)).toFixed(2)}; r ${(a / Math.sqrt(b * c)).toFixed(3)}, slope ${(a / b).toFixed(2)}`);
console.log('league pace by decade:', [...Object.entries(Object.groupBy([...leaguePace], ([y]) => String(Math.floor((y - 1) / 10) * 10)))].map(([d, g]) => `${d}s ${mean(g!.map(([, p]) => p)).toFixed(1)}`).join(', '));
