/** Companion to genSampleRosters.ts — regenerates the SAME 48 rosters (same seeds) and computes
 * every engine signal for each, WITHOUT printing rosters (so Claude's read stays blind — this
 * file is only opened after the qualitative scoring pass is done). */
import { autoFinishDraft, createDraft } from '../src/engine/draft';
import { autoAssignRotation } from '../src/engine/rotation';
import { writeFileSync } from 'node:fs';
import { talentScore, offenseScore, defenseScore, spacingScore, fitScore, scoreTeam, isStrongRimProtector, isStrongPerimeterDefender } from '../src/engine/scoring';
import { primaryStarters } from '../src/engine/rotation';
import { HIGH_USAGE_ARCHETYPE_WEIGHT } from '../src/data/schema';
import { computeOffensivePortability } from '../src/engine/portability';
import { computeSpacing } from '../src/engine/spacing';
import { computeTalent, computeDefensiveTalent } from '../src/engine/talent';
import { isPlusShooter } from '../src/engine/shooting';

const DRAFTS = Number(process.env.DRAFTS ?? 3);
const SEED_BASE = Number(process.env.SEED_BASE ?? 555_000);

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rows: Record<string, number | string>[] = [];
let globalTeamId = 1;
for (let d = 0; d < DRAFTS; d++) {
  const rand = seededRandom(SEED_BASE + d * 7919);
  const originalRandom = Math.random;
  Math.random = rand;
  let state = createDraft(false);
  state = autoFinishDraft(state);
  Math.random = originalRandom;

  for (const team of state.teams) {
    if (team.roster.length < 8) { globalTeamId++; continue; }
    team.rotation = autoAssignRotation(team.roster);
    const talent = talentScore(team);
    const offense = offenseScore(team);
    const defense = defenseScore(team);
    const spacing = spacingScore(team);
    const fit = fitScore(team);
    const overall = scoreTeam(team).overall;
    const starters = primaryStarters(team).map((e) => e.player);
    const usageWeight = starters.reduce((sum, p) => sum + (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0), 0);
    const avgOPor = starters.reduce((sum, p) => sum + computeOffensivePortability(p), 0) / starters.length;
    const plusShooterCount = starters.filter(isPlusShooter).length;
    const avgSpacing = starters.reduce((sum, p) => sum + computeSpacing(p), 0) / starters.length;
    const avgDTal = starters.reduce((sum, p) => sum + computeDefensiveTalent(p), 0) / starters.length;
    const totalRpg = starters.reduce((sum, p) => sum + p.box.rpg, 0);
    const totalTalent = team.roster.reduce((sum, p) => sum + computeTalent(p), 0);
    const totalFga = team.roster.reduce((sum, p) => sum + p.fga, 0);
    const efficiency = totalFga > 0 ? totalTalent / totalFga : 0;
    const tals = team.roster.map((p) => computeTalent(p)).sort((a, b) => b - a);
    const minTal = Math.min(...tals);
    const weakCount = tals.filter((t) => t < 50).length;
    rows.push({ teamId: globalTeamId, talent, offense, defense, spacing, fit: fit.score, overall, usageWeight, avgOPor, plusShooterCount, avgSpacing, avgDTal, totalRpg, efficiency, minTal, weakCount });
    globalTeamId++;
  }
}
writeFileSync('reports/sample-roster-signals.json', JSON.stringify(rows, null, 1));
console.log('Wrote', rows.length, 'rows to reports/sample-roster-signals.json');
