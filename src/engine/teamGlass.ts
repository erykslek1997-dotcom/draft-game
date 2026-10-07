import type { Team } from './types';
import { allAssignments } from './rotation';
import { defenderProfile } from './liveDefense';

/**
 * 2026-10-07, stage 2b (the user: "dwustronna korelacja silnik <-> symulacja"): the live game's
 * defense reads a five's rebounding at both ends and its fouls, and the engine did not — a five's
 * defensive rebounding correlated 0.81 with its DRB% in the season simulation but 0.15 with the
 * Defense score, its fouls 0.89 with opponents' free throws and 0.11 with Defense. These are the
 * same three numbers, minutes-weighted over the rotation, for the Defense and Offense scores.
 *
 * References: the bench leagues' teams (160, `scripts/benchTeams`), five-level sums per 36 minutes
 * and the foul index against the rotation average. Points per spread measured in the simulation
 * without the nudge (net rating per team over its season, on top of what Overall already knew):
 * about 0.6 points per 100 possessions for each end's rebounding and 0.4 for fouls; one Defense or
 * Offense point is worth ~0.213 per 100 (Overall weight 0.163 x 1.3 margin per Overall point).
 */
const REFERENCE_FIVE = {
  dreb: { mean: 29.48, sd: 2.47 },
  oreb: { mean: 8.93, sd: 1.2 },
  foul: { mean: 1, sd: 0.067 },
};
const POINTS_PER_SCORE_POINT = 0.213;
const DEFENSIVE_GLASS_POINTS = 0.6 / POINTS_PER_SCORE_POINT;
const OFFENSIVE_GLASS_POINTS = 0.6 / POINTS_PER_SCORE_POINT;
const FOUL_POINTS = 0.4 / POINTS_PER_SCORE_POINT;
/** No single one of these moves a score further than this. */
const MAX_Z = 2.5;

export interface TeamGlass {
  /** Defensive and offensive rebounds per 36 summed over a five, and the five's foul index. */
  dreb: number;
  oreb: number;
  foul: number;
  /** Score points for the Defense score (rebounding plus fouls) and the Offense score. */
  defensePoints: number;
  offensePoints: number;
}

const clampZ = (v: number) => Math.max(-MAX_Z, Math.min(MAX_Z, v));

export function teamGlass(team: Team): TeamGlass {
  let dreb = 0;
  let oreb = 0;
  let foul = 0;
  let minutes = 0;
  for (const { player, minutes: m } of allAssignments(team)) {
    const d = defenderProfile(player);
    dreb += m * d.dreb36;
    oreb += m * d.oreb36;
    foul += m * d.foulIndex;
    minutes += m;
  }
  if (minutes <= 0) return { dreb: 0, oreb: 0, foul: 1, defensePoints: 0, offensePoints: 0 };
  // Per five: the minutes-weighted average player times five.
  dreb = (5 * dreb) / minutes;
  oreb = (5 * oreb) / minutes;
  foul /= minutes;
  const z = (v: number, r: { mean: number; sd: number }) => clampZ((v - r.mean) / r.sd);
  return {
    dreb,
    oreb,
    foul,
    defensePoints: DEFENSIVE_GLASS_POINTS * z(dreb, REFERENCE_FIVE.dreb) - FOUL_POINTS * z(foul, REFERENCE_FIVE.foul),
    offensePoints: OFFENSIVE_GLASS_POINTS * z(oreb, REFERENCE_FIVE.oreb),
  };
}
