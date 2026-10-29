import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import benchTeams from '../src/data/benchTeams.json';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanById } from '../src/engine/bestFive';
import { durabilityValueFactor } from '../src/engine/durability';
import { spanEndYears } from '../src/engine/era';
import { effectiveTalent } from '../src/engine/grades';
import { mechanicsMargin } from '../src/engine/liveGame';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-29, step 4 of the audit follow-up (the user: "Co z tym zrobić"; Talent by minutes won on
 * real teams and lost in the game): how much a bench is worth in each world. Both fit the same
 * two-variable line — margin on the starters' mean TAL and the bench's minutes-weighted TAL (from the
 * engine's rotation) — real team-seasons on SRS, the bench leagues on the game's mechanics margin
 * against median teams. The bench / starters ratio says how much the game rewards depth next to how
 * much basketball did. Also: the minutes the game's rotation gives the bench.
 *
 *   npx tsx scripts/measureBenchWorlds.ts
 */
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const tal = (s: PlayerSpan) => effectiveTalent(s) * durabilityValueFactor(s);
const split = (team: Team) => {
  const by = new Map(team.roster.map((s) => [s.id, s]));
  const slots = Object.values(team.rotation!.slots);
  const starters = slots.map((a) => a[0].playerId);
  const bench = slots.flatMap((a) => a.slice(1));
  const bMin = bench.reduce((s, a) => s + a.minutes, 0);
  return { st: mean(starters.map((id) => tal(by.get(id)!))), bn: bMin ? bench.reduce((s, a) => s + tal(by.get(a.playerId)!) * a.minutes, 0) / bMin : 0, bMin };
};
const fit2 = (y: number[], a: number[], b: number[]) => {
  const ma = mean(a), mb = mean(b), my = mean(y);
  let saa = 0, sbb = 0, sab = 0, say = 0, sby = 0;
  y.forEach((v, i) => { const x1 = a[i] - ma, x2 = b[i] - mb, z = v - my; saa += x1 * x1; sbb += x2 * x2; sab += x1 * x2; say += x1 * z; sby += x2 * z; });
  const det = saa * sbb - sab * sab;
  const bA = (say * sbb - sby * sab) / det, bB = (sby * saa - say * sab) / det;
  const se = (k: number) => { const res = y.map((v, i) => v - my - bA * (a[i] - ma) - bB * (b[i] - mb)); const s2 = res.reduce((s, r) => s + r * r, 0) / (y.length - 3); return Math.sqrt((s2 * (k === 0 ? sbb : saa)) / det); };
  return { bA, bB, seA: se(0), seB: se(1) };
};

const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) byName.set(normalizePlayerName(s.playerName), [...(byName.get(normalizePlayerName(s.playerName)) ?? []), s]);
const spanFor = (name: string, end: number) =>
  (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => {
    const mid = (s: PlayerSpan) => { const ys = spanEndYears(s.spanLabel); return Math.abs(ys[Math.floor(ys.length / 2)] - end); };
    return mid(a) - mid(b);
  })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const real: { y: number; st: number; bn: number; bMin: number }[] = [];
