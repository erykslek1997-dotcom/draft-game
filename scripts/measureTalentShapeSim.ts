/** 2026-10-29: Talent shapes (today, no floor, minutes at slot) against the mechanics margin on AI-drafted teams, plus the playtest-6 roster. npx tsx scripts/measureTalentShapeSim.ts */
import benchTeams from '../src/data/benchTeams.json';
import { spanById } from '../src/engine/bestFive';
import { mechanicsMargin } from '../src/engine/liveGame';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { effectiveTalent } from '../src/engine/grades';
import { durabilityValueFactor } from '../src/engine/durability';
import { draftPool } from '../src/data/draftPool';
import type { Team } from '../src/engine/types';
import type { PlayerSpan } from '../src/data/schema';
const leagues = benchTeams as { teams: { name: string; ids: string[] }[] }[];
const teamOf = (ids: string[], id: string): Team => { const roster = ids.map(spanById).filter((s): s is PlayerSpan => Boolean(s)); return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) }; };
const tal = (s: PlayerSpan) => effectiveTalent(s) * durabilityValueFactor(s);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const yard = leagues.slice(0, 4).map((lg, L) => { const ts = lg.teams.map((t, i) => teamOf(t.ids, `y${L}-${i}`)); return ts.sort((a, b) => scoreTeam(a).overallExact - scoreTeam(b).overallExact)[Math.floor(ts.length / 2)]; });
const shape = (team: Team) => {
  const by = new Map(team.roster.map((s) => [s.id, s]));
  const sl = Object.values(team.rotation!.slots).flat();
  const minW = sl.reduce((s, a) => s + tal(by.get(a.playerId)!) * a.minutes, 0) / sl.reduce((s, a) => s + a.minutes, 0);
  const st = Object.values(team.rotation!.slots).map((a) => tal(by.get(a[0].playerId)!));
  return { today: scoreTeam(team).talentScore, noFloor: mean(st), minW };
};
const rows: { m: number; off: number; def: number; v: Record<string, number> }[] = [];
for (const [L, lg] of leagues.slice(4, 12).entries()) for (const [i, t] of lg.teams.entries()) {
  const team = teamOf(t.ids, `m${L}-${i}`); const b = scoreTeam(team);
  rows.push({ m: mean(yard.map((y) => mechanicsMargin(team, y))), off: b.offenseScore, def: b.defenseScore, v: shape(team) });
}
const corr = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const resid2 = (ys: number[], x1: number[], x2: number[]) => { const m1 = mean(x1), m2 = mean(x2), my = mean(ys); let s11 = 0, s22 = 0, s12 = 0, s1y = 0, s2y = 0; ys.forEach((y, i) => { const a = x1[i] - m1, b = x2[i] - m2, c = y - my; s11 += a * a; s22 += b * b; s12 += a * b; s1y += a * c; s2y += b * c; }); const det = s11 * s22 - s12 * s12, b1 = (s1y * s22 - s2y * s12) / det, b2 = (s2y * s11 - s1y * s12) / det; return ys.map((y, i) => y - my - b1 * (x1[i] - m1) - b2 * (x2[i] - m2)); };
const off = rows.map((r) => r.off), def = rows.map((r) => r.def), m = rows.map((r) => r.m), mR = resid2(m, off, def);
console.log(`${rows.length} AI-drafted teams; judge: mechanics margin`);
for (const k of Object.keys(rows[0].v)) { const v = rows.map((r) => r.v[k]); console.log(`  ${k.padEnd(10)} r ${corr(v, m).toFixed(3)}, beyond O+D ${corr(resid2(v, off, def), mR).toFixed(3)}`); }
// the user's case
const find = (n: string, y: string) => draftPool.find((p) => p.playerName === n && p.spanLabel === y)!;
const five = [find('Chauncey Billups','2004-06'), find('Klay Thompson','2017-18'), find('Kawhi Leonard','2015-17'), find('Chet Holmgren','2023-25'), find("Shaquille O'Neal",'2000-02')];
const bench = [find('George Hill','2013-15'), find('Nicolas Batum','2012-14'), find('Andrew Bogut','2013-15')].filter(Boolean);
const team: Team = { id: 'u', name: 'u', draftSlot: 1, isHuman: false, roster: [...five, ...bench], rotation: autoAssignRotation([...five, ...bench]) };
console.log('user case', shape(team));
const all = rows.map((r) => r.v);
for (const k of ['today','noFloor','minW']) { const v = all.map((x) => x[k]); const mu = mean(v); console.log(k, 'field mean', mu.toFixed(1), 'sd', Math.sqrt(mean(v.map((x) => (x - mu) ** 2))).toFixed(2)); }
