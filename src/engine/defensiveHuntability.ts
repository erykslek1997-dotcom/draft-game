import { computeDefensiveTalent } from './defensiveTalent';
import { allAssignments, primaryStarters, GAME_MINUTES } from './rotation';
import type { Team } from './types';

const TARGETABLE_DTAL_CEILING = 60;
const MAX_HUNTABILITY_PENALTY = 20;
/**
 * 2026-08-30, user-reported (batch feedback follow-up: "are bench players scaled for the fact
 * they're bench players who'll mostly face the opponent's bench, playing fewer minutes?"). They
 * weren't — `computeDefensiveTalent` is a pure, context-free per-player rating with no notion of
 * starter/bench at all, and this penalty previously charged every weak-link minute identically
 * regardless of who's realistically on the floor across from it. A real bench stint is rarely
 * "full bench vs full bench" (rotations stagger, 1-2 starters often remain either way), so this is
 * a real but MODEST relief, not a large one — deliberately smaller than `BENCH_INFLUENCE_BOOST`
 * (scoring.ts), which does the opposite job on purpose (amplifying bench's voice in the team
 * average, not softening its exploitability). First-pass estimate, not measured against a real
 * competition-quality dataset (none exists in this project) — the same honest-starting-point
 * status as every other first-pass constant here until a real report justifies tightening it.
 */
const BENCH_COMPETITION_DISCOUNT = 0.7;

export interface DefensiveHuntabilityOffender {
  playerId: string;
  playerName: string;
  /** Real assigned minutes — unchanged, still what the UI displays. */
  minutes: number;
  /** `minutes` with the bench portion discounted by `BENCH_COMPETITION_DISCOUNT` — what the
   *  penalty math below actually uses. Equal to `minutes` for a player with no bench minutes. */
  competitionAdjustedMinutes: number;
  defensiveTalent: number;
  shortfall: number;
}

export interface DefensiveHuntabilityResult {
  penalty: number;
  resistance: number;
  targetableMinutes: number;
  offenders: DefensiveHuntabilityOffender[];
}

/**
 * Nonlinear playoff weak-link signal. A minutes-weighted average can hide one or two defenders
 * behind an elite rim protector; opponents cannot. This counts the volume and severity of every
 * below-60 D-TAL stint, so two huntable perimeter players stack while a 10-minute bench weakness
 * remains much cheaper than a 36-minute starter — and now also cheaper per minute than an equally
 * weak starter, since bench minutes are discounted by `BENCH_COMPETITION_DISCOUNT` to reflect
 * facing real bench-level opposition on average, not starter-level.
 */
export function defensiveHuntability(team: Team): DefensiveHuntabilityResult {
  const minutesByPlayer = new Map<string, number>();
  // Same starter/bench split `scoring.ts`'s `benchBoostedWeightedAverage` already keys off of —
  // reused here for the opposite adjustment (discount, not boost). A player split across a
  // starter slot and a bench slot (a real possibility with cross-slot backup minutes) gets each
  // portion weighted separately, not an all-or-nothing label.
  const starterKeys = new Set(primaryStarters(team).map((s) => `${s.slot}|${s.player.id}`));
  const benchMinutesByPlayer = new Map<string, number>();
  for (const assignment of allAssignments(team)) {
    minutesByPlayer.set(assignment.player.id, (minutesByPlayer.get(assignment.player.id) ?? 0) + assignment.minutes);
    if (!starterKeys.has(`${assignment.slot}|${assignment.player.id}`)) {
      benchMinutesByPlayer.set(assignment.player.id, (benchMinutesByPlayer.get(assignment.player.id) ?? 0) + assignment.minutes);
    }
  }
  const offenders = team.roster.flatMap((player) => {
    const minutes = minutesByPlayer.get(player.id) ?? 0;
    const benchMinutes = benchMinutesByPlayer.get(player.id) ?? 0;
    const starterMinutes = minutes - benchMinutes;
    const competitionAdjustedMinutes = starterMinutes + benchMinutes * BENCH_COMPETITION_DISCOUNT;
    const defensiveTalent = computeDefensiveTalent(player);
    const shortfall = Math.max(0, TARGETABLE_DTAL_CEILING - defensiveTalent);
    return minutes > 0 && shortfall > 0
      ? [{ playerId: player.id, playerName: player.playerName, minutes, competitionAdjustedMinutes, defensiveTalent, shortfall }]
      : [];
  }).sort((left, right) => right.shortfall * right.competitionAdjustedMinutes - left.shortfall * left.competitionAdjustedMinutes);
  const shortfallMinutes = offenders.reduce((sum, offender) => sum + offender.shortfall * offender.competitionAdjustedMinutes, 0);
  const penalty = Math.min(
    MAX_HUNTABILITY_PENALTY,
    (shortfallMinutes / (TARGETABLE_DTAL_CEILING * GAME_MINUTES)) * MAX_HUNTABILITY_PENALTY,
  );
  return {
    penalty,
    resistance: Math.round(100 - (penalty / MAX_HUNTABILITY_PENALTY) * 100),
    targetableMinutes: offenders.reduce((sum, offender) => sum + offender.minutes, 0),
    offenders,
  };
}

/** Existing real-team regression shrinks one D-TAL point by 0.277 DRTG. Using 0.20 here keeps
 * the nonlinear playoff adjustment smaller than that validated linear relationship. */
export const HUNTABILITY_DRTG_POINTS_PER_PENALTY = 0.20;