for (const t of teamSeasons as { season: string; team: string; srs: number }[]) {
  const end = parseInt(t.season.slice(0, 4), 10) + 1;
  const top = [...(byTeam[`${end}|${t.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const r8 = spans as PlayerSpan[];
  real.push({ y: t.srs, ...split({ id: t.team, name: t.team, draftSlot: 1, isHuman: false, roster: r8, rotation: autoAssignRotation(r8) }) });
}
const leagues = benchTeams as { teams: { name: string; ids: string[] }[] }[];
const teamOf = (ids: string[], id: string): Team => { const r = ids.map(spanById).filter((s): s is PlayerSpan => Boolean(s)); return { id, name: id, draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) }; };
const yard = leagues.slice(0, 4).map((lg, L) => { const ts = lg.teams.map((t, i) => teamOf(t.ids, `y${L}-${i}`)); return ts.sort((a, b) => scoreTeam(a).overallExact - scoreTeam(b).overallExact)[Math.floor(ts.length / 2)]; });
const sim: { y: number; st: number; bn: number; bMin: number }[] = [];
for (const [L, lg] of leagues.slice(4, 12).entries()) for (const [i, t] of lg.teams.entries()) {
  const team = teamOf(t.ids, `m${L}-${i}`);
  sim.push({ y: mean(yard.map((y) => mechanicsMargin(team, y))), ...split(team) });
}
for (const [k, rows, unit] of [['real teams (SRS)', real, 'SRS'], ['drafted teams (game margin)', sim, 'pts']] as const) {
  const f = fit2(rows.map((r) => r.y), rows.map((r) => r.st), rows.map((r) => r.bn));
  console.log(`${k}, n ${rows.length}: per starters' TAL point ${f.bA.toFixed(3)} ±${f.seA.toFixed(3)} ${unit}, per bench TAL point ${f.bB.toFixed(3)} ±${f.seB.toFixed(3)}; bench/starters ${(f.bB / f.bA).toFixed(2)}; bench minutes ${mean(rows.map((r) => r.bMin)).toFixed(0)} of 240; bench TAL spread ${Math.sqrt(mean(rows.map((r) => (r.bn - mean(rows.map((q) => q.bn))) ** 2))).toFixed(1)}`);
}

// A controlled swap in the game: each drafted team with one player traded for a same-position
// player 6-10 TAL better (closest in caps), once a bench player and once a starter; the game's
// margin change per TAL point per 36 minutes of the swapped player's minutes. Equal value per minute
// would read the same for both.
{
  const pool = draftPool.filter((s) => spanById(s.id));
  const better = (p: PlayerSpan, taken: Set<string>) => {
    const t = tal(p);
    return pool.filter((s) => s.primaryPosition === p.primaryPosition && !taken.has(s.playerName) && tal(s) >= t + 6 && tal(s) <= t + 10).sort((a, b) => Math.abs(a.fga - p.fga) - Math.abs(b.fga - p.fga))[0];
  };
  const per = { bench: [] as number[], starter: [] as number[] };
  for (const [L, lg] of leagues.slice(4, 12).entries()) for (const [i, t] of lg.teams.entries()) {
    const team = teamOf(t.ids, `m${L}-${i}`);
    const base = mean(yard.map((y) => mechanicsMargin(team, y)));
    const slots = Object.values(team.rotation!.slots);
    const mins = (id: string) => slots.flat().filter((a) => a.playerId === id).reduce((s, a) => s + a.minutes, 0);
    const starters = slots.map((a) => a[0].playerId);
    const benchIds = team.roster.map((s) => s.id).filter((id) => !starters.includes(id) && mins(id) > 0);
    const taken = new Set(team.roster.map((s) => s.playerName));
    for (const [kind, id] of [['bench', benchIds.sort((a, b) => mins(b) - mins(a))[0]], ['starter', starters[(L + i) % 5]]] as const) {
      const p = team.roster.find((s) => s.id === id);
      if (!p) continue;
      const q = better(p, taken);
      if (!q) continue;
      const roster2 = team.roster.map((s) => (s.id === id ? q : s));
      const team2: Team = { ...team, id: team.id + kind, roster: roster2, rotation: autoAssignRotation(roster2) };
      const after = mean(yard.map((y) => mechanicsMargin(team2, y)));
      const m = mins(id);
      if (m > 0) per[kind].push(((after - base) / (tal(q) - tal(p))) * (36 / m));
    }
  }
  console.log(`\ngame, controlled swap: margin per TAL point per 36 min — starter ${mean(per.starter).toFixed(3)} (n ${per.starter.length}), bench ${mean(per.bench).toFixed(3)} (n ${per.bench.length}); bench/starter ${(mean(per.bench) / mean(per.starter)).toFixed(2)}`);
}
