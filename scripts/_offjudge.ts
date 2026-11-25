// Fast judge (2026-11-18): the engine's Offense score against real ORtg, season-centred, no sim —
// all covered team-seasons, and even / odd seasons apart. Same team set as auditSimReal.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { offenseScoreBreakdown } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) { const k = normalizePlayerName(s.playerName); byName.set(k, [...(byName.get(k) ?? []), s]); }
const PRIOR = process.env.PRIOR === '1';
const spanFor = (name: string, end: number) => PRIOR ? (byName.get(normalizePlayerName(name)) ?? []).filter((s) => Math.max(...spanEndYears(s.spanLabel)) < end).sort((a, b) => Math.max(...spanEndYears(b.spanLabel)) - Math.max(...spanEndYears(a.spanLabel)))[0] : (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => { const m = (s: PlayerSpan) => { const y = spanEndYears(s.spanLabel); return Math.abs(y[Math.floor(y.length / 2)] - end); }; return m(a) - m(b); })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => { const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/); return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null; }).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const rows: { end: number; o: number; real: number }[] = [];
for (const ts of teamSeasons as { season: string; team: string; ortg: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  const top = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const team: Team = { id: ts.team, name: ts.team, draftSlot: 1, isHuman: false, roster: spans as PlayerSpan[], rotation: autoAssignRotation(spans as PlayerSpan[]) };
  rows.push({ end, o: offenseScoreBreakdown(team).raw, real: ts.ortg });
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
console.log(`raw mean ${mean(rows.map((r) => r.o)).toFixed(2)}`);
for (const g of Object.values(Object.groupBy(rows, (r) => String(r.end)))) { const mo = mean(g!.map((r) => r.o)), mr = mean(g!.map((r) => r.real)); for (const r of g!) { r.o -= mo; r.real -= mr; } }
const corr = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; c += (y[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const r = (f: (x: { end: number }) => boolean) => { const g = rows.filter(f); return corr(g.map((x) => x.o), g.map((x) => x.real)).toFixed(4); };
console.log(`offense r all ${r(() => true)} even ${r((x) => x.end % 2 === 0)} odd ${r((x) => x.end % 2 === 1)} (n ${rows.length})`);
console.log(`y74-79 ${r((x) => x.end <= 1979)} y80-90 ${r((x) => x.end >= 1980 && x.end <= 1990)}`);
