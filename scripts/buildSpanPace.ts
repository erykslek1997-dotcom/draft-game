import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';

/**
 * 2026-10-28, step 8 (tempo): each span's pace, for the live game's possessions. Two numbers, x10:
 *  - style: how much faster or slower than his league his own teams played in the window
 *    (BBRef team pace, 1973-74 on; minutes-weighted; 0 before 1973-74);
 *  - era: that league's pace (BBRef; before 1973-74 estimated from FGA + 0.44 FTA a game, which
 *    reads the 1974-85 paces at 1.01 of it).
 * `scripts/measurePace.ts`: from 1996-97 a team's pace over its league follows its players' paces
 * elsewhere at r 0.62.
 *
 *   npx tsx scripts/buildSpanPace.ts
 */
const RAW = resolve(import.meta.dirname, '../src/data/raw');
type TS = { season: string; team: string; pace: number };
const end = (s: string) => parseInt(s.slice(0, 4), 10) + 1;
const leaguePace = new Map<number, number>();
for (const l of readFileSync(resolve(RAW, 'leagueAverages.csv'), 'utf8').trim().split(/\r?\n/).slice(1)) {
  const c = l.split(',');
  if (c[2] !== 'NBA' || !c[9]) continue;
  const y = end(c[1]);
  const pace = c[26] ? Number(c[26]) : 1.009 * (Number(c[9]) + 0.44 * Number(c[13]));
  if (Number.isFinite(pace) && pace > 0) leaguePace.set(y, pace);
}
const teamPace = new Map((teamSeasons as TS[]).map((t) => [`${end(t.season)}|${t.team}`, t.pace]));
const rows = readFileSync(resolve(RAW, 'playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { id: m[1], name: normalizePlayerName(m[2].replace(/^"|"$/g, '')), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byName = Object.groupBy(rows, (r) => r.name);
const out: Record<string, [number, number]> = {};
let styled = 0;
for (const span of draftPool) {
  const years = new Set(spanEndYears(span.spanLabel));
  const mine = (byName[normalizePlayerName(span.playerName)] ?? []).filter((r) => years.has(r.end));
  let w = 0, dev = 0, ew = 0, era = 0;
  for (const r of mine) {
    const lp = leaguePace.get(r.end);
    if (lp) { era += r.minutes * lp; ew += r.minutes; }
    const tp = teamPace.get(`${r.end}|${r.team}`);
    if (tp && lp) { dev += r.minutes * (tp - lp); w += r.minutes; }
  }
  if (ew === 0) {
    const ys = [...years].map((y) => leaguePace.get(y)).filter((p): p is number => Boolean(p));
    if (ys.length) { era = ys.reduce((a, b) => a + b, 0); ew = ys.length; }
  }
  if (w > 0) styled++;
  out[span.id] = [Math.round((w > 0 ? dev / w : 0) * 10), Math.round((ew > 0 ? era / ew : 99) * 10)];
}
writeFileSync(resolve(import.meta.dirname, '../src/data/spanPace.json'), JSON.stringify(out));
console.log(`spanPace.json: ${Object.keys(out).length} spans, ${styled} with a measured style`);
