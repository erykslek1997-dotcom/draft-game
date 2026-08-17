import { computeOffensiveTalent } from './talent';
import { computeDefensiveTalent } from './defensiveTalent';
import { computeSpacing } from './spacing';
import type { Team } from './types';
import { allAssignments, GAME_MINUTES } from './rotation';
import { STARTER_SLOTS } from './positions';
import { RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../data/schema';
import { defensiveHuntability, HUNTABILITY_DRTG_POINTS_PER_PENALTY } from './defensiveHuntability';
import { defensiveCohesion, ELITE_SHELL_DRTG_TARGET } from './defensiveCohesion';

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
 * model" ask). `scripts/trainNetRatingModel.ts` first fit a single-predictor version (O-TAL ->
 * OFFRTG, D-TAL -> DEFRTG) against 865 real 1997-2026 NBA team-seasons (team_advanced.csv +
 * advanced.csv, both transient user exports — see that script's header for re-export notes).
 *
 * **Upgraded same day to a 2-predictor version** (`scripts/calibrateMultiVariateNetRating.ts`)
 * after the user noticed drafted rosters' projected DRTG all clustered near ~95 despite real
 * roster-to-roster D-TAL variation being much wider — diagnosed as the single-predictor DEF
 * slope being shallow (-0.341) because D-TAL alone only explains R²=0.248 of real DEFRTG, not a
 * display bug. Fix: find more real signal, not amplify a shaky slope by hand (which would be
 * dishonest — this project's whole point is validated numbers, not numbers that just *look*
 * differentiated). Two real predictors found and added:
 *   - Offense: O-TAL + SPACING. SPACING alone predicts real OFFRTG *more strongly* than O-TAL
 *     (r=0.695 vs 0.594, found in the original single-predictor run's own covariate check) —
 *     combining them is a genuine, large improvement: R² 0.353 -> 0.534, out-of-sample
 *     r=0.72-0.74 (season-parity split-half).
 *   - Defense: D-TAL + rim/perimeter-defender-ROLE-SHARE (the same real signal from
 *     `scripts/calibrateArchetypeComposition.ts` that was tried and reverted as a `fitScore` bonus
 *     for being too noisy there — see [[net_rating_model_and_spec_reviews]] — but works fine here
 *     as a continuous roster-wide share, not a per-player categorical credit). Real but modest
 *     gain: R² 0.248 -> 0.278, out-of-sample R²=0.25-0.30.
 *
 * **Honest limitation, checked directly and worth knowing**: the defense upgrade does NOT
 * meaningfully widen the DRTG spread among rosters this game actually drafts (checked on a real
 * 16-team auto-draft: still ~5-7 points). That's not a bug — it's because this game's talent pool
 * is a self-selected sample of quality historical players (real D-TAL 58.8-80.1 in that draft, all
 * comfortably above the real league-wide neutral of 42), unlike the full 865-team-season training
 * set, which includes genuinely bad real defenses (tanking, garbage rosters) this game structurally
 * never produces. A tight, good-to-great DRTG cluster for these rosters is the honest answer, not
 * a modeling failure. If more *differentiation* (as opposed to more *accuracy*) is ever wanted
 * regardless of real-unit honesty, that's what `defenseScore` (scoring.ts) is for — deliberately
 * rescaled to span its full achievable 0-100 range. Don't blend the two.
 *
 * **2026-08-17 playoff weak-link correction:** the base coefficients below remain the fitted
 * regular-season model. DRTG additionally receives a conservative targetable-minutes adjustment
 * from existing D-TAL and the actual 240-minute rotation. Its 0.20 multiplier is deliberately
 * lower than the fitted regular-season D-TAL slope (0.277); it is a game-specific postseason
 * structural correction, not claimed as another coefficient from the original OLS fit. Complete
 * all-time shells blend toward a bounded historical-ceiling tier (85 DRTG) because the ordinary
 * NBA training set contains no roster built entirely from elite defensive peaks. A genuine
 * POA-wing-rim core that still carries weak links can use at most a 15% fraction of that blend;
 * its targetable minutes remain fully charged. The playoff-only calibration remains diagnostic
 * because its 463-team-season sample is much noisier.
 */

// Fitted 2026-08-14 by scripts/calibrateMultiVariateNetRating.ts against team_advanced.csv +
// advanced.csv (both %TEMP%/Desktop exports, transient — see that script's own header for
// re-export notes). Re-run and replace these after any change to computeOffensiveTalent/
// computeDefensiveTalent/computeSpacing, the defensive role classifier, or a fresh data export.
const OFF_INTERCEPT = 82.28186241309736;
const OFF_B_OTAL = 0.2944062914065168;
const OFF_B_SPC = 0.24975675160090233;
const DEF_INTERCEPT = 120.2756267981417;
const DEF_B_DTAL = -0.27681728433014663;
const DEF_B_ROLESHARE = -5.678030935414075;

export interface NetRatingProjection {
  /** Projected real offensive rating (points scored per 100 possessions). */
  offense: number;
  /** Projected real defensive rating (points allowed per 100 possessions) — lower is better. */
  defense: number;
  /** offense - defense, the same convention as the real NBA's NETRTG. */
  net: number;
}

/**
 * Builds the exact same predictor shapes the training regression was fit on: plain MIN-weighted
 * averages of `computeOffensiveTalent`/`computeDefensiveTalent`/`computeSpacing`, plus the
 * MIN-weighted share of minutes carrying a rim/perimeter-defender role tag, across every assigned
 * minute (`allAssignments`, the same full 240-minute rotation `offenseScore`/`defenseScore`
 * read). A separate conservative weak-link adjustment uses those same assigned minutes.
 * Deliberately NOT multiplied by `positionFitMultiplier` — real NBA rosters (what the
 * regression was trained against) have no such concept, so applying it here would evaluate a
 * different, unvalidated predictor than the one that was actually fit.
 */
export function projectedNetRating(team: Team): NetRatingProjection {
  const assignments = allAssignments(team);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;
  if (assignments.length === 0 || totalMinutes === 0) return { offense: 0, defense: 0, net: 0 };

  const predOff = assignments.reduce((sum, { player, minutes }) => sum + computeOffensiveTalent(player) * minutes, 0) / totalMinutes;
  const predDef = assignments.reduce((sum, { player, minutes }) => sum + computeDefensiveTalent(player) * minutes, 0) / totalMinutes;
  const predSpc = assignments.reduce((sum, { player, minutes }) => sum + computeSpacing(player) * minutes, 0) / totalMinutes;
  const roleMinutes = assignments.reduce((sum, { player, minutes }) => {
    const hasRole =
      RIM_PROTECTOR_ROLES.includes(player.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number]) ||
      PERIMETER_DEFENDER_ROLES.includes(player.defensiveRole as (typeof PERIMETER_DEFENDER_ROLES)[number]);
    return hasRole ? sum + minutes : sum;
  }, 0);
  const defRoleShare = roleMinutes / totalMinutes;

  const offense = OFF_INTERCEPT + OFF_B_OTAL * predOff + OFF_B_SPC * predSpc;
  const baseDefense =
    DEF_INTERCEPT +
    DEF_B_DTAL * predDef +
    DEF_B_ROLESHARE * defRoleShare +
    defensiveHuntability(team).penalty * HUNTABILITY_DRTG_POINTS_PER_PENALTY;
  const cohesion = defensiveCohesion(team);
  const defense =
    baseDefense -
    Math.max(0, baseDefense - ELITE_SHELL_DRTG_TARGET) * cohesion.drtgCompleteness;
  return { offense, defense, net: offense - defense };
}
