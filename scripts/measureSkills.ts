/**
 * 2026-11-18, the skills judge (`src/data/skills.json`, 1997+): does each skill line up with how real
 * teams and real five-man units scored and defended, and does it say anything the engine does not?
 *
 *   npx tsx scripts/measureSkills.ts
 *
 * Teams: every team-season from 1997-98 whose top eight (by minutes) are in the pool with skills; a
 * skill's team value is the minutes-weighted mean of its top eight (a missing value counts 50).
 * Real ORtg / DRtg are centred on the season (DRtg flipped: + = better defense). Printed per skill:
 * r with real offense and defense, and r with what the engine's Offense / Defense score misses
 * (the season-centred residual). Units: 5-man units of 200+ minutes, the same against their real
 * ORtg / DRtg relative to the season's league.
 * Caution: point of attack and help use on/off, RAPTOR and matchup defense, which themselves partly
 * come from team results — their r with real defense is not independent evidence.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import lineups from '../src/data/awards/lineups5.json';
import skillsData from '../src/data/skills.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

const SK = skillsData as Record<string, Record<string, number>>;
const SKILLS = [...new Set(Object.values(SK).flatMap((r) => Object.keys(r)))];
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) { const k = normalizePlayerName(s.playerName); byName.set(k, [...(byName.get(k) ?? []), s]); }
const spanFor = (name: string, end: number) => (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end) && SK[s.id]).sort((a, b) => { const m = (s: PlayerSpan) => { const y = spanEndYears(s.spanLabel); return Math.abs(y[Math.floor(y.length / 2)] - end); }; return m(a) - m(b); })[0];
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; c += (y[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const resid = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let a = 0, b = 0; x.forEach((v, i) => { a += (v - mx) * (y[i] - my); b += (v - mx) ** 2; }); const s = a / b; return y.map((v, i) => v - my - s * (x[i] - mx)); };

// Teams.
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
type T = { end: number; ortg: number; drtg: number; off: number; def: number; sk: Record<string, number> };
const teams: T[] = [];
for (const ts of teamSeasons as { season: string; team: string; ortg: number; drtg: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  if (end < 1998) continue;
  const top = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const w = top.map((r) => r.minutes), W = w.reduce((a, b) => a + b, 0);
  const team: Team = { id: ts.team, name: ts.team, draftSlot: 1, isHuman: false, roster: spans as PlayerSpan[], rotation: autoAssignRotation(spans as PlayerSpan[]) };
  const b = scoreTeam(team);
  const sk = Object.fromEntries(SKILLS.map((k) => [k, (spans as PlayerSpan[]).reduce((t, s, i) => t + (SK[s.id][k] ?? 50) * w[i], 0) / W]));
  teams.push({ end, ortg: ts.ortg, drtg: -ts.drtg, off: b.offenseScore, def: b.defenseScore, sk });
}
// Centre per season.
for (const g of Object.values(Object.groupBy(teams, (t) => String(t.end)))) {
  const keys = ['ortg', 'drtg', 'off', 'def'] as const;
  const m = Object.fromEntries(keys.map((k) => [k, mean(g!.map((t) => t[k]))]));
  for (const t of g!) for (const k of keys) t[k] -= m[k];
}
const ro = teams.map((t) => t.ortg), rd = teams.map((t) => t.drtg);
const missO = resid(teams.map((t) => t.off), ro), missD = resid(teams.map((t) => t.def), rd);
console.log(`${teams.length} team-seasons 1997-98 on. Engine: Offense vs real ORtg r ${corr(teams.map((t) => t.off), ro).toFixed(3)}, Defense vs real DRtg r ${corr(teams.map((t) => t.def), rd).toFixed(3)}`);
console.log('skill            real ORtg   real DRtg   | what the engine misses: offense  defense');
for (const k of SKILLS) {
  const x = teams.map((t) => t.sk[k]);
  console.log(`${k.padEnd(16)} ${corr(x, ro).toFixed(2).padStart(8)}  ${corr(x, rd).toFixed(2).padStart(10)}   | ${corr(x, missO).toFixed(2).padStart(30)}  ${corr(x, missD).toFixed(2).padStart(7)}`);
}

// Units.
const league = new Map<string, { o: number; d: number }>();
for (const [s, g] of Object.entries(Object.groupBy(teamSeasons as { season: string; ortg: number; drtg: number }[], (t) => t.season))) league.set(s, { o: mean(g!.map((t) => t.ortg)), d: mean(g!.map((t) => t.drtg)) });
const us: { o: number; d: number; sk: Record<string, number> }[] = [];
for (const u of lineups as { season: string; players: string[]; min: number; ortg: number; drtg: number }[]) {
  if (u.min < 200 || !league.has(u.season)) continue;
  const end = parseInt(u.season.slice(0, 4), 10) + 1;
  const five = u.players.map((p) => spanFor(p, end));
  if (five.some((s) => !s)) continue;
  const lg = league.get(u.season)!;
  us.push({ o: u.ortg - lg.o, d: lg.d - u.drtg, sk: Object.fromEntries(SKILLS.map((k) => [k, mean((five as PlayerSpan[]).map((s) => SK[s.id][k] ?? 50))])) });
}
console.log(`\n${us.length} five-man units of 200+ minutes`);
console.log('skill            unit ORtg   unit DRtg');
for (const k of SKILLS) console.log(`${k.padEnd(16)} ${corr(us.map((u) => u.sk[k]), us.map((u) => u.o)).toFixed(2).padStart(8)}  ${corr(us.map((u) => u.sk[k]), us.map((u) => u.d)).toFixed(2).padStart(10)}`);
