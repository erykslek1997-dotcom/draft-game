/**
 * 2026-09-30, engine calibration (TODO.md, Etap 1): drafts seeded leagues the way the game's
 * Auto-finish does (every pick by the CPU drafter, spans optimized under the cap, auto rotation),
 * then prints the same per-team export the results screen copies, plus a one-line-per-team table
 * and the field's spread per score — the before/after check for every calibration change.
 *
 *   npx tsx scripts/calibrationReport.ts [seeds=101,202] [--full]
 */
import { createDraft, autoFinishDraft } from '../src/engine/draft';
import { optimizeSpans } from '../src/engine/spanOptimizer';
import { autoAssignRotation } from '../src/engine/rotation';
import { rankTeams, offenseScoreBreakdown } from '../src/engine/scoring';
import { evaluateLeague } from '../src/engine/leagueSimulation';
import { exportLeagueText } from '../src/engine/teamExport';
import { CAP_LIMIT } from '../src/engine/positions';
import type { Team } from '../src/engine/types';

const args = process.argv.slice(2);
const seeds = (args.find((a) => /^[\d,]+$/.test(a)) ?? '101,202').split(',').map(Number);
const full = args.includes('--full');

export function draftLeague(seed: number): Team[] {
  const state = autoFinishDraft(createDraft(false, undefined, undefined, seed));
  return state.teams.map((t) => {
    const roster = optimizeSpans(t.roster, CAP_LIMIT);
    return { ...t, roster, rotation: autoAssignRotation(roster) };
  });
}

const all: Record<string, number[]> = { overall: [], talent: [], bench: [], offense: [], offRaw: [], defense: [], spacing: [], fit: [], rotation: [] };
for (const seed of seeds) {
  const teams = draftLeague(seed);
  const odds = new Map(evaluateLeague(teams, 2000).map((e) => [e.teamId, e.championshipProbability]));
  if (full) console.log(exportLeagueText(teams, { seed, titleOdds: odds }));
  console.log(`seed ${seed}`);
  for (const { team, breakdown: b, rank } of rankTeams(teams)) {
    const raw = offenseScoreBreakdown(team).raw;
    const starters = team.roster.slice().sort((x, y) => y.fga - x.fga).slice(0, 5).map((p) => p.playerName.split(' ').slice(-1)[0]).join(',');
    console.log(
      `${String(rank).padStart(2)} ${String(b.overall).padStart(3)} T${b.talentScore.toFixed(0)} B${b.benchDepthScore.toFixed(0)} O${b.offenseScore}(${raw.toFixed(0)}) D${b.defenseScore} S${b.spacingScore.toFixed(0)} F${b.fitScore.toFixed(0)} R${b.rotationScore.toFixed(0)} ${Math.round((odds.get(team.id) ?? 0) * 100)}% ${starters}`,
    );
    all.overall.push(b.overall); all.talent.push(b.talentScore); all.bench.push(b.benchDepthScore); all.offense.push(b.offenseScore);
    all.offRaw.push(raw); all.defense.push(b.defenseScore); all.spacing.push(b.spacingScore); all.fit.push(b.fitScore); all.rotation.push(b.rotationScore);
  }
}
const stat = (v: number[]) => {
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  return `mean ${m.toFixed(1)} sd ${sd.toFixed(1)} min ${Math.min(...v).toFixed(0)} max ${Math.max(...v).toFixed(0)}`;
};
console.log(`\nField (${all.overall.length} teams)`);
for (const [k, v] of Object.entries(all)) console.log(`  ${k.padEnd(8)} ${stat(v)}`);
