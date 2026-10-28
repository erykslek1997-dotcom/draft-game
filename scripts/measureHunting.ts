import benchTeams from '../src/data/benchTeams.json';
import lineups from '../src/data/awards/lineups5.json';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanById } from '../src/engine/bestFive';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { defensiveHuntability } from '../src/engine/defensiveHuntability';
import { spanEndYears } from '../src/engine/era';
import { mechanicsPer100 } from '../src/engine/liveGame';
import { autoAssignRotation } from '../src/engine/rotation';
import { defenseScore, scoreTeam, teamDefensiveTalentScore } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-28, step 6.1 (the user: Nash beside Kawhi, Howard and Bell reads Defense 69): does a
 * weak defender cost a five less when a strong defender beside him covers for him? Judges: real
 * NBA.com five-man units (2007-08 on, DRtg over the league's that season) and the game's own
 * mechanics (points allowed a 100 trips against four median bench-league teams).
 *
 * For each five: the linear D-TAL bar (before the hunt penalty), the hunt penalty, the hunted load
 * (shortfall × minutes of the weak defenders) and the best cover beside them — the top D-TAL of a
 * Point of Attack / Wing Stopper / Chaser (perimeter cover) and of an Anchor / Mobile Big (rim).
 * The question is the residual: real DRtg over what the linear bar predicts, against the load, for
 * fives with and without cover.
 *
 *   npx tsx scripts/measureHunting.ts [--min=300]
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const MIN_UNIT_MINUTES = Number(args.min ?? 300);
const COVER_GATE = Number(args.gate ?? 80);

const teamOf = (roster: PlayerSpan[], id: string): Team => ({ id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) });
const leagues = benchTeams as { teams: { name: string; ids: string[] }[] }[];
const spans = (ids: string[]) => ids.map(spanById).filter((s): s is PlayerSpan => Boolean(s));
const yardsticks = leagues.slice(0, 4).map((lg, L) => {
  const ts = lg.teams.map((t, i) => teamOf(spans(t.ids), `y${L}-${i}`));
  return ts.sort((a, b) => scoreTeam(a).overallExact - scoreTeam(b).overallExact)[Math.floor(ts.length / 2)];
});
const mechAllowed = (t: Team) => yardsticks.reduce((s, y) => s + mechanicsPer100(t, y)[1], 0) / yardsticks.length;

const PERIMETER = ['Point of Attack', 'Wing Stopper', 'Chaser'];
const RIM = ['Anchor Big', 'Mobile Big'];
function features(t: Team) {
  const h = defensiveHuntability(t);
  const offenders = new Set(h.offenders.map((o) => o.playerId));
  const others = t.roster.filter((p) => !offenders.has(p.id));
  const best = (roles: string[]) => Math.max(0, ...others.filter((p) => roles.includes(p.defensiveRole)).map(computeDefensiveTalent));
  return {
    linear: teamDefensiveTalentScore(t),
    defense: defenseScore(t),
    penalty: h.penalty,
    load: h.offenders.reduce((s, o) => s + o.shortfall * o.competitionAdjustedMinutes, 0) / 48,
    perimeterCover: best(PERIMETER),
    rimCover: best(RIM),
  };
}
type F = ReturnType<typeof features>;

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i] - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  });
  return sxy / Math.sqrt(sxx * syy);
};
/** Least squares with an intercept; returns the coefficients (intercept first). */
function ols(X: number[][], y: number[]) {
  const rows = X.map((r) => [1, ...r]);
  const k = rows[0].length;
  const A = Array.from({ length: k }, (_, i) => [...Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)), rows.reduce((s, r, n) => s + r[i] * y[n], 0)]);
  for (let i = 0; i < k; i++) {
    const p = A[i][i];
    for (let j = i; j <= k; j++) A[i][j] /= p;
    for (let r = 0; r < k; r++) if (r !== i) for (let j = k; j >= i; j--) A[r][j] -= A[r][i] * A[i][j];
  }
  return A.map((r) => r[k]);
}

const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) {
  const k = normalizePlayerName(s.playerName);
  byName.set(k, [...(byName.get(k) ?? []), s]);
}
const spanFor = (name: string, endYear: number) =>
  (byName.get(name) ?? [])
    .filter((s) => spanEndYears(s.spanLabel).includes(endYear))
    .sort((a, b) => {
      const mid = (s: PlayerSpan) => {
        const ys = spanEndYears(s.spanLabel);
        return Math.abs(ys[Math.floor(ys.length / 2)] - endYear);
      };
      return mid(a) - mid(b);
    })[0];
