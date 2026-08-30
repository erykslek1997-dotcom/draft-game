import type { PlayerSpan, Position } from '../data/schema';
import { STARTER_SLOTS, positionFitMultiplier } from './positions';
import { computeOffensiveTalent, computeDefensiveTalent } from './talent';
import { computeSpacing } from './spacing';
import { TEAM_MODEL_THRESHOLDS } from './teamModel';

/**
 * Team Model v1's own recommended next step (see TEAM_MODEL_V1_SHADOW_2026-08-30.md): three
 * deterministic five-man closing-lineup evaluators built from the roster's existing nine players,
 * using only signals this project already computes and trusts (O-TAL/D-TAL via talent.ts,
 * spacing via spacing.ts, position legality via positions.ts). Shadow-only, same as the rest of
 * Team Model v1 — nothing here feeds TAL, Overall, simulation, rotation assignment or the AI
 * drafter. It only answers "which five would this roster actually close games with," under three
 * different priorities, and surfaces that as insight text.
 *
 * Deterministic by construction: every legal five-man subset of the roster is evaluated exactly
 * once (no sampling, no randomness), and the highest-scoring subset per objective wins ties by
 * first-encountered order, which is itself fixed by the roster's own array order.
 */

export type ClosingObjective = 'balanced' | 'offense' | 'defense';

export interface ClosingLineupPlayer {
  playerId: string;
  playerName: string;
  slot: Position;
}

export interface ClosingLineup {
  objective: ClosingObjective;
  players: ClosingLineupPlayer[];
  offenseScore: number; // 0..1
  defenseScore: number; // 0..1
  spacingScore: number; // 0..1
  score: number;        // 0..1, this objective's own composite
}

export interface ClosingLineupSet {
  balanced: ClosingLineup;
  offense: ClosingLineup;
  defense: ClosingLineup;
  /** How much peak offense/defense the balanced five gives up vs. the specialized fives. 0 means
   *  the balanced lineup IS the specialized lineup on that side — no real tradeoff exists. */
  balancedOffenseTradeoff: number; // 0..1
  balancedDefenseTradeoff: number; // 0..1
  /** How many of the five players are shared between the pure-offense and pure-defense fives. */
  offenseDefensePersonnelOverlap: number; // 0..5
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const mean = (values: number[]) => values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
const normalize = (value: number, lo: number, hi: number) => clamp01((value - lo) / (hi - lo));

// Same real D-TAL/spacing percentile anchors `insightMapper.ts` already normalizes against
// (fitScore's own calibration — reused directly, not re-derived). O-TAL has no equivalently
// named exported constant to import (grades.ts's tier floors are private to that module), so its
// two anchors are the same real values this codebase already treats as meaningful bars: 40 is
// grades.ts's own "Bench Warmer" tier floor (replacement level), and `TEAM_MODEL_THRESHOLDS
// .eliteCreation` (82) is Team Model v1's own already-shipped "elite offensive creation" bar —
// not two new guessed numbers.
const OTAL_LO = 40;
const OTAL_HI = TEAM_MODEL_THRESHOLDS.eliteCreation;
const DTAL_LO = 19;
const DTAL_HI = 79;
const SPACING_LO = 0;
const SPACING_HI = 85;

interface SlotAssignment {
  slot: Position;
  player: PlayerSpan;
}

function combinationsOfSize<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items;
  const withHead = combinationsOfSize(rest, size - 1).map((combo) => [head, ...combo]);
  const withoutHead = combinationsOfSize(rest, size);
  return [...withHead, ...withoutHead];
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) { yield items; return; }
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) yield [items[i], ...perm];
  }
}

/** The best LEGAL way to put a specific five-player subset into the five starter slots — the
 *  same "maximize total position fit" idea `rotation.ts`'s own starter assignment already uses,
 *  applied to a fixed subset instead of the whole roster. Null if no legal bijection exists at
 *  all (e.g. the subset has two true centers and no guard). */
