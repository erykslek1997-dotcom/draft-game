// 2026-11-18 (the user's review → measured): does the structure the user reads in a five explain real
// ORtg beyond the engine's raw Offense? Starting five = top-5 minutes. Features from the skills; real
// ORtg and raw Offense season-centred; fit on even seasons, checked on odd.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { offenseScoreBreakdown } from '../src/engine/scoring';
import { skill, dataUsageDemand } from '../src/engine/skills';
import type { Team } from '../src/engine/types';
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) { const k = normalizePlayerName(s.playerName); byName.set(k, [...(byName.get(k) ?? []), s]); }
const spanFor = (name: string, end: number) => (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => { const m = (s: PlayerSpan) => { const y = spanEndYears(s.spanLabel); return Math.abs(y[Math.floor(y.length / 2)] - end); }; return m(a) - m(b); })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => { const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/); return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null; }).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const g = (s: PlayerSpan, k: any) => skill(s, k) ?? 50;
const FEATS: Record<string, (f: PlayerSpan[]) => number> = {
  bestShooter: (f) => Math.max(...f.map((s) => Math.max(g(s, 'pullUp3'), g(s, 'spotUp')))),
  eliteGravity: (f) => Math.max(0, Math.max(...f.map((s) => g(s, 'pullUp3'))) - 90),
  nonShooters: (f) => f.filter((s) => g(s, 'spotUp') < 35 && g(s, 'stretch') < 35).length,
  ballLoad: (f) => f.map((s) => dataUsageDemand(s) ?? 0.3).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0),
  thirdBall: (f) => f.map((s) => dataUsageDemand(s) ?? 0.3).sort((a, b) => b - a)[2],
  secondRim: (f) => f.map((s) => g(s, 'rimPressure')).sort((a, b) => b - a)[1],
  secondPost: (f) => f.map((s) => g(s, 'post')).sort((a, b) => b - a)[1],
  bestCreator: (f) => Math.max(...f.map((s) => g(s, 'selfCreation'))),
  offBallNonShootGuard: (f) => f.filter((s) => (s.primaryPosition === 'PG' || s.primaryPosition === 'SG') && g(s, 'spotUp') < 40 && (dataUsageDemand(s) ?? 0.3) < 0.25).length,
};
type R = { end: number; o: number; real: number; f: Record<string, number> };
const rows: R[] = [];
for (const ts of teamSeasons as { season: string; team: string; ortg: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  if (end < 1998) continue;
  const top = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const team: Team = { id: ts.team, name: ts.team, draftSlot: 1, isHuman: false, roster: spans as PlayerSpan[], rotation: autoAssignRotation(spans as PlayerSpan[]) };
  const five = (spans as PlayerSpan[]).slice(0, 5);
  rows.push({ end, o: offenseScoreBreakdown(team).raw, real: ts.ortg, f: Object.fromEntries(Object.entries(FEATS).map(([k, fn]) => [k, fn(five)])) });
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
for (const grp of Object.values(Object.groupBy(rows, (r) => String(r.end)))) { const mo = mean(grp!.map((r) => r.o)), mr = mean(grp!.map((r) => r.real)); for (const r of grp!) { r.o -= mo; r.real -= mr; } }
const corr = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; c += (y[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const slope = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0; x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; }); return a / b; };
const s0 = slope(rows.map((r) => r.o), rows.map((r) => r.real));
const miss = rows.map((r) => r.real - s0 * r.o);
console.log(`${rows.length} team-seasons 1998+. Offense raw vs ORtg r ${corr(rows.map((r) => r.o), rows.map((r) => r.real)).toFixed(3)}`);
console.log('feature              r(ORtg)   r(miss)   even r(miss)  odd r(miss)');
const even = rows.map((r, i) => [r, miss[i]] as const).filter(([r]) => r.end % 2 === 0), odd = rows.map((r, i) => [r, miss[i]] as const).filter(([r]) => r.end % 2 === 1);
for (const k of Object.keys(FEATS)) console.log(`${k.padEnd(20)} ${corr(rows.map((r) => r.f[k]), rows.map((r) => r.real)).toFixed(2).padStart(7)}  ${corr(rows.map((r) => r.f[k]), miss).toFixed(2).padStart(7)}  ${corr(even.map(([r]) => r.f[k]), even.map(([, m]) => m)).toFixed(2).padStart(10)}  ${corr(odd.map(([r]) => r.f[k]), odd.map(([, m]) => m)).toFixed(2).padStart(10)}`);
