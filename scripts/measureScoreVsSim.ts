import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import benchTeams from '../src/data/benchTeams.json';
import { spanById } from '../src/engine/bestFive';
import { mechanicsMargin, mechanicsPer100 } from '../src/engine/liveGame';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';
import type { PlayerSpan } from '../src/data/schema';

/**
 * 2026-10-28, weeks 2-3 step 1 (TODO "Kolejność prac"): how well the team's number (Overall and its
 * parts) predicts what the game's own mechanics do with the team — no nudge toward the engine, no
 * dice (`mechanicsMargin`). Run it before and after every weight change: a change that moves the
 * number away from the games is a change for the worse, however good it looks on paper.
 *
 *   npx tsx scripts/measureScoreVsSim.ts [--leagues=8] [--save=name] [--compare=name]
 *
 * Prints: points a game the mechanics give per Overall point (the engine promises 1.3) and R²;
 * how each part of the number lines up with the margin and with what Overall misses; the teams the
 * number over- and under-rates most. `--save` writes reports/scoreVsSim-<name>.json; `--compare`
 * prints the change against a saved run.
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const LEAGUES = Number(args.leagues ?? 8);
const ENGINE_MARGIN_PER_OVERALL = 1.3;

const leagues = benchTeams as { teams: { name: string; ids: string[] }[] }[];
const teamOf = (ids: string[], id: string): Team => {
  const roster = ids.map(spanById).filter((s): s is PlayerSpan => Boolean(s));
  return { id, name: id, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
};

// The yardstick: each league's median team, from four leagues the measured teams are not in.
const yardsticks = leagues.slice(0, 4).map((lg, L) => {
  const ts = lg.teams.map((t, i) => teamOf(t.ids, `y${L}-${i}`));
  return ts.sort((a, b) => scoreTeam(a).overallExact - scoreTeam(b).overallExact)[Math.floor(ts.length / 2)];
});

interface Row {
  id: string;
  who: string;
  overall: number;
  parts: Record<string, number>;
  margin: number;
  off100: number;
  def100: number;
}
const rows: Row[] = [];
const t0 = Date.now();
for (const [L, lg] of leagues.slice(4, 4 + LEAGUES).entries()) {
  for (const [i, t] of lg.teams.entries()) {
    const team = teamOf(t.ids, `m${L}-${i}`);
    const b = scoreTeam(team);
    const margins = yardsticks.map((y) => mechanicsMargin(team, y));
    const per100 = yardsticks.map((y) => mechanicsPer100(team, y));
    rows.push({
      id: team.id,
      who: [...team.roster].sort((x, y) => y.fga - x.fga).slice(0, 5).map((p) => p.playerName.split(' ').slice(-1)[0]).join(', '),
      overall: b.overallExact,
      parts: { talent: b.talentScore, bench: b.benchDepthScore, offense: b.offenseScore, defense: b.defenseScore, spacing: b.spacingScore, fit: b.fitScore, rotation: b.rotationScore },
      margin: margins.reduce((s, x) => s + x, 0) / margins.length,
      off100: per100.reduce((s, x) => s + x[0], 0) / per100.length,
      def100: per100.reduce((s, x) => s + x[1], 0) / per100.length,
    });
  }
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
function fit(xs: number[], ys: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy) };
}

const main = fit(rows.map((r) => r.overall), rows.map((r) => r.margin));
const residual = rows.map((r) => r.margin - (main.intercept + main.slope * r.overall));
const summary = {
  teams: rows.length,
  perOverall: main.slope,
  delivered: main.slope / ENGINE_MARGIN_PER_OVERALL,
  r2: main.r ** 2,
  parts: Object.fromEntries(
    Object.keys(rows[0].parts).map((k) => {
      const xs = rows.map((r) => r.parts[k]);
      return [k, { rMargin: fit(xs, rows.map((r) => r.margin)).r, rResidual: fit(xs, residual).r, rOffense100: fit(xs, rows.map((r) => r.off100)).r, rDefense100: fit(xs, rows.map((r) => -r.def100)).r }];
    }),
  ),
};

const f = (x: number, d = 2) => (x >= 0 ? ' ' : '') + x.toFixed(d);
console.log(`${rows.length} teams from ${LEAGUES} leagues, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`Overall -> mechanics margin: ${main.slope.toFixed(2)} pts a game per Overall point (engine promises ${ENGINE_MARGIN_PER_OVERALL}, delivered ${(100 * summary.delivered).toFixed(0)}%), R² ${summary.r2.toFixed(2)}`);
console.log('\nPart       r(margin)  r(what Overall misses)  r(own offense/100)  r(own defense/100)');
for (const [k, v] of Object.entries(summary.parts)) console.log(`${k.padEnd(10)} ${f(v.rMargin).padStart(8)}  ${f(v.rResidual).padStart(14)}  ${f(v.rOffense100).padStart(18)}  ${f(v.rDefense100).padStart(18)}`);

const order = rows.map((r, i) => ({ r, e: residual[i] })).sort((a, b) => b.e - a.e);
const line = ({ r, e }: { r: Row; e: number }) =>
  `  ${f(e, 1).padStart(6)}  Overall ${r.overall.toFixed(1)}  T${r.parts.talent.toFixed(0)} O${r.parts.offense.toFixed(0)} D${r.parts.defense.toFixed(0)} S${r.parts.spacing.toFixed(0)} F${r.parts.fit.toFixed(0)}  ${r.who}`;
console.log('\nThe number UNDER-rates (the games give more than Overall says), points a game:');
order.slice(0, 10).forEach((x) => console.log(line(x)));
console.log('\nThe number OVER-rates (the games give less):');
order.slice(-10).reverse().forEach((x) => console.log(line(x)));

const dir = resolve(import.meta.dirname, '../reports');
if (args.save) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `scoreVsSim-${args.save}.json`), JSON.stringify({ summary, rows }, null, 1));
  console.log(`\nsaved reports/scoreVsSim-${args.save}.json`);
}
if (args.compare) {
  const before = JSON.parse(readFileSync(resolve(dir, `scoreVsSim-${args.compare}.json`), 'utf8')).summary as typeof summary;
  console.log(`\nAgainst "${args.compare}": per Overall ${before.perOverall.toFixed(2)} -> ${summary.perOverall.toFixed(2)}, R² ${before.r2.toFixed(2)} -> ${summary.r2.toFixed(2)}`);
  for (const k of Object.keys(summary.parts)) console.log(`  ${k.padEnd(10)} r(what Overall misses) ${f(before.parts[k].rResidual)} -> ${f(summary.parts[k].rResidual)}`);
}