function bestAssignmentForSubset(subset: PlayerSpan[]): SlotAssignment[] | null {
  let best: SlotAssignment[] | null = null;
  let bestFitSum = -1;
  for (const perm of permutations(STARTER_SLOTS)) {
    let fitSum = 0;
    let feasible = true;
    const assignment: SlotAssignment[] = [];
    for (let i = 0; i < perm.length; i++) {
      const slot = perm[i];
      const player = subset[i];
      const fit = positionFitMultiplier(player, slot);
      if (fit <= 0) { feasible = false; break; }
      fitSum += fit;
      assignment.push({ slot, player });
    }
    if (feasible && fitSum > bestFitSum) {
      bestFitSum = fitSum;
      best = assignment;
    }
  }
  return best;
}

interface ScoredCandidate {
  assignment: SlotAssignment[];
  offenseScore: number;
  defenseScore: number;
  spacingScore: number;
}

function scoreCandidate(assignment: SlotAssignment[]): ScoredCandidate {
  const offenseAvg = mean(assignment.map((a) => computeOffensiveTalent(a.player)));
  const defenseAvg = mean(assignment.map((a) => computeDefensiveTalent(a.player)));
  const spacingAvg = mean(assignment.map((a) => computeSpacing(a.player)));
  return {
    assignment,
    offenseScore: normalize(offenseAvg, OTAL_LO, OTAL_HI),
    defenseScore: normalize(defenseAvg, DTAL_LO, DTAL_HI),
    spacingScore: normalize(spacingAvg, SPACING_LO, SPACING_HI),
  };
}

function objectiveScore(objective: ClosingObjective, c: ScoredCandidate): number {
  if (objective === 'offense') return clamp01(0.65 * c.offenseScore + 0.35 * c.spacingScore);
  if (objective === 'defense') return c.defenseScore;
  // Balanced deliberately rewards being good on BOTH ends over a high average with one weak
  // side — a two-way five that's 0.65/0.65 beats a 0.90/0.40 five with the same 0.65 average.
  const avg = (c.offenseScore + c.defenseScore) / 2;
  const floor = Math.min(c.offenseScore, c.defenseScore);
  return clamp01(0.5 * avg + 0.5 * floor);
}

function toClosingLineup(objective: ClosingObjective, c: ScoredCandidate): ClosingLineup {
  return {
    objective,
    players: c.assignment.map((a) => ({ playerId: a.player.id, playerName: a.player.playerName, slot: a.slot })),
    offenseScore: c.offenseScore,
    defenseScore: c.defenseScore,
    spacingScore: c.spacingScore,
    score: objectiveScore(objective, c),
  };
}

/**
 * Every legal five-man subset of `roster`, evaluated once, with the best objective-scoring
 * subset returned per objective. Returns null only if the roster has fewer than five players or
 * genuinely no legal five-man bijection exists (both effectively impossible for this game's real
 * 9-man, five-real-position rosters — checked directly against real drafted teams in
 * `scripts/testClosingLineups.ts` — but this stays a real possibility for hypothetical or partial
 * rosters rather than an assumed guarantee).
 */
export function buildClosingLineups(roster: PlayerSpan[]): ClosingLineupSet | null {
  if (roster.length < STARTER_SLOTS.length) return null;

  const candidates: ScoredCandidate[] = [];
  for (const subset of combinationsOfSize(roster, STARTER_SLOTS.length)) {
    const assignment = bestAssignmentForSubset(subset);
    if (assignment) candidates.push(scoreCandidate(assignment));
  }
  if (candidates.length === 0) return null;

  const bestFor = (objective: ClosingObjective) =>
    candidates.reduce((best, c) =>
      objectiveScore(objective, c) > objectiveScore(objective, best) ? c : best
    );

  const offenseCandidate = bestFor('offense');
  const defenseCandidate = bestFor('defense');
  const balancedCandidate = bestFor('balanced');

  const offenseIds = new Set(offenseCandidate.assignment.map((a) => a.player.id));
  const overlap = defenseCandidate.assignment.filter((a) => offenseIds.has(a.player.id)).length;

  return {
    balanced: toClosingLineup('balanced', balancedCandidate),
    offense: toClosingLineup('offense', offenseCandidate),
    defense: toClosingLineup('defense', defenseCandidate),
    balancedOffenseTradeoff: clamp01(offenseCandidate.offenseScore - balancedCandidate.offenseScore),
    balancedDefenseTradeoff: clamp01(defenseCandidate.defenseScore - balancedCandidate.defenseScore),
    offenseDefensePersonnelOverlap: overlap,
  };
}