const leagueDrtg = new Map<string, number>();
for (const [season, rows] of Object.entries(Object.groupBy(teamSeasons as { season: string; drtg: number }[], (r) => r.season)))
  leagueDrtg.set(season, mean(rows!.map((r) => r.drtg)));

const real: { f: F; y: number; mech: number; who: string; five: PlayerSpan[] }[] = [];
for (const u of lineups as { season: string; team: string; players: string[]; min: number; drtg: number }[]) {
  if (u.min < MIN_UNIT_MINUTES || !leagueDrtg.has(u.season)) continue;
  const five = u.players.map((n) => spanFor(n, parseInt(u.season.slice(0, 4), 10) + 1));
  if (five.some((s) => !s)) continue;
  const team = teamOf(five as PlayerSpan[], `${u.season}-${u.team}`);
  real.push({ f: features(team), y: u.drtg - leagueDrtg.get(u.season)!, mech: mechAllowed(team), five: five as PlayerSpan[], who: `${u.season} ${u.team}: ${u.players.map((p) => p.split(' ').slice(-1)[0]).join(', ')}` });
}
const game: { f: F; mech: number }[] = [];
for (const [L, lg] of leagues.slice(4).entries())
  for (const [i, t] of lg.teams.entries()) {
    const team = teamOf(spans(t.ids), `m${L}-${i}`);
    game.push({ f: features(team), mech: mechAllowed(team) });
  }

console.log(`${real.length} real fives (${MIN_UNIT_MINUTES}+ min), ${game.length} bench-league teams; cover = a non-target defender at D-TAL ${COVER_GATE}+`);
console.log(`Defense vs real DRtg over league: r ${corr(real.map((r) => r.f.defense), real.map((r) => r.y)).toFixed(3)}; linear bar alone r ${corr(real.map((r) => r.f.linear), real.map((r) => r.y)).toFixed(3)}`);
console.log(`Defense vs mechanics allowed: real fives r ${corr(real.map((r) => r.f.defense), real.map((r) => r.mech)).toFixed(3)}, bench teams r ${corr(game.map((g) => g.f.defense), game.map((g) => g.mech)).toFixed(3)}`);

// DRtg points a hunt-penalty point is worth, and whether cover changes it: y ~ linear + penalty + penalty×cover.
function report(label: string, rows: { f: F; y: number }[]) {
  const covered = (f: F) => (f.perimeterCover >= COVER_GATE || f.rimCover >= COVER_GATE ? 1 : 0);
  const base = ols(rows.map((r) => [r.f.linear, r.f.penalty]), rows.map((r) => r.y));
  const split = ols(rows.map((r) => [r.f.linear, r.f.penalty * (1 - covered(r.f)), r.f.penalty * covered(r.f)]), rows.map((r) => r.y));
  const perim = ols(rows.map((r) => [r.f.linear, r.f.penalty * (r.f.perimeterCover >= COVER_GATE ? 0 : 1), r.f.penalty * (r.f.perimeterCover >= COVER_GATE ? 1 : 0)]), rows.map((r) => r.y));
  const n = rows.filter((r) => r.f.penalty > 1).length;
  const nc = rows.filter((r) => r.f.penalty > 1 && covered(r.f)).length;
  console.log(`\n${label} (${n} with a penalty > 1, ${nc} of them covered)`);
  console.log(`  per D-TAL-bar point ${base[1].toFixed(3)}, per penalty point ${base[2].toFixed(3)}  (DRtg/allowed: positive = worse defense)`);
  console.log(`  penalty point, uncovered ${split[2].toFixed(3)} vs covered ${split[3].toFixed(3)}  -> cover relief ${(1 - split[3] / split[2]).toFixed(2)}`);
  console.log(`  perimeter cover only: uncovered ${perim[2].toFixed(3)} vs covered ${perim[3].toFixed(3)}  -> relief ${(1 - perim[3] / perim[2]).toFixed(2)}`);
}
report('A real DRtg', real);
report('B mechanics, real fives', real.map((r) => ({ f: r.f, y: r.mech })));
report('C mechanics, bench teams', game.map((g) => ({ f: g.f, y: g.mech })));

