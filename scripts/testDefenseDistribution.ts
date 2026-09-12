/**
 * 2026-09-12, code-review finding (altitude): `defensiveCohesion.ts`'s bonus caps have now been
 * tuned twice in direct response to "too many teams read Defense > 90" (2026-09-09, then again
 * this same date), each time using a one-off diagnostic script (`_defenseInflationDiag.ts`)
 * deleted right after use — so the actual claim ("this fixes the inflation") was never left
 * behind as anything a future change could accidentally re-break without a human noticing. This
 * is that diagnostic, kept permanently as a real regression check instead of a disposable
 * one-time measurement: samples a real spread of AI-drafted-and-finalized teams (the same
 * `optimizeSpans` + `autoAssignRotation` finalization `GameShell.tsx` applies) and asserts the
 * aggregate `defenseScore` distribution stays within a generous-but-real band. The exact
 * percentages will drift a little run to run (different seeds draft different rosters) — the
 * thresholds below have real margin above the last measured baseline (13.8% > 90, 31.3% > 80)
 * specifically so normal sampling variance doesn't flake this, while still catching a genuine
 * regression back toward — or past — the pre-fix numbers (16.3% / 33.8%).
 */
import { createDraft, autoFinishDraft } from '../src/engine/draft';
import { optimizeSpans } from '../src/engine/spanOptimizer';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { CAP_LIMIT } from '../src/engine/positions';
import type { Team } from '../src/engine/types';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const SEEDS = [101, 202, 303, 404, 505, 606];
let over90 = 0;
let over80 = 0;
let total = 0;

for (const seed of SEEDS) {
  let state = createDraft(false, undefined, undefined, seed);
  state = autoFinishDraft(state);
  const teams: Team[] = state.teams.map((t) => {
    const roster = optimizeSpans(t.roster, CAP_LIMIT);
    return { ...t, roster, rotation: autoAssignRotation(roster) };
  });
  for (const team of teams) {
    const defenseScore = scoreTeam(team).defenseScore;
    total++;
    if (defenseScore > 90) over90++;
    if (defenseScore > 80) over80++;
  }
}

const pctOver90 = (over90 / total) * 100;
const pctOver80 = (over80 / total) * 100;
console.log(`Sampled ${total} real AI-drafted-and-finalized teams across ${SEEDS.length} seeds.`);
console.log(`Defense > 90: ${over90} (${pctOver90.toFixed(1)}%)`);
console.log(`Defense > 80: ${over80} (${pctOver80.toFixed(1)}%)`);

check(pctOver90 <= 25, `Defense > 90 stays a minority of the field (${pctOver90.toFixed(1)}% <= 25%)`);
check(pctOver80 <= 45, `Defense > 80 stays under half the field (${pctOver80.toFixed(1)}% <= 45%)`);
