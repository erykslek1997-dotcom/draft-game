import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { teamSpacingValue } from '../src/engine/midrangeGravity';

/**
 * 2026-10-28 (the user: better spacing makes it easier to get the ball to the post — hard to
 * measure?): NBA.com tracking 2013-14 on, post touches and points per post touch of every player
 * with real post volume, against the spacing of his teammates that season (the engine's spacing
 * value of his team's other top-8-minute players, minutes-weighted). Within the same player
 * (each player's seasons centred on his own mean), so it reads "the same big beside better shooters".
 *
 *   npx tsx scripts/measurePostSpacing.ts
 */
const RAW = resolve(import.meta.dirname, '../src/data/raw');
const csv = (f: string) => {
  const [h, ...ls] = readFileSync(resolve(RAW, f), 'utf8').trim().split(/\r?\n/);
  const c = h.split(',');
  return ls.map((l) => Object.fromEntries(l.split(',').map((v, i) => [c[i], v])));
};
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) byName.set(normalizePlayerName(s.playerName), [...(byName.get(normalizePlayerName(s.playerName)) ?? []), s]);
const spanFor = (name: string, end: number) =>
  (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => {
    const mid = (s: PlayerSpan) => { const ys = spanEndYears(s.spanLabel); return Math.abs(ys[Math.floor(ys.length / 2)] - end); };
    return mid(a) - mid(b);
  })[0];
const roster = readFileSync(resolve(RAW, 'playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const teamsOf = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const teamOfPlayer = new Map<string, string>();
for (const r of roster) {
  const k = `${normalizePlayerName(r.name)}|${r.end}`;
  const prev = teamOfPlayer.get(k);
  if (!prev || (teamsOf[`${r.end}|${prev}`]!.find((x) => normalizePlayerName(x.name) === normalizePlayerName(r.name))!.minutes < r.minutes)) teamOfPlayer.set(k, r.team);
}

type Row = { who: string; season: string; touches36: number; ppt: number; mates: number };
const rows: Row[] = [];
for (const r of csv('nbaStats/player_possessions.csv')) {
  const min = Number(r.MIN);
  if (min < 1000) continue;
  const touches36 = (Number(r.POST_TOUCHES) / min) * 36; // season totals
  if (touches36 < 3) continue; // a real post player: 3+ post touches a 36 minutes
  const end = parseInt(r.SEASON.slice(0, 4), 10) + 1;
  const team = teamOfPlayer.get(`${normalizePlayerName(r.PLAYER_NAME)}|${end}`);
  if (!team) continue;
  const mates = [...(teamsOf[`${end}|${team}`] ?? [])].filter((x) => normalizePlayerName(x.name) !== normalizePlayerName(r.PLAYER_NAME)).sort((a, b) => b.minutes - a.minutes).slice(0, 7);
  let w = 0, sum = 0;
  for (const m of mates) {
    const s = spanFor(m.name, end);
    if (!s) continue;
    sum += m.minutes * teamSpacingValue(s);
    w += m.minutes;
  }
  if (w < 4000) continue;
  rows.push({ who: r.PLAYER_NAME, season: r.SEASON, touches36, ppt: Number(r.PTS_PER_POST_TOUCH), mates: sum / w });
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
// Within player: centre each on his own mean; keep players with 2+ seasons.
const byP = Object.groupBy(rows, (r) => r.who);
const within = Object.values(byP).filter((g) => g!.length >= 2).flatMap((g) => {
  const mt = mean(g!.map((r) => r.touches36)), mp = mean(g!.map((r) => r.ppt)), mm = mean(g!.map((r) => r.mates));
  return g!.map((r) => ({ t: r.touches36 - mt, p: r.ppt - mp, m: (r.mates - mm) / 10 }));
});
const slope = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; }); return a / b; };
let seed = 9;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ci = (f: (s: typeof within) => number) => { const v = Array.from({ length: 400 }, () => f(within.map(() => within[Math.floor(rnd() * within.length)]))).sort((a, b) => a - b); return `${v[20].toFixed(3)}…${v[380].toFixed(3)}`; };
console.log(`${rows.length} post-player seasons (3+ post touches a 36, 1000+ min), ${within.length} within ${Object.values(byP).filter((g) => g!.length >= 2).length} players with 2+ seasons`);
console.log(`means: ${mean(rows.map((r) => r.touches36)).toFixed(1)} post touches a 36, ${mean(rows.map((r) => r.ppt)).toFixed(3)} points a post touch`);
console.log(`per +10 teammates' spacing, same player: post touches a 36 ${slope(within.map((r) => r.m), within.map((r) => r.t)).toFixed(2)} (${ci((s) => slope(s.map((r) => r.m), s.map((r) => r.t)))}), points a post touch ${slope(within.map((r) => r.m), within.map((r) => r.p)).toFixed(3)} (${ci((s) => slope(s.map((r) => r.m), s.map((r) => r.p)))})`);
