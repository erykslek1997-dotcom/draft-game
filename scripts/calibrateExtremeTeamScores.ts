/**
 * Calibration anchors for offenseScore/defenseScore/spacingScore (`scoring.ts`), per explicit
 * user request (2026-08-05): those three team-level metrics are suspected of not stretching to
 * their full 0-100 range in practice ("źle działa na koniec" — the ends don't work right).
 *
 * Method: build the best-possible and worst-possible legal 9-man roster (cap-legal, every
 * starter slot position-eligible, ROSTER_SIZE reachable) purely by greedily maximizing/
 * minimizing the target per-player metric (OTAL / DTAL / SPC) — no fit, no talent, no need
 * signal, nothing but "as much/as little of this one thing as the cap and position rules allow."
 * Several attempts per direction (varied slot-fill order + light randomized tie-breaking among
 * near-equal candidates), keeping the single best (max direction) / worst (min direction) team
 * score found — greedy fill order can leave cap room on the table or lock out a better late pick,
 * so a handful of attempts is a cheap hedge against a single greedy run being a bad local optimum.
 *
 * Spacing's calibration excludes Stephen Curry from the candidate pool entirely (both
 * directions) — `spacingScore` has a standalone, ONLY-Curry team-level floor
 * (`SHOOTING_ANOMALY_TEAM_SPACING_FLOOR`, spacing can't drop below 85 during his minutes,
 * scaled by his share of the game) that would let a single roster spot trivially anchor a
 * "worst possible spacing" team near 85 regardless of the other four players — not a genuine
 * test of what the other four judge-metric ladders can produce on their own.
 */
import { draftPool as poolAll } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import type { PlayerSpan, Position } from '../src/data/schema';
import {
  STARTER_SLOTS,
  ROSTER_SIZE,
  CAP_LIMIT,
  isPositionEligible,
  isPickCapLegal,
  buildCheapestLookup,
  canFillFromLookup,
} from '../src/engine/positions';
import { autoAssignRotation } from '../src/engine/rotation';
import type { Team } from '../src/engine/types';
import { offenseScore, defenseScore, spacingScore } from '../src/engine/scoring';
import { computeOffensiveTalent, computeDefensiveTalent } from '../src/engine/talent';
import { computeSpacing } from '../src/engine/spacing';