// How much of the penalty the real defense backs: r of (bar − k × penalty) with real DRtg, k 0…1.5,
// and a bootstrap of the penalty's own DRtg weight (does its sign hold?).
console.log('\nbar − k × penalty vs real DRtg (more negative = better):');
for (const k of [0, 0.25, 0.5, 0.75, 1, 1.5]) console.log(`  k ${k}: r ${corr(real.map((r) => r.f.linear - k * r.f.penalty), real.map((r) => r.y)).toFixed(3)}   mechanics r ${corr(real.map((r) => r.f.linear - k * r.f.penalty), real.map((r) => r.mech)).toFixed(3)}`);
const pens = real.map((r) => r.f.penalty).sort((a, b) => a - b);
console.log(`penalty on real fives: median ${pens[Math.floor(pens.length / 2)].toFixed(1)}, p90 ${pens[Math.floor(pens.length * 0.9)].toFixed(1)}, max ${pens.at(-1)!.toFixed(1)}`);
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const boots = Array.from({ length: 500 }, () => {
  const s = real.map(() => real[Math.floor(rnd() * real.length)]);
  return ols(s.map((r) => [r.f.linear, r.f.penalty]), s.map((r) => r.y))[2];
}).sort((a, b) => a - b);
console.log(`DRtg per penalty point, bootstrap 90%: ${boots[25].toFixed(3)} … ${boots[475].toFixed(3)} (the engine assumes +${(0.2).toFixed(2)}–0.28 per point)`);
const worst = [...real].sort((a, b) => b.f.penalty - a.f.penalty).slice(0, 10);
console.log('\nHighest penalties (real DRtg over league, + = worse):');
worst.forEach((r) => console.log(`  pen ${r.f.penalty.toFixed(1)}  bar ${r.f.linear.toFixed(0)}  DRtg ${r.y >= 0 ? '+' : ''}${r.y.toFixed(1)}  ${r.who}`));

// The hunt penalty sits at its cap on nearly every real five (its bar is the all-time starter
// average), so real fives cannot grade it directly. The concept itself, on real DRtg: beyond the
// five's mean D-TAL, does the weakest defender's gap below his four teammates cost, and does a
// strong cover beside him shrink that cost? (z-scored inputs.)
{
  const rows = real.map((r) => r);
  const conc = rows.map((r) => {
    const five = r.five;
    const d = five.map(computeDefensiveTalent);
    const w = d.indexOf(Math.min(...d));
    const rest = d.filter((_, i) => i !== w);
    const restMean = mean(rest);
    const cover = Math.max(...five.filter((_, i) => i !== w).filter((p) => PERIMETER.includes(p.defensiveRole) || RIM.includes(p.defensiveRole)).map(computeDefensiveTalent), 0);
    return { mean: mean(d), gap: restMean - d[w], cover };
  });
  const z = (v: number[]) => {
    const m = mean(v);
    const s = Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
    return v.map((x) => (x - m) / s);
  };
  const zm = z(conc.map((c) => c.mean));
  const zg = z(conc.map((c) => c.gap));
  const zc = z(conc.map((c) => c.cover));
  for (const [label, ys] of [['real DRtg', rows.map((r) => r.y)], ['mechanics', rows.map((r) => r.mech)]] as const) {
    const b1 = ols(rows.map((_, i) => [zm[i], zg[i]]), [...ys]);
    const b2 = ols(rows.map((_, i) => [zm[i], zg[i], zc[i], zg[i] * zc[i]]), [...ys]);
    const boot = Array.from({ length: 400 }, () => {
      const idx = rows.map(() => Math.floor(rnd() * rows.length));
      return ols(idx.map((i) => [zm[i], zg[i], zc[i], zg[i] * zc[i]]), idx.map((i) => ys[i]))[4];
    }).sort((a, b) => a - b);
    console.log(`\n${label}: per SD of mean D-TAL ${b1[1].toFixed(2)}, per SD of weakest-link gap ${b1[2].toFixed(2)}`);
    console.log(`  with cover: gap ${b2[2].toFixed(2)}, cover ${b2[3].toFixed(2)}, gap×cover ${b2[4].toFixed(2)} (90% ${boot[20].toFixed(2)} … ${boot[380].toFixed(2)}; negative = cover shrinks the gap's cost)`);
  }
}
