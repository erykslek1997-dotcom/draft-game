import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import benchTeams from '../src/data/benchTeams.json';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanById } from '../src/engine/bestFive';
import { spanEndYears } from '../src/engine/era';
import { mechanicsMargin } from '../src/engine/liveGame';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-29, step 2 of the audit follow-up (`scripts/auditTeams.ts`: 39 real teams leaning to
 * defense — Defense 8+ over Offense — beat their Overall by +0.94 SRS): moving Overall's weight from
 * Offense to Defense, `shift` of the fit composite at a time (Overall = ... + 0.5 × (0.18 Fit + 0.17
 * Offense + 0.17 Defense) / 0.52), judged on both sides: real team-seasons by SRS (and the defense-
 * lean miss inside each decade, so the era drift is left out), and AI-drafted bench-league teams by
 * the game's own mechanics margin (R² of Overall). Run with the engine as is; a second run with a
 * changed engine (e.g. the rim anchor) compares at shift 0.
 *
 *   npx tsx scripts/measureDefenseLean.ts
 */
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
const resid = (ys: number[], xs: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; }); const s = a / b; return ys.map((y, i) => y - my - s * (xs[i] - mx)); };

// real teams
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
const real: { srs: number; ovr: number; off: number; def: number; dec: string }[] = [];
for (const t of teamSeasons as { season: string; team: string; srs: number }[]) {
  const end = parseInt(t.season.slice(0, 4), 10) + 1;
  const top = [...(byTeam[`${end}|${t.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes).slice(0, 8);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || spans.some((s) => !s)) continue;
  const r8 = spans as PlayerSpan[];
  const b = scoreTeam({ id: t.team, name: t.team, draftSlot: 1, isHuman: false, roster: r8, rotation: autoAssignRotation(r8) });
  real.push({ srs: t.srs, ovr: b.overallExact, off: b.offenseScore, def: b.defenseScore, dec: `${Math.floor((end - 1) / 10) * 10}s` });
}
// drafted teams
const leagues = benchTeams as { teams: { name: string; ids: string[] }[] }[];
const teamOf = (ids: string[], id: string): Team => { const r = ids.map(spanById).filter((s): s is PlayerSpan => Boolean(s)); return { id, name: id, draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) }; };
const yard = leagues.slice(0, 4).map((lg, L) => { const ts = lg.teams.map((t, i) => teamOf(t.ids, `y${L}-${i}`)); return ts.sort((a, b) => scoreTeam(a).overallExact - scoreTeam(b).overallExact)[Math.floor(ts.length / 2)]; });
const sim: { m: number; ovr: number; off: number; def: number }[] = [];
for (const [L, lg] of leagues.slice(4, 12).entries()) for (const [i, t] of lg.teams.entries()) {
  const team = teamOf(t.ids, `m${L}-${i}`); const b = scoreTeam(team);
  sim.push({ m: mean(yard.map((y) => mechanicsMargin(team, y))), ovr: b.overallExact, off: b.offenseScore, def: b.defenseScore });
}
const lean = (r: { off: number; def: number }) => r.def - r.off > 8;
console.log(`${real.length} real team-seasons (${real.filter(lean).length} defense-leaning), ${sim.length} drafted teams`);
for (const shift of [0, 0.02, 0.04, 0.06]) {
  const w = (0.5 * shift) / 0.52;
  const ovR = real.map((r) => r.ovr + w * (r.def - r.off));
  const res = resid(real.map((r) => r.srs), ovR);
  const dm = new Map(Object.entries(Object.groupBy(real.map((r, i) => ({ r, m: res[i] })), (o) => o.r.dec)).map(([k, g]) => [k, mean(g!.map((o) => o.m))]));
  const adj = real.map((r, i) => res[i] - dm.get(r.dec)!);
  const leanMiss = mean(real.map((r, i) => (lean(r) ? adj[i] : NaN)).filter((v) => !Number.isNaN(v)));
  const offMiss = mean(real.map((r, i) => (r.off - r.def > 8 ? adj[i] : NaN)).filter((v) => !Number.isNaN(v)));
  const ovS = sim.map((r) => r.ovr + w * (r.def - r.off));
  console.log(`  shift ${shift.toFixed(2)}  SRS r ${corr(ovR, real.map((r) => r.srs)).toFixed(4)}  defense-lean miss ${leanMiss.toFixed(2)}  offense-lean ${offMiss.toFixed(2)}  sim R² ${(corr(ovS, sim.map((r) => r.m)) ** 2).toFixed(4)}`);
}