const ATTEMPTS_PER_DIRECTION = 8;
const STANDALONE_TEAM_COUNT = 1; // no other drafters competing for the same pool -> zero contention margin

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** direction: +1 maximizes metric, -1 minimizes it. slotOrder controls which starter position
 * gets first pick of the pool (fill order can change what's still affordable/eligible later). */
function buildExtremeTeam(
  pool: PlayerSpan[],
  metric: (p: PlayerSpan) => number,
  direction: 1 | -1,
  slotOrder: Position[],
): PlayerSpan[] | null {
  const roster: PlayerSpan[] = [];
  const usedNames = new Set<string>();
  const currentFgas: number[] = [];

  function pickOne(eligibleFilter: (p: PlayerSpan) => boolean): PlayerSpan | undefined {
    const remainingPool = pool.filter((p) => !usedNames.has(normalizePlayerName(p.playerName)));
    const lookup = buildCheapestLookup(remainingPool);
    const slotsLeftAfter = ROSTER_SIZE - roster.length - 1;
    const spent = currentFgas.reduce((s, f) => s + f, 0);
    const candidates = remainingPool.filter((p) => {
      if (!eligibleFilter(p)) return false;
      if (!isPickCapLegal(currentFgas, p.fga)) return false;
      if (slotsLeftAfter > 0) {
        const capRemainingAfter = CAP_LIMIT - (spent + p.fga);
        if (!canFillFromLookup(lookup, slotsLeftAfter, capRemainingAfter, normalizePlayerName(p.playerName), STANDALONE_TEAM_COUNT)) return false;
      }
      return true;
    });
    if (candidates.length === 0) return undefined;
    // light randomized tie-break: shuffle first (so exact ties don't always resolve the same
    // way across attempts), then take the true best/worst by metric.
    const shuffled = shuffle(candidates);
    return [...shuffled].sort((a, b) => direction * (metric(b) - metric(a)))[0];
  }

  for (const slot of slotOrder) {
    const pick = pickOne((p) => isPositionEligible(p, slot));
    if (!pick) return null;
    roster.push(pick);
    usedNames.add(normalizePlayerName(pick.playerName));
    currentFgas.push(pick.fga);
  }
  while (roster.length < ROSTER_SIZE) {
    const pick = pickOne(() => true);
    if (!pick) return null;
    roster.push(pick);
    usedNames.add(normalizePlayerName(pick.playerName));
    currentFgas.push(pick.fga);
  }
  return roster;
}

function scoreTeam(roster: PlayerSpan[], teamScoreFn: (t: Team) => number): number {
  const team: Team = { id: 'calib', name: 'calib', draftSlot: 1, isHuman: false, roster, rotation: null };
  team.rotation = autoAssignRotation(team.roster);
  return teamScoreFn(team);
}

function printDetailedRoster(roster: PlayerSpan[], playerMetric: (p: PlayerSpan) => number, metricLabel: string, teamScore: number) {
  const team: Team = { id: 'calib', name: 'calib', draftSlot: 1, isHuman: false, roster, rotation: null };
  team.rotation = autoAssignRotation(team.roster);
  const minutesByPlayerId = new Map<string, { slot: Position; minutes: number }[]>();
  for (const slot of STARTER_SLOTS) {
    for (const entry of team.rotation.slots[slot]) {
      const list = minutesByPlayerId.get(entry.playerId) ?? [];
      list.push({ slot, minutes: entry.minutes });
      minutesByPlayerId.set(entry.playerId, list);
    }
  }
  const totalFga = roster.reduce((s, p) => s + p.fga, 0);
  console.log(`  team score = ${teamScore.toFixed(1)}, total FGA = ${totalFga.toFixed(1)} / 100.9`);
  console.log(`  ${'player'.padEnd(28)}${'pos'.padEnd(6)}${'FGA'.padEnd(7)}${metricLabel.padEnd(8)}minutes (slot)`);
  for (const p of roster) {
    const assignments = minutesByPlayerId.get(p.id) ?? [];
    const minutesStr = assignments.length > 0 ? assignments.map((a) => `${a.minutes}@${a.slot}`).join('+') : 'bench (0 min)';
    console.log(
      `  ${p.playerName.padEnd(28)}${p.primaryPosition.padEnd(6)}${p.fga.toFixed(1).padEnd(7)}${playerMetric(p).toFixed(0).padEnd(8)}${minutesStr}  [${p.spanLabel}]`,
    );
  }
}

function calibrate(
  label: string,
  pool: PlayerSpan[],
  playerMetric: (p: PlayerSpan) => number,
  metricLabel: string,
  teamScoreFn: (t: Team) => number,
) {
  console.log(`\n=== ${label} ===`);
  let best: { score: number; roster: PlayerSpan[] } | null = null;
  let worst: { score: number; roster: PlayerSpan[] } | null = null;
  for (let i = 0; i < ATTEMPTS_PER_DIRECTION; i++) {
    const order = shuffle(STARTER_SLOTS);
    const maxTeam = buildExtremeTeam(pool, playerMetric, 1, order);
    if (maxTeam) {
      const s = scoreTeam(maxTeam, teamScoreFn);
      if (!best || s > best.score) best = { score: s, roster: maxTeam };
    }
    const minTeam = buildExtremeTeam(pool, playerMetric, -1, order);
    if (minTeam) {
      const s = scoreTeam(minTeam, teamScoreFn);
      if (!worst || s < worst.score) worst = { score: s, roster: minTeam };
    }
  }
  if (best) {
    console.log(`\nBEST achieved: ${best.score.toFixed(1)}`);
    printDetailedRoster(best.roster, playerMetric, metricLabel, best.score);
  }
  if (worst) {
    console.log(`\nWORST achieved: ${worst.score.toFixed(1)}`);
    printDetailedRoster(worst.roster, playerMetric, metricLabel, worst.score);
  }
  if (best && worst) {
    console.log(`\nRange across ${ATTEMPTS_PER_DIRECTION} attempts/direction: [${worst.score.toFixed(1)}, ${best.score.toFixed(1)}]`);
  }
  return { best, worst };
}

const noCurryPool = poolAll.filter((p) => normalizePlayerName(p.playerName) !== normalizePlayerName('Stephen Curry'));

const offenseResult = calibrate('OFFENSE (offenseScore, ranked by OTAL)', poolAll, computeOffensiveTalent, 'OTAL', offenseScore);
const defenseResult = calibrate('DEFENSE (defenseScore, ranked by DTAL)', poolAll, computeDefensiveTalent, 'DTAL', defenseScore);
const spacingResult = calibrate('SPACING (spacingScore, ranked by SPC, Curry excluded)', noCurryPool, computeSpacing, 'SPC', spacingScore);

console.log('\n\n=== SUMMARY: achieved raw range per metric ===');
for (const [label, r] of [
  ['offenseScore', offenseResult],
  ['defenseScore', defenseResult],
  ['spacingScore', spacingResult],
] as const) {
  if (r.best && r.worst) {
    console.log(`${label}: worst=${r.worst.score.toFixed(1)}  best=${r.best.score.toFixed(1)}`);
  }
}
