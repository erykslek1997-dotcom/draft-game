import benchTeams from '../src/data/benchTeams.json';
import lineups from '../src/data/awards/lineups5.json';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizePlayerName, type PlayerSpan, type Position } from '../src/data/schema';
import { spanById } from '../src/engine/bestFive';
import { spanEndYears } from '../src/engine/era';
import { mechanicsPer100 } from '../src/engine/liveGame';
import { autoAssignRotation } from '../src/engine/rotation';
import { offenseScoreBreakdown, offensiveCohesion, scoreTeam, superstarEngineBonus } from '../src/engine/scoring';
import { teamGlass } from '../src/engine/teamGlass';
import type { Team } from '../src/engine/types';

/**
 * 2026-10-28 (the user: "sprawdź offense", after `measureScoreVsSim.ts` found the Offense score
 * barely lines up with the offense the game's own mechanics produce, r 0.37): which parts of the
 * Offense score follow the points a 100 trips — in the game's mechanics (the bench leagues) and in
 * real life (NBA.com five-man units, 2007-08 on, their ORtg over the league's that season).
 *
 *   npx tsx scripts/measureOffense.ts [--min=300]
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const MIN_UNIT_MINUTES = Number(args.min ?? 300);

const teamOf = (roster: PlayerSpan[], id: string): Team => ({ id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) });
const leagues = benchTeams as { teams: { name: string; ids: string[] }[] }[];
const spans = (ids: string[]) => ids.map(spanById).filter((s): s is PlayerSpan => Boolean(s));
const yardsticks = leagues.slice(0, 4).map((lg, L) => {
  const ts = lg.teams.map((t, i) => teamOf(spans(t.ids), `y${L}-${i}`));
  return ts.sort((a, b) => scoreTeam(a).overallExact - scoreTeam(b).overallExact)[Math.floor(ts.length / 2)];
});
const mechOff = (t: Team) => yardsticks.reduce((s, y) => s + mechanicsPer100(t, y)[0], 0) / yardsticks.length;

const FEATURES = ['score', 'raw', 'otal', 'spacing', 'spacingCovers', 'rimPressure', 'playmaking', 'selfCreation', 'mismatch', 'cohesionBonus', 'starBonus', 'glass'] as const;
type F = Record<(typeof FEATURES)[number], number>;
function features(t: Team): F {
  const b = offenseScoreBreakdown(t);
  return {
    score: b.score,
    raw: b.raw,
    otal: b.otal,
    spacing: b.spacing,
    spacingCovers: b.engineSpacingCover + b.interiorSpacingCover,
    rimPressure: b.rimPressure,
    playmaking: b.playmaking,
    selfCreation: b.selfCreation,
    mismatch: b.mismatchStructure,
    cohesionBonus: offensiveCohesion(t).offenseScoreBonus,
    starBonus: superstarEngineBonus(t),
    glass: teamGlass(t).offensePoints,
  };
}

const corr = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
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

// A: the bench leagues' teams, in the game's mechanics.
const game: { f: F; y: number }[] = [];
for (const [L, lg] of leagues.slice(4).entries()) for (const [i, t] of lg.teams.entries()) {
  const team = teamOf(spans(t.ids), `m${L}-${i}`);
  game.push({ f: features(team), y: mechOff(team) });
}

// B: real fives. Each player as the pool span centred on that season (else any span covering it).
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) {
  const k = normalizePlayerName(s.playerName);
  byName.set(k, [...(byName.get(k) ?? []), s]);
}
const spanFor = (name: string, endYear: number) => {
  const cands = (byName.get(name) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(endYear));
  return cands.sort((a, b) => {
    const mid = (s: PlayerSpan) => {
      const ys = spanEndYears(s.spanLabel);
      return Math.abs(ys[Math.floor(ys.length / 2)] - endYear);
    };
    return mid(a) - mid(b);
  })[0];
};
// `--positions=reports/position-review.json`: each span at the position proposed there (a copy under a new id).
const proposed = new Map<string, Position>();
if (args.positions)
  for (const p of JSON.parse(readFileSync(resolve(import.meta.dirname, '..', args.positions), 'utf8')) as { name: string; spans: { label: string; proposal: Position }[] }[])
    for (const sp of p.spans) proposed.set(`${p.name}|${sp.label}`, sp.proposal);
const asProposed = (s: PlayerSpan | undefined): PlayerSpan | undefined => {
  const to = s && proposed.get(`${s.playerName}|${s.spanLabel}`);
  if (!s || !to || to === s.primaryPosition) return s;
  return { ...s, id: `${s.id}~${to}`, primaryPosition: to, secondaryPositions: [s.primaryPosition, ...s.secondaryPositions.filter((p) => p !== to && p !== s.primaryPosition)] };
};
const leagueOrtg = new Map<string, number>();
for (const [season, rows] of Object.entries(Object.groupBy(teamSeasons as { season: string; ortg: number }[], (r) => r.season)))
  leagueOrtg.set(season, rows!.reduce((s, r) => s + r.ortg, 0) / rows!.length);
const real: { f: F; y: number; mech: number; who: string; min: number }[] = [];
let missing = 0;
for (const u of lineups as { season: string; team: string; players: string[]; min: number; ortg: number }[]) {
  if (u.min < MIN_UNIT_MINUTES) continue;
  const end = parseInt(u.season.slice(0, 4), 10) + 1;
  const five = u.players.map((n) => asProposed(spanFor(n, end)));
  if (five.some((s) => !s) || !leagueOrtg.has(u.season)) {
    missing++;
    continue;
  }
  const team = teamOf(five as PlayerSpan[], `${u.season}-${u.team}`);
  real.push({ f: features(team), y: u.ortg - leagueOrtg.get(u.season)!, mech: mechOff(team), who: `${u.season} ${u.team}: ${u.players.map((p) => p.split(' ').slice(-1)[0]).join(', ')}`, min: u.min });
}

console.log(`A: ${game.length} bench-league teams, offense a 100 trips in the game's mechanics`);
console.log(`B: ${real.length} real five-man units with ${MIN_UNIT_MINUTES}+ minutes (${missing} skipped: a player outside the pool), ORtg over the league's`);
console.log(`   the game's mechanics on those fives vs their real ORtg: r ${corr(real.map((r) => r.mech), real.map((r) => r.y)).toFixed(2)}`);
console.log('\nOffense part       r(A: mechanics)  r(B: real ORtg)  r(B: mechanics on real fives)');
for (const k of FEATURES) {
  const a = corr(game.map((g) => g.f[k]), game.map((g) => g.y));
  const b = corr(real.map((r) => r.f[k]), real.map((r) => r.y));
  const c = corr(real.map((r) => r.f[k]), real.map((r) => r.mech));
  console.log(`${k.padEnd(18)} ${a.toFixed(2).padStart(8)}  ${b.toFixed(2).padStart(15)}  ${c.toFixed(2).padStart(20)}`);
}

// Where the score and real life disagree most among the real fives.
const fitLine = (xs: number[], ys: number[]) => {
  const r = corr(xs, ys);
  const sd = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + (x - v.reduce((a, b) => a + b, 0) / v.length) ** 2, 0) / v.length);
  const slope = (r * sd(ys)) / sd(xs);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  return (x: number) => my + slope * (x - mx);
};
const pred = fitLine(real.map((r) => r.f.score), real.map((r) => r.y));
const order = [...real].sort((a, b) => b.y - pred(b.f.score) - (a.y - pred(a.f.score)));
const show = (r: (typeof real)[number]) =>
  `  ${(r.y - pred(r.f.score)).toFixed(1).padStart(6)}  real ${r.y >= 0 ? '+' : ''}${r.y.toFixed(1)}  Offense ${r.f.score}  O-TAL ${r.f.otal.toFixed(0)} SPC ${r.f.spacing.toFixed(0)} RIM ${r.f.rimPressure.toFixed(0)} PM ${r.f.playmaking.toFixed(0)} SC ${r.f.selfCreation.toFixed(0)}  ${r.min} min  ${r.who}`;
console.log('\nReal fives better than their Offense says (ORtg points over the fit):');
order.slice(0, 8).forEach((r) => console.log(show(r)));
console.log('\nReal fives worse than their Offense says:');
order.slice(-8).reverse().forEach((r) => console.log(show(r)));

// What each part adds over the others: standardized least squares (z-scored parts and target).
function standardized(rows: { f: F; y: number }[], keys: readonly (keyof F)[]) {
  const z = (v: number[]) => {
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const s = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
    return v.map((x) => (x - m) / s);
  };
  const cols = keys.map((k) => z(rows.map((r) => r.f[k])));
  const y = z(rows.map((r) => r.y));
  const k = cols.length;
  const A = Array.from({ length: k }, (_, i) => [...cols.map((c) => c.reduce((s, x, n) => s + x * cols[i][n], 0)), cols[i].reduce((s, x, n) => s + x * y[n], 0)]);
  for (let i = 0; i < k; i++) {
    const p = A[i][i];
    for (let j = i; j <= k; j++) A[i][j] /= p;
    for (let r = 0; r < k; r++) if (r !== i) for (let j = k; j >= i; j--) A[r][j] -= A[r][i] * A[i][j];
  }
  const beta = A.map((r) => r[k]);
  const fitted = y.map((_, n) => beta.reduce((s, b, i) => s + b * cols[i][n], 0));
  return { beta, r2: corr(fitted, y) ** 2 };
}
const PARTS = ['otal', 'spacing', 'spacingCovers', 'rimPressure', 'playmaking', 'selfCreation', 'mismatch', 'cohesionBonus', 'starBonus', 'glass'] as const;
const sa = standardized(game, PARTS);
const sb = standardized(real, PARTS);
const sc = standardized(real.map((r) => ({ f: r.f, y: r.mech })), PARTS);
console.log(`\nWeight each part earns on its own (standardized), R²: A ${sa.r2.toFixed(2)} (score alone ${(corr(game.map((g) => g.f.score), game.map((g) => g.y)) ** 2).toFixed(2)}), B real ${sb.r2.toFixed(2)} (score alone ${(corr(real.map((r) => r.f.score), real.map((r) => r.y)) ** 2).toFixed(2)}), B mechanics ${sc.r2.toFixed(2)}`);
PARTS.forEach((k, i) => console.log(`${k.padEnd(18)} ${sa.beta[i].toFixed(2).padStart(8)}  ${sb.beta[i].toFixed(2).padStart(15)}  ${sc.beta[i].toFixed(2).padStart(20)}`));
