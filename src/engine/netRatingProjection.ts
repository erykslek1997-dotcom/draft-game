import { computeOffensiveTalent } from './talent';
import { computeDefensiveTalent } from './defensiveTalent';
import type { Team } from './types';
import { allAssignments, GAME_MINUTES } from './rotation';
import { STARTER_SLOTS } from './positions';

/**
 * Real-NBA-units projection of a roster's offensive/defensive/net rating — points per 100
 * possessions, the same scale ESPN/real NBA standings use. Distinct from and NOT a replacement
 * for `offenseScore`/`defenseScore`/`overall` in scoring.ts, which are this game's own internal
 * 0-100 relative ranking (anchored to the best/worst roster *achievable under this game's own
 * cap rules*, per those functions' own docstrings) — this answers a different question ("how
 * would this roster actually perform in the real NBA"), so it's kept as a separate, clearly-
 * labeled informational number rather than folded into `overall`.
 *
 * Origin (2026-08-14, chat review of `all_time_nba_draft_model_spec_v1.json`'s "team evaluation
 * model" ask — the one item that check concluded was actually worth building):
 * `scripts/trainNetRatingModel.ts` regressed 865 real 1997-2026 NBA team-seasons' actual
 * OFFRTG/DEFRTG (team_advanced.csv) against the MIN-weighted average `computeOffensiveTalent`/
 * `computeDefensiveTalent` of each team's REAL roster (players matched by normalized name +
 * season to this project's own player archive; real minutes from advanced.csv). Both transient
 * user exports — re-run that script (and update the coefficients below) if revisiting after a
 * fresh export or any change to `computeOffensiveTalent`/`computeDefensiveTalent`.
 *
 * Validated out-of-sample by season-parity split-half (the bar this project's other corrections
 * are held to, not just in-sample fit): offense r=0.593/0.595, defense r=-0.514/-0.484 — both
 * directions stable, not overfit. Derived net rating (offense projection minus defense
 * projection) vs real NETRTG: r=0.761, R²=0.580. Face-validity spot checks landed within a few
 * points on well-known teams (2016 GSW real +10.7 vs predicted +9.8; 1998 Bulls +7.7 vs +5.0).
 * Typical residual on the full dataset is ~5-9 points — coaching/chemistry/in-season injury
 * variance a box-score-only projection can't see — so treat this as a real but loose estimate,
 * not a precise one.
 */

// Fitted 2026-08-14 by scripts/trainNetRatingModel.ts against team_advanced.csv + advanced.csv
// (both %TEMP%/Desktop exports, transient — see that script's own header for re-export notes).
// Re-run and replace these after any change to computeOffensiveTalent/computeDefensiveTalent or
// after a fresh data export.
const OFF_INTERCEPT = 75.31213154502557;
const OFF_SLOPE = 0.6195586677694604;
const DEF_INTERCEPT = 120.30979609943994;
const DEF_SLOPE = -0.3409696248216137;

export interface NetRatingProjection {
  /** Projected real offensive rating (points scored per 100 possessions). */
  offense: number;
  /** Projected real defensive rating (points allowed per 100 possessions) — lower is better. */
  defense: number;
  /** offense - defense, the same convention as the real NBA's NETRTG. */
  net: number;
}

/**
 * Builds the exact same predictor shape the training regression was fit on: a plain MIN-weighted
 * average of `computeOffensiveTalent`/`computeDefensiveTalent` across every assigned minute
 * (`allAssignments`, the same full 240-minute rotation `offenseScore`/`defenseScore` read).
 * Deliberately NOT multiplied by `positionFitMultiplier` — real NBA rosters (what the regression
 * was trained against) have no such concept, so applying it here would evaluate a different,
 * unvalidated predictor than the one that was actually fit.
 */
export function projectedNetRating(team: Team): NetRatingProjection {
  const assignments = allAssignments(team);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return { offense: 0, defense: 0, net: 0 };

  const predOff = assignments.reduce((sum, { player, minutes }) => sum + computeOffensiveTalent(player) * minutes, 0) / totalMinutes;
  const predDef = assignments.reduce((sum, { player, minutes }) => sum + computeDefensiveTalent(player) * minutes, 0) / totalMinutes;

  const offense = OFF_INTERCEPT + OFF_SLOPE * predOff;
  const defense = DEF_INTERCEPT + DEF_SLOPE * predDef;
  return { offense, defense, net: offense - defense };
}
