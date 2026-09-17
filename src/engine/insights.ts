import type { OffensiveArchetype, DefensiveRole, Position } from '../data/schema';
import { CAP_LIMIT } from './positions';
import { TEAM_MODEL_THRESHOLDS } from './teamModel';
import type { ClosingLineupSet } from './closingLineups';

/**
 * 2026-08-15, adapted from a user-supplied draft (`rosterInsightDetectors.ts`) — a deterministic,
 * scored insight engine for the Strengths/Concerns text ResultsScreen.tsx shows per team.
 * Deliberately a TEXT-generation layer only: `overall`/`fitScore`/`rotationScore`/`benchDepthScore`
 * etc. (scoring.ts) remain the actual judge — this only replaces how the accompanying prose is
 * produced, from ad-hoc `notes.push(...)` scattered through `fitScore`/`rotationScore` plus
 * `syntheticLowScoreConcerns`'s catch-all, to a registry of ~60 named detectors with real
 * severity/relevance/confidence/uniqueness scoring and suppression so overlapping insights don't
 * spam the panel. The real Team → `TeamFeatureSnapshot` translation lives in `insightMapper.ts`,
 * built from this engine's own already-validated signals (see that file's own docstring) — none of
 * the ~20 snapshot fields are invented fresh here.
 *
 * Changes from the original draft, kept deliberately minimal (adapt, don't redesign):
 * - `offensiveArchetype`/`defensiveRole` retyped from loose `string` to this project's real
 *   `OffensiveArchetype`/`DefensiveRole` unions (schema.ts) — every other engine file in this
 *   project uses these, and a typo'd role string here would have silently never matched anything.
 * - The roster has since returned to nine players (five starters + four reserves). Team Model v1
 *   therefore distinguishes an acceptable low-cost ninth slot behind a robust eight-man playoff
 *   rotation from a dead slot that actually leaves the rotation short.
 * - Detector logic, scoring formula, and suppression mechanism are otherwise untouched — that
 *   part of the original draft was already sound. Thresholds are carried over as first-pass
 *   values, NOT yet individually validated against this game's real draft-pool distribution the
 *   way this project's other constants are (see `insightMapper.ts`'s own docstring for which
 *   fields are closest to real validated signals vs. genuine first-pass approximations) — revisit
 *   with real measurement if a specific detector reads as mistuned in practice, the same way every
 *   other calibrated constant in this codebase was tightened after a real report, not guessed
 *   right on the first attempt.
 */

export type InsightType = 'strength' | 'concern';
export type InsightCategory =
  | 'creation' | 'usage' | 'fga' | 'spacing' | 'shooting' | 'off_ball'
  | 'perimeter_defense' | 'rim_protection' | 'defensive_structure'
  | 'rebounding' | 'rotation' | 'position' | 'depth'
  | 'two_way' | 'fit' | 'redundancy' | 'cross';

export interface PlayerTeamFeature {
  playerId: string;
  playerName: string;
  spanLabel: string;
  minutes: number;
  fga: number;
  rpg?: number;
  tal?: number;
  primaryPosition?: Position;
  secondaryPositions?: Position[];
  offensiveArchetype?: OffensiveArchetype;
  defensiveRole?: DefensiveRole;
  highUsageWeight?: number;
  isSpacingArchetype?: boolean;
  isRimProtectorRole?: boolean;
  isPerimeterDefenderRole?: boolean;
  threePct?: number;
  threePA?: number;
  tsPct?: number;
  usagePct?: number;
  assistRate?: number;
  turnoverRate?: number;
  orbPct?: number;
  drbPct?: number;
  offensiveImpact?: number;
  defensiveImpact?: number;
  overallImpact?: number;
  minuteCeiling?: number;
  availability?: number;
  naturalPositionFit?: number; // 0..1
  roleFlexibility?: number;    // 0..1
  uncertainty?: number;        // 0..1
  starterSlot?: Position;
  spacingImpact?: number;      // 0..1, accuracy + volume through the existing spacing model
  movementShooting?: number;   // 0..1, only incumbent or explicitly validated role evidence
  movementShootingConfidence?: number; // 0..1
  movementShootingEvidence?: string;
}

export interface TeamFeatureSnapshot {
  teamId: string;
  players: PlayerTeamFeature[];
  starters: PlayerTeamFeature[];
  bench: PlayerTeamFeature[];
  totalMinutes: number;
  totalFga: number;

  offenseProjection?: number;
  defenseProjection?: number;
  netRatingProjection?: number;

  highUsagePlayerCount?: number;
  creatorCount?: number;
  secondaryCreatorCount?: number;
  lowUsageComplementCount?: number;
  usageOverlapScore?: number;       // 0..1
  fgaCompressionScore?: number;     // 0..1
  fgaEfficiencyScore?: number;      // 0..1

  spacingCount?: number;
  starterSpacingCount?: number;
  spacingStrength?: number;         // 0..1
  starterSpacingStrength?: number;  // 0..1
  benchSpacingStrength?: number;    // 0..1
  nonSpacerCount?: number;
  starterNonSpacerCount?: number;
  plusShooterCount?: number;
  starterPlusShooterCount?: number;
  topShooterMinuteShare?: number;   // 0..1

  perimeterDefenderCount?: number;
  starterPerimeterDefenderCount?: number;
  rimProtectorCount?: number;
  starterRimProtectorCount?: number;
  perimeterDefenseScore?: number;   // 0..1
  rimProtectionScore?: number;      // 0..1
  defensiveLayeringScore?: number;  // 0..1
  defensiveWeakLinkCount?: number;
  defensiveTargetableMinutes?: number;
  /** The exact players `defensiveWeakLinkCount` counted (real `defensiveHuntability` offenders,
   * position-relative and athleticism-adjusted) — the one canonical "who's a weak link" list every
   * weak-link detector should read, instead of each re-deriving its own flat threshold. */
  defensiveWeakLinkPlayers?: { playerName: string; defensiveImpact: number; minutes: number }[];

  teamOrbScore?: number;             // 0..1
  teamDrbScore?: number;             // 0..1
  starterReboundingScore?: number;   // 0..1

  positionalCompromiseCount?: number;
  severePositionalCompromiseCount?: number;
  positionalCompromisePlayers?: string[];
  severePositionalCompromisePlayers?: string[];
  minutesCeilingViolationCount?: number;
  deepRotationScore?: number;        // 0..1
  topHeavyScore?: number;            // 0..1
  roleFlexibilityScore?: number;     // 0..1
  benchDropoffScore?: number;        // 0..1
  availabilityRisk?: number;         // 0..1
  uncertainty?: number;              // 0..1

  // Team Model v1 diagnostic extension. These fields do not affect scoring or draft AI.
  movementShootingStrength?: number; // 0..1
  movementShooterMinutes?: number;
  movementShooterNames?: string[];
  frontcourtSpacingStrength?: number; // 0..1
  frontcourtSpacerCount?: number;
  naturalBigStarterCount?: number;
  nonlinearNonSpacerPenalty?: number; // 0..1
  defensiveCoverageCapacity?: number; // 0..1, measured available layers only
  defensiveCoverageConfirmedLayers?: number;
  switchabilityScore?: number;        // 0..1
  huntabilityMitigationScore?: number;// 0..1
  huntabilityExposureScore?: number;  // 0..1
  defensiveWeakLinkSeverity?: number; // 0..1 before contextual mitigation
  targetableRotationNames?: string[];
  targetableStarterNames?: string[];
  mitigatedSpecialistNames?: string[];
  playoffRotationDepthScore?: number; // 0..1 against an eight-player playoff target
  meaningfulPlayoffPlayerCount?: number;
  lowFgaImpactCount?: number;
  lowFgaImpactPlayers?: string[];
  deadRosterSlotCount?: number;
  deadRosterSlotPlayers?: string[];
  deadRosterSlotFga?: number;

  // Team Model v1's closing-lineup extension (closingLineups.ts). Also shadow-only.
  closingLineups?: ClosingLineupSet;
}

export interface InsightEvidence {
  players?: string[];
  values?: Record<string, number | string | boolean | null>;
  notes?: string[];
}

export type DetectorId =
  | 'ELITE_PRIMARY_CREATOR' | 'MULTIPLE_CREATION_SOURCES'
  | 'SECONDARY_CREATION_PRESENT' | 'CREATION_SHORTAGE'
  | 'SINGLE_CREATOR_DEPENDENCY' | 'BENCH_CREATION_SHORTAGE'
  | 'CREATION_SURVIVES_STAR_REST'
  | 'EFFICIENT_FGA_BUDGET' | 'HIGH_TALENT_PER_FGA'
  | 'STAR_FGA_COMPRESSION' | 'MULTIPLE_HIGH_USAGE_PLAYERS'
  | 'SEVERE_USAGE_COLLISION' | 'UNDERUSED_OFFENSIVE_TALENT'
  | 'LOW_USAGE_COMPLEMENTS' | 'BENCH_FGA_INEFFICIENCY'
  | 'FGA_BUDGET_NEAR_LIMIT'
  | 'ELITE_STARTING_SPACING' | 'GOOD_STARTING_SPACING'
  | 'LOW_STARTING_SPACING' | 'MULTIPLE_NON_SPACERS'
  | 'SPACING_CONCENTRATED' | 'SPACING_DISTRIBUTED'
  | 'BENCH_SPACING' | 'BENCH_SPACING_COLLAPSE'
  | 'STRETCH_BIG_VALUE' | 'NO_FRONTCOURT_SPACING'
  | 'SHOOTING_SAMPLE_UNCERTAINTY' | 'ONE_CRITICAL_SHOOTER'
  | 'OFFENSIVE_ROLES_COMPLEMENTARY' | 'OFFENSIVE_ROLE_REDUNDANCY'
  | 'STAR_SUPPORT_FIT' | 'TOO_MANY_FINISHERS'
  | 'TOO_MANY_ON_BALL_ROLES' | 'OFF_BALL_SUPPORT_STRONG'
  | 'ELITE_PERIMETER_DEFENSE' | 'MULTIPLE_PERIMETER_DEFENDERS'
  | 'POA_DEFENDER_PRESENT' | 'NO_POA_DEFENDER'
  | 'WING_STOPPER_PRESENT' | 'NO_WING_STOPPER'
  | 'PERIMETER_DEFENSE_BENCH_DEPTH'
  | 'ELITE_RIM_PROTECTION' | 'RIM_PROTECTOR_PRESENT'
  | 'MULTIPLE_RIM_PROTECTORS' | 'NO_RIM_PROTECTOR'
  | 'SINGLE_RIM_PROTECTOR_DEPENDENCY' | 'RIM_PROTECTION_CONTINUITY'
  | 'BENCH_RIM_PROTECTION_COLLAPSE'
  | 'ELITE_DEFENSIVE_LAYERING' | 'BALANCED_DEFENSIVE_COVERAGE'
  | 'DEFENSIVE_ROLE_REDUNDANCY' | 'DEFENSIVE_WEAK_LINK'
  | 'MULTIPLE_DEFENSIVE_WEAK_LINKS' | 'DEFENSE_SURVIVES_SUBSTITUTIONS'
  | 'DEFENSE_DEPENDS_ON_STARTERS'
  | 'ELITE_TEAM_REBOUNDING' | 'STRONG_STARTING_REBOUNDING'
  | 'WEAK_STARTING_REBOUNDING' | 'OREB_STRENGTH'
  | 'DREB_STRENGTH' | 'DREB_WEAKNESS'
  | 'REBOUNDING_DEPTH' | 'REBOUNDING_DEPENDS_ON_ONE_PLAYER'
  | 'SMALL_LINEUP_REBOUNDING_RISK'
  | 'NATURAL_POSITION_ROTATION' | 'ONE_POSITIONAL_COMPROMISE'
  | 'MULTIPLE_POSITIONAL_COMPROMISES' | 'SEVERE_POSITIONAL_STRAIN'
  | 'PLAYER_ABOVE_MINUTES_CEILING' | 'MULTIPLE_MINUTES_CEILING_VIOLATIONS'
  | 'STAR_MINUTES_UNDERUSED' | 'DEEP_PLAYOFF_ROTATION'
  | 'TOP_HEAVY_ROTATION'
  | 'MATCHUP_SPECIALIST_AVAILABLE' | 'ROLE_FLEXIBILITY_HIGH'
  | 'ROLE_FLEXIBILITY_LOW'
  | 'ELITE_TWO_WAY_CORE' | 'BALANCED_STARTING_FIVE'
  | 'OFFENSE_HEAVY_ROSTER' | 'DEFENSE_HEAVY_ROSTER'
  | 'STAR_ROLE_PLAYER_BALANCE' | 'HIGH_VALUE_ROLE_PLAYERS'
  | 'REDUNDANT_BENCH' | 'BENCH_COMPLEMENTS_STARTERS'
  | 'BENCH_DUPLICATES_STARTERS' | 'NO_MAJOR_STRUCTURAL_HOLE'
  | 'MULTIPLE_STRUCTURAL_HOLES'
  | 'DEFENSE_AT_COST_OF_SPACING' | 'SPACING_AT_COST_OF_DEFENSE'
  | 'ELITE_DEFENSE_LOW_FGA_COST' | 'STAR_POWER_WITHOUT_USAGE_COLLISION'
  | 'STAR_POWER_WITH_USAGE_COLLISION' | 'GREAT_STARTERS_WEAK_BENCH'
  | 'WEAK_STARTERS_STRONG_BENCH'
  | 'RIM_PROTECTION_BUT_POOR_PERIMETER_DEFENSE'
  | 'PERIMETER_DEFENSE_BUT_NO_RIM_PROTECTION'
  | 'ELITE_CREATION_POOR_SPACING' | 'ELITE_SPACING_WEAK_CREATION'
  | 'GOOD_SPACING_BUT_ONE_NONSHOOTER_BOTTLENECK'
  | 'DEFENSIVE_LINEUPS_BREAK_OFFENSE'
  | 'OFFENSIVE_LINEUPS_BREAK_DEFENSE'
  | 'BENCH_FIXES_STARTER_WEAKNESS'
  | 'BENCH_FAILS_TO_FIX_STARTER_WEAKNESS'
  | 'HIGH_TALENT_POOR_RESOURCE_ALLOCATION'
  | 'LOW_FGA_HIGH_IMPACT_CONSTRUCTION'
  | 'STRONG_CORE_FRAGILE_ROTATION'
  | 'MULTIPLE_PATHS_TO_VIABLE_LINEUP'
  | 'MOVEMENT_SHOOTING_GRAVITY' | 'SPACING_WITH_TWO_BIGS_VIABLE'
  | 'NON_SPACER_OVERLOAD' | 'DEFENSIVE_COVERAGE_CAPACITY_ELITE'
  | 'HUNTABLE_SPECIALIST_MITIGATED' | 'HUNTABLE_STARTER_EXPOSED'
  | 'LOW_FGA_ROTATION_VALUE' | 'STAR_FGA_COST_JUSTIFIED'
  | 'STAR_FGA_COST_HURTS_DEPTH' | 'DEAD_NINTH_SLOT_ACCEPTABLE'
  | 'DEAD_SLOT_HURTS_ROTATION'
  | 'CLOSING_FIVE_STABLE' | 'CLOSING_FIVE_REQUIRES_TRADEOFF';

export interface RosterInsight {
  id: DetectorId;
  type: InsightType;
  category: InsightCategory;
  severity: number;
  relevance: number;
  confidence: number;
  uniqueness: number;
  score: number;
  message: string;
  evidence: InsightEvidence;
  suppressionGroup?: string;
  suppresses?: DetectorId[];
}

export interface DetectorResult {
  active: boolean;
  severity?: number;
  relevance?: number;
  confidence?: number;
  uniqueness?: number;
  message?: string;
  evidence?: InsightEvidence;
}

export interface RosterInsightDetector {
  id: DetectorId;
  type: InsightType;
  category: InsightCategory;
  suppressionGroup?: string;
  suppresses?: DetectorId[];
  evaluate(team: TeamFeatureSnapshot): DetectorResult;
}

export const INSIGHT_SCORE_WEIGHTS = {
  severity: 0.40,
  relevance: 0.30,
  confidence: 0.20,
  uniqueness: 0.10,
} as const;

export const DEFAULT_INSIGHT_CONFIG = {
  minScore: 0.55,
  targetPerSide: 5,
  minPerSide: 3,
  maxPerSide: 7,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const teamConfidence = (t: TeamFeatureSnapshot) => clamp01(1 - (t.uncertainty ?? 0.15));

export function scoreInsight(
  severity: number,
  relevance: number,
  confidence: number,
  uniqueness: number,
): number {
  return clamp01(
    clamp01(severity) * INSIGHT_SCORE_WEIGHTS.severity +
    clamp01(relevance) * INSIGHT_SCORE_WEIGHTS.relevance +
    clamp01(confidence) * INSIGHT_SCORE_WEIGHTS.confidence +
    clamp01(uniqueness) * INSIGHT_SCORE_WEIGHTS.uniqueness
  );
}

const inactive: DetectorResult = { active: false };

function displayNames(players: { playerName: string }[], limit = 3): string {
  const names = players.slice(0, limit).map((player) => player.playerName);
  if (players.length > limit) names.push(`+${players.length - limit} more`);
  return names.join(', ');
}

function displayNameList(names: string[], limit = 3): string {
  const visible = names.slice(0, limit);
  if (names.length > limit) visible.push(`+${names.length - limit} more`);
  return visible.join(', ');
}

function isCrediblePoa(player: PlayerTeamFeature): boolean {
  const roleFits =
    player.defensiveRole === 'Point of Attack' ||
    player.defensiveRole === 'Chaser' ||
    (player.defensiveRole === 'Wing Stopper' &&
      (player.primaryPosition === 'PG' || player.primaryPosition === 'SG'));
  return roleFits && (player.defensiveImpact ?? 0) >= 60 && player.minutes >= 18;
}

function isCredibleWingStopper(player: PlayerTeamFeature): boolean {
  return player.defensiveRole === 'Wing Stopper' &&
    (player.defensiveImpact ?? 0) >= 60 &&
    player.minutes >= 18;
}

const hit = (
  severity: number,
  relevance: number,
  confidence: number,
  message: string,
  evidence: InsightEvidence = {},
  uniqueness = 0.8,
): DetectorResult => ({
  active: true,
  severity: clamp01(severity),
  relevance: clamp01(relevance),
  confidence: clamp01(confidence),
  uniqueness: clamp01(uniqueness),
  message,
  evidence,
});

export const SUPPRESSION_GROUPS: Record<string, DetectorId[]> = {
  creation_positive: ['ELITE_PRIMARY_CREATOR', 'MULTIPLE_CREATION_SOURCES', 'SECONDARY_CREATION_PRESENT', 'CREATION_SURVIVES_STAR_REST'],
  // 2026-09-05: dropped 'BENCH_CREATION_SHORTAGE' — referenced here and in the DetectorId union,
  // but no detector with that id was ever implemented in DETECTORS below, so this reference could
  // never match anything real (found + verified via a real integrity check, see
  // scripts/testDetectorIntegrity.ts). Same root cause across every removal in this block.
  creation_negative: ['CREATION_SHORTAGE', 'SINGLE_CREATOR_DEPENDENCY'],
  // 'UNDERUSED_OFFENSIVE_TALENT' dropped — never implemented.
  usage_negative: ['MULTIPLE_HIGH_USAGE_PLAYERS', 'SEVERE_USAGE_COLLISION', 'STAR_FGA_COMPRESSION'],
  spacing_positive: ['ELITE_STARTING_SPACING', 'GOOD_STARTING_SPACING', 'SPACING_DISTRIBUTED', 'BENCH_SPACING', 'STRETCH_BIG_VALUE'],
  spacing_negative: ['LOW_STARTING_SPACING', 'MULTIPLE_NON_SPACERS', 'NON_SPACER_OVERLOAD', 'SPACING_CONCENTRATED', 'BENCH_SPACING_COLLAPSE', 'NO_FRONTCOURT_SPACING', 'ONE_CRITICAL_SHOOTER'],
  perimeter_positive: ['ELITE_PERIMETER_DEFENSE', 'MULTIPLE_PERIMETER_DEFENDERS', 'POA_DEFENDER_PRESENT', 'WING_STOPPER_PRESENT', 'PERIMETER_DEFENSE_BENCH_DEPTH'],
  perimeter_negative: ['NO_POA_DEFENDER', 'NO_WING_STOPPER'],
  // 'RIM_PROTECTOR_PRESENT' and 'MULTIPLE_RIM_PROTECTORS' dropped — never implemented.
  rim_positive: ['ELITE_RIM_PROTECTION', 'RIM_PROTECTION_CONTINUITY'],
  // 'BENCH_RIM_PROTECTION_COLLAPSE' dropped — never implemented.
  rim_negative: ['NO_RIM_PROTECTOR', 'SINGLE_RIM_PROTECTOR_DEPENDENCY'],
  defense_positive: ['ELITE_DEFENSIVE_LAYERING', 'BALANCED_DEFENSIVE_COVERAGE', 'DEFENSE_SURVIVES_SUBSTITUTIONS'],
  defense_negative: ['DEFENSIVE_WEAK_LINK', 'MULTIPLE_DEFENSIVE_WEAK_LINKS', 'DEFENSE_DEPENDS_ON_STARTERS'],
  rotation_positive: ['NATURAL_POSITION_ROTATION', 'DEEP_PLAYOFF_ROTATION', 'MATCHUP_SPECIALIST_AVAILABLE', 'ROLE_FLEXIBILITY_HIGH'],
  rotation_negative: ['ONE_POSITIONAL_COMPROMISE', 'MULTIPLE_POSITIONAL_COMPROMISES', 'SEVERE_POSITIONAL_STRAIN', 'PLAYER_ABOVE_MINUTES_CEILING', 'MULTIPLE_MINUTES_CEILING_VIOLATIONS', 'TOP_HEAVY_ROTATION', 'ROLE_FLEXIBILITY_LOW'],
};

export const EXPLICIT_SUPPRESSION: Partial<Record<DetectorId, DetectorId[]>> = {
  SEVERE_USAGE_COLLISION: ['MULTIPLE_HIGH_USAGE_PLAYERS'],
  ELITE_STARTING_SPACING: ['GOOD_STARTING_SPACING'],
  // 'NO_WING_STOPPER' added 2026-09-17 (contradiction audit, see the comment block below this
  // object) — merged into this same pre-existing key. A first pass of this fix added a *second*
  // `ELITE_PERIMETER_DEFENSE` key further down instead — a plain object literal silently lets the
  // later duplicate win rather than erroring or merging, which would have quietly dropped this
  // line's two original targets. Caught by re-reading the diff, not by any test — neither `tsc`
  // nor `testDetectorIntegrity.ts` flags a duplicated object-literal key.
  ELITE_PERIMETER_DEFENSE: ['MULTIPLE_PERIMETER_DEFENDERS', 'POA_DEFENDER_PRESENT', 'NO_WING_STOPPER'],
  // 2026-09-05: dropped the standalone 'ELITE_RIM_PROTECTION' entry here — both of its targets
  // ('RIM_PROTECTOR_PRESENT', 'MULTIPLE_RIM_PROTECTORS') were never implemented as real detectors,
  // so the entry could never suppress anything. Same root cause as the SUPPRESSION_GROUPS cleanup
  // above (see scripts/testDetectorIntegrity.ts).
  ELITE_DEFENSIVE_LAYERING: ['ELITE_PERIMETER_DEFENSE', 'ELITE_RIM_PROTECTION', 'MULTIPLE_PERIMETER_DEFENDERS', 'POA_DEFENDER_PRESENT', 'BALANCED_DEFENSIVE_COVERAGE'],
  MULTIPLE_MINUTES_CEILING_VIOLATIONS: ['PLAYER_ABOVE_MINUTES_CEILING'],
  SEVERE_POSITIONAL_STRAIN: ['ONE_POSITIONAL_COMPROMISE', 'MULTIPLE_POSITIONAL_COMPROMISES'],
  MULTIPLE_DEFENSIVE_WEAK_LINKS: ['DEFENSIVE_WEAK_LINK'],
  STAR_POWER_WITH_USAGE_COLLISION: ['MULTIPLE_HIGH_USAGE_PLAYERS', 'SEVERE_USAGE_COLLISION', 'STAR_FGA_COMPRESSION'],
  LOW_FGA_HIGH_IMPACT_CONSTRUCTION: ['EFFICIENT_FGA_BUDGET'],
  NON_SPACER_OVERLOAD: ['MULTIPLE_NON_SPACERS'],
  DEFENSIVE_COVERAGE_CAPACITY_ELITE: ['ELITE_DEFENSIVE_LAYERING', 'BALANCED_DEFENSIVE_COVERAGE'],
  HUNTABLE_STARTER_EXPOSED: ['MULTIPLE_DEFENSIVE_WEAK_LINKS', 'DEFENSIVE_WEAK_LINK'],
  // 2026-09-17, contradiction audit additions below — every existing entry above only ever
  // suppresses a same-TYPE detector (a strength killing a weaker strength, a concern killing a
  // weaker concern); nothing crossed the strength/concern boundary, which is exactly the gap real
  // playtester feedback ("generally writes contradictory things") landed on. `NO_WING_STOPPER` is
  // merged into the pre-existing `ELITE_PERIMETER_DEFENSE` key above rather than a new one here —
  // its message ("elite on the perimeter, multiple credible matchups") is a general claim that
  // doesn't itself distinguish ball-pressure defenders from wing stoppers, so "lacks a credible
  // matchup for elite scoring wings" reads as contradicting it even though NO_WING_STOPPER checks
  // a real, narrower sub-skill worth keeping distinct rather than unifying outright.
  // A "fragile outside its best lineups" concern (deepRotationScore's 15-minute bar) is the more
  // specific, more cautious claim when it disagrees with "acceptable dead ninth slot" (Team
  // Model's looser 12-minute bar) — a warning should win a disagreement like this, not a reassurance.
  STRONG_CORE_FRAGILE_ROTATION: ['DEAD_NINTH_SLOT_ACCEPTABLE'],
  // BALANCED_DEFENSIVE_COVERAGE's "few obvious matchup targets" already reads `defensiveWeakLinkCount
  // <= 1`, which after the DEFENSIVE_WEAK_LINK fix above shares the exact same canonical
  // `defensiveHuntability` definition DEFENSIVE_WEAK_LINK itself uses — so at the boundary
  // (exactly 1 real weak link) both are now factually AGREEING, not disagreeing, but "few obvious
  // matchup targets" right next to "{Player} is the rotation's clearest matchup-hunting target"
  // still reads as whiplash in the same panel (confirmed live on a real 32-roster sample,
  // scripts/testInsightsSlow.ts). The general strength already covers this case; the specific
  // single-player concern adds nothing once it does.
  BALANCED_DEFENSIVE_COVERAGE: ['DEFENSIVE_WEAK_LINK'],
};

/** Shared with `NO_MAJOR_STRUCTURAL_HOLE` below, so "clears every major checkpoint" can never
 * claim a rebounding bar this same file's own `WEAK_STARTING_REBOUNDING` calls vulnerable —
 * 2026-09-17, contradiction audit: the two used to be independent numbers (0.50 vs. 0.62) with a
 * real overlapping window a live team could land in. */
const WEAK_STARTING_REBOUNDING_THRESHOLD = 0.62;

export const DETECTORS: RosterInsightDetector[] = [
  {
    id: 'ELITE_PRIMARY_CREATOR', type: 'strength', category: 'creation',
    suppressionGroup: 'creation_positive',
    evaluate: t => {
      const creators = t.players
        .filter(p => (p.highUsageWeight ?? 0) >= 0.5 && p.minutes >= 24)
        .sort((a, b) => (b.offensiveImpact ?? 0) - (a.offensiveImpact ?? 0));
      const lead = creators[0];
      return lead && (lead.offensiveImpact ?? 0) >= 82
        ? hit((lead.offensiveImpact ?? 0) / 100, 0.94, teamConfidence(t), `${lead.playerName} gives the offense an elite primary creator who can organize difficult half-court possessions.`, { players: [lead.playerName], values: { offensiveImpact: lead.offensiveImpact ?? 0, minutes: lead.minutes } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_CREATION_SOURCES', type: 'strength', category: 'creation',
    suppressionGroup: 'creation_positive',
    evaluate: t => {
      const creators = t.players
        .filter(p => (p.highUsageWeight ?? 0) > 0 && p.minutes >= 15)
        .sort((a, b) => (b.offensiveImpact ?? 0) - (a.offensiveImpact ?? 0));
      // 2026-09-17, contradiction audit: this local `highUsageWeight > 0` refilter also counts
      // Primary/Secondary Ball Handlers (weight 0.25/0.5), a looser bar than the canonical
      // `creatorCount` (weight >= 1, real Shot Creator/Slasher-tier) that CREATION_SHORTAGE/
      // ELITE_SPACING_WEAK_CREATION/TOO_MANY_FINISHERS all gate on at `<= 1`. Confirmed live: a
      // team with zero real advantage creators but a Primary + Secondary Ball Handler still hit 3
      // "creators" here, firing "reducing dependence on one initiator" the same breath as "may lack
      // enough advantage creation." Requiring the canonical count too closes the gap with no
      // overlap (its concern-side ceiling is 1, this now needs 2+).
      return creators.length >= 3 && (t.creatorCount ?? 0) >= 2
        ? hit(0.62 + creators.length * 0.07, 0.91, teamConfidence(t), `Creation is distributed across ${displayNames(creators)}, reducing dependence on one initiator.`, { players: creators.map(p => p.playerName), values: { creatorCount: creators.length } }, 0.92)
        : inactive;
    }
  },
  {
    id: 'SECONDARY_CREATION_PRESENT', type: 'strength', category: 'creation',
    suppressionGroup: 'creation_positive',
    evaluate: t => {
      const secondary = t.players
        .filter(p => p.offensiveArchetype === 'Secondary Ball Handler' && p.minutes >= 15)
        .sort((a, b) => b.minutes - a.minutes);
      // 2026-09-17, contradiction audit: this message presupposes a real "lead creator" exists —
      // gate it on the canonical `creatorCount` so it can't fire in the same breath as
      // CREATION_SHORTAGE's "no reliable advantage creator" (creatorCount === 0).
      return secondary.length > 0 && (t.creatorCount ?? 0) >= 1
        ? hit(0.66, 0.78, teamConfidence(t), `${displayNames(secondary)} ${secondary.length === 1 ? 'provides' : 'provide'} secondary ball handling when the lead creator is pressured or rests.`, { players: secondary.map(p => p.playerName), values: { secondaryCreatorCount: secondary.length } })
        : inactive;
    }
  },
  {
    id: 'CREATION_SURVIVES_STAR_REST', type: 'strength', category: 'creation',
    suppressionGroup: 'creation_positive',
    evaluate: t => {
      const benchCreators = t.bench
        .filter(p => (p.highUsageWeight ?? 0) > 0 && (p.offensiveImpact ?? 0) >= 65 && p.minutes >= 15)
        .sort((a, b) => (b.offensiveImpact ?? 0) - (a.offensiveImpact ?? 0));
      return benchCreators.length > 0
        ? hit(0.70, 0.87, teamConfidence(t), `${displayNames(benchCreators)} ${benchCreators.length === 1 ? 'keeps' : 'keep'} credible creation on the floor when the starting engines sit.`, { players: benchCreators.map(p => p.playerName), values: { benchCreatorCount: benchCreators.length } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'CREATION_SHORTAGE', type: 'concern', category: 'creation',
    suppressionGroup: 'creation_negative',
    evaluate: t => (t.creatorCount ?? 0) === 0
      ? hit(0.92, 0.98, teamConfidence(t), 'No reliable advantage creator — too much of the offense depends on assisted or pre-created looks.', { values: { creatorCount: 0 } }, 0.95)
      : inactive
  },
  {
    id: 'SINGLE_CREATOR_DEPENDENCY', type: 'concern', category: 'creation',
    suppressionGroup: 'creation_negative',
    evaluate: t => {
      const creators = t.players.filter(p => (p.highUsageWeight ?? 0) >= 1 && p.minutes >= 20);
      const otherCreation = t.players.filter(p => (p.highUsageWeight ?? 0) > 0 && !creators.includes(p) && p.minutes >= 15);
      return creators.length === 1 && otherCreation.length === 0
        ? hit(0.75, 0.92, teamConfidence(t), `Half-court creation depends heavily on ${creators[0].playerName}; there is no credible secondary initiator behind him.`, { players: [creators[0].playerName], values: { creatorCount: 1 } }, 0.92)
        : inactive;
    }
  },
  {
    id: 'ELITE_STARTING_SPACING', type: 'strength', category: 'spacing',
    suppressionGroup: 'spacing_positive', suppresses: ['GOOD_STARTING_SPACING'],
    evaluate: t => {
      const s = t.starterSpacingStrength ?? 0;
      const n = t.starterPlusShooterCount ?? t.starterSpacingCount ?? 0;
      // 2026-08-16, user-reported contradiction: `starterSpacingStrength` is the AVERAGE of the
      // five starters' individual spacing numbers, so it can clear a high bar purely off 2-3
      // extreme shooters even while 2+ OTHER starters are flagged as real non-spacers — the
      // average and the count aren't the same claim, but reading "elite floor spacing" right next
      // to "N starters grade as non-spacers, increasing half-court congestion"
      // (MULTIPLE_NON_SPACERS below) reads as a flat contradiction to a real user, not two
      // compatible facts. Gated the positive claim on `starterNonSpacerCount` too — "elite/
      // credible spacing" now means the WHOLE starting five backs that up, not just the average.
      const nonSpacers = t.starterNonSpacerCount ?? 0;
      return s >= 0.80 && n >= 4 && nonSpacers <= 1
        ? hit(s, 0.95, teamConfidence(t), `Starting five provides elite floor spacing with ${n} credible plus shooters.`, { values: { starterSpacingStrength: s, starterPlusShooterCount: n, starterNonSpacerCount: nonSpacers } })
        : inactive;
    }
  },
  {
    id: 'GOOD_STARTING_SPACING', type: 'strength', category: 'spacing',
    suppressionGroup: 'spacing_positive',
    evaluate: t => {
      const s = t.starterSpacingStrength ?? 0;
      const n = t.starterPlusShooterCount ?? t.starterSpacingCount ?? 0;
      // Same MULTIPLE_NON_SPACERS contradiction guard as ELITE_STARTING_SPACING above.
      const nonSpacers = t.starterNonSpacerCount ?? 0;
      return s >= 0.62 && n >= 3 && nonSpacers <= 1
        ? hit(s, 0.88, teamConfidence(t), `Starting lineup has credible spacing across ${n} spots.`, { values: { starterSpacingStrength: s, starterPlusShooterCount: n, starterNonSpacerCount: nonSpacers } })
        : inactive;
    }
  },
  {
    id: 'LOW_STARTING_SPACING', type: 'concern', category: 'spacing',
    suppressionGroup: 'spacing_negative',
    evaluate: t => {
      const s = t.starterSpacingStrength ?? 1;
      const n = t.starterPlusShooterCount ?? t.starterSpacingCount ?? 5;
      const nonShooters = t.starters.filter(p => !p.isSpacingArchetype);
      if (s > 0.45 && n >= 2) return inactive;
      return hit(Math.max(1 - s, (3 - n) / 3), 0.95, teamConfidence(t), `The starting lineup has only ${n} credible plus shooter${n === 1 ? '' : 's'}; ${displayNames(nonShooters)} allow the defense to shrink the floor.`, { players: nonShooters.map(p => p.playerName), values: { starterSpacingStrength: s, starterPlusShooterCount: n } });
    }
  },
  {
    id: 'MULTIPLE_NON_SPACERS', type: 'concern', category: 'spacing',
    suppressionGroup: 'spacing_negative',
    evaluate: t => {
      const n = t.starterNonSpacerCount ?? 0;
      const nonShooters = t.starters.filter(p => !p.isSpacingArchetype);
      return n >= 2
        ? hit(0.55 + (n - 2) * 0.18, 0.92, teamConfidence(t), `${displayNames(nonShooters)} give opponents ${n} starting non-shooters to help away from, increasing half-court congestion.`, { players: nonShooters.map(p => p.playerName), values: { starterNonSpacerCount: n } })
        : inactive;
    }
  },
  {
    id: 'SPACING_CONCENTRATED', type: 'concern', category: 'spacing',
    suppressionGroup: 'spacing_negative',
    evaluate: t => {
      const share = t.topShooterMinuteShare ?? 0;
      const n = t.plusShooterCount ?? 0;
      return share >= 0.42 && n <= 3
        ? hit(0.5 + share * 0.45, 0.83, teamConfidence(t), 'Team shooting is concentrated in a small number of players rather than distributed across the rotation.', { values: { topShooterMinuteShare: share, plusShooterCount: n } })
        : inactive;
    }
  },
  {
    id: 'BENCH_SPACING_COLLAPSE', type: 'concern', category: 'spacing',
    suppressionGroup: 'spacing_negative',
    evaluate: t => {
      const a = t.starterSpacingStrength ?? 0;
      const b = t.benchSpacingStrength ?? 0;
      const drop = a - b;
      return drop >= 0.28 && b <= 0.52
        ? hit(0.55 + drop * 0.65, 0.78, teamConfidence(t), 'Spacing deteriorates sharply when bench units replace the primary starters.', { values: { starterSpacingStrength: a, benchSpacingStrength: b, drop } })
        : inactive;
    }
  },
  {
    id: 'SPACING_DISTRIBUTED', type: 'strength', category: 'spacing',
    suppressionGroup: 'spacing_positive',
    evaluate: t => {
      const n = t.plusShooterCount ?? 0;
      const share = t.topShooterMinuteShare ?? 1;
      // 2026-09-17, contradiction audit: `plusShooterCount`/`topShooterMinuteShare` are ROTATION-
      // wide, while MULTIPLE_NON_SPACERS/ELITE_CREATION_POOR_SPACING read the STARTERS-only
      // spacing signal — confirmed live, a team with 4 non-shooting starters but a deep shooting
      // bench cleared both this detector's roster-wide bar and MULTIPLE_NON_SPACERS' starter-only
      // one. Same `starterNonSpacerCount` contradiction guard ELITE_STARTING_SPACING/
      // GOOD_STARTING_SPACING already use — "spacing doesn't depend on one specialist" shouldn't
      // fire in the same breath as "N starters are non-shooters."
      const nonSpacers = t.starterNonSpacerCount ?? 0;
      return n >= 5 && share <= 0.30 && nonSpacers <= 1
        ? hit(0.62 + n * 0.06, 0.86, teamConfidence(t), `${n} rotation players provide credible shooting, so spacing does not depend on one specialist.`, { values: { plusShooterCount: n, topShooterMinuteShare: share, starterNonSpacerCount: nonSpacers } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'BENCH_SPACING', type: 'strength', category: 'spacing',
    evaluate: t => {
      const shooters = t.bench.filter(p => p.isSpacingArchetype && p.minutes >= 12);
      const strength = t.benchSpacingStrength ?? 0;
      return strength >= 0.65 && shooters.length >= 2
        ? hit(strength, 0.76, teamConfidence(t), `Bench units retain spacing through ${displayNames(shooters)}, limiting offensive drop-off after substitutions.`, { players: shooters.map(p => p.playerName), values: { benchSpacingStrength: strength, benchShooterCount: shooters.length } }, 0.88)
        : inactive;
    }
  },
  {
    id: 'STRETCH_BIG_VALUE', type: 'strength', category: 'shooting',
    evaluate: t => {
      const bigs = t.players.filter(p =>
        (p.primaryPosition === 'PF' || p.primaryPosition === 'C') &&
        (p.offensiveArchetype === 'Stretch Big' || p.offensiveArchetype === 'Versatile Big') &&
        p.isSpacingArchetype && p.minutes >= 18,
      );
      return bigs.length > 0
        ? hit(0.70, 0.84, teamConfidence(t), `${displayNames(bigs)} ${bigs.length === 1 ? 'provides' : 'provide'} frontcourt shooting that pulls rim protectors away from the basket.`, { players: bigs.map(p => p.playerName), values: { stretchBigCount: bigs.length } }, 0.92)
        : inactive;
    }
  },
  {
    id: 'NO_FRONTCOURT_SPACING', type: 'concern', category: 'spacing',
    suppressionGroup: 'spacing_negative',
    evaluate: t => {
      const frontcourt = t.starters.filter(p => p.primaryPosition === 'PF' || p.primaryPosition === 'C');
      const shootingBigs = frontcourt.filter(p => p.isSpacingArchetype);
      return frontcourt.length >= 2 && shootingBigs.length === 0
        ? hit(0.73, 0.88, teamConfidence(t), `The starting frontcourt (${displayNames(frontcourt)}) provides no credible shooting gravity away from the paint.`, { players: frontcourt.map(p => p.playerName), values: { frontcourtSpacingCount: 0 } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'ONE_CRITICAL_SHOOTER', type: 'concern', category: 'spacing',
    suppressionGroup: 'spacing_negative',
    evaluate: t => {
      const shooters = t.players.filter(p => p.isSpacingArchetype && p.minutes >= 12);
      return shooters.length === 1 && (t.topShooterMinuteShare ?? 0) >= 0.45
        ? hit(0.78, 0.90, teamConfidence(t), `Spacing depends almost entirely on ${shooters[0].playerName}; lineups without him can be compressed aggressively.`, { players: [shooters[0].playerName], values: { plusShooterCount: 1, topShooterMinuteShare: t.topShooterMinuteShare ?? 0 } }, 0.94)
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_HIGH_USAGE_PLAYERS', type: 'concern', category: 'usage',
    suppressionGroup: 'usage_negative',
    evaluate: t => {
      const n = t.highUsagePlayerCount ?? 0;
      const overlap = t.usageOverlapScore ?? 0;
      return n >= 3 && overlap >= 0.48
        ? hit(0.45 + overlap * 0.45, 0.93, teamConfidence(t), `${n} rotation players carry meaningful on-ball demand and may compete for limited touches.`, { values: { highUsagePlayerCount: n, usageOverlapScore: overlap } })
        : inactive;
    }
  },
  {
    id: 'SEVERE_USAGE_COLLISION', type: 'concern', category: 'usage',
    suppressionGroup: 'usage_negative', suppresses: ['MULTIPLE_HIGH_USAGE_PLAYERS'],
    evaluate: t => {
      const n = t.highUsagePlayerCount ?? 0;
      const overlap = t.usageOverlapScore ?? 0;
      return n >= 3 && overlap >= 0.75
        ? hit(overlap, 0.96, teamConfidence(t), 'The roster has severe on-ball redundancy: several high-demand creators compete for the same limited possessions.', { values: { highUsagePlayerCount: n, usageOverlapScore: overlap } })
        : inactive;
    }
  },
  {
    id: 'STAR_FGA_COMPRESSION', type: 'concern', category: 'fga',
    suppressionGroup: 'usage_negative',
    evaluate: t => {
      const c = t.fgaCompressionScore ?? 0;
      return c >= 0.55
        ? hit(c, 0.94, teamConfidence(t), 'At least one high-value scorer requires a meaningful reduction from his historical shot volume.', { values: { fgaCompressionScore: c, totalFga: t.totalFga } })
        : inactive;
    }
  },
  {
    id: 'EFFICIENT_FGA_BUDGET', type: 'strength', category: 'fga',
    evaluate: t => {
      const s = t.fgaEfficiencyScore ?? 0;
      return s >= 0.70
        ? hit(s, 0.90, teamConfidence(t), 'The roster uses its shot budget efficiently, generating strong value per allocated shot.', { values: { fgaEfficiencyScore: s, totalFga: t.totalFga } })
        : inactive;
    }
  },
  {
    // 2026-08-15, threshold raised 3->5 (`scripts/_measureInsightRates.ts`, 96 real teams):
    // `HIGH_USAGE_ARCHETYPE_WEIGHT` only tags 4 of 12 offensive archetypes as "high usage," so on
    // the then-active 8-man roster at least 3 non-ball-dominant complements was true of literally
    // every team (100% fire rate measured) — not a real differentiator. The threshold of 5 remains
    // a majority-style complement signal in the restored 9-man format without firing on everyone.
    id: 'LOW_USAGE_COMPLEMENTS', type: 'strength', category: 'fit',
    evaluate: t => {
      const n = t.lowUsageComplementCount ?? 0;
      return n >= 5
        ? hit(0.50 + n * 0.09, 0.82, teamConfidence(t), `${n} rotation players provide useful minutes without demanding star-level offensive volume.`, { values: { lowUsageComplementCount: n } })
        : inactive;
    }
  },
  {
    id: 'OFFENSIVE_ROLES_COMPLEMENTARY', type: 'strength', category: 'off_ball',
    evaluate: t => {
      const creators = t.players.filter(p => (p.highUsageWeight ?? 0) > 0 && p.minutes >= 18);
      const offBall = t.players.filter(p =>
        ['Off Screen Shooter', 'Movement Shooter', 'Stationary Shooter', 'Roll & Cut Big'].includes(p.offensiveArchetype ?? '') &&
        p.minutes >= 15,
      );
      // 2026-09-17, contradiction audit: same loose-vs-canonical creator gap as
      // MULTIPLE_CREATION_SOURCES above — "on-ball creation is complemented" needs the canonical
      // `creatorCount` to actually clear TOO_MANY_FINISHERS' `<= 1` "too little creation" ceiling.
      return creators.length >= 2 && offBall.length >= 2 && (t.creatorCount ?? 0) >= 2
        ? hit(0.76, 0.87, teamConfidence(t), `On-ball creation is complemented by off-ball value from ${displayNames(offBall)}, giving possessions clear role separation.`, { players: [...creators, ...offBall].map(p => p.playerName), values: { creatorCount: creators.length, offBallSupportCount: offBall.length } }, 0.94)
        : inactive;
    }
  },
  {
    id: 'OFF_BALL_SUPPORT_STRONG', type: 'strength', category: 'off_ball',
    evaluate: t => {
      const support = t.players.filter(p =>
        ['Off Screen Shooter', 'Movement Shooter', 'Stationary Shooter', 'Stretch Big', 'Roll & Cut Big'].includes(p.offensiveArchetype ?? '') &&
        p.minutes >= 15,
      );
      return support.length >= 4
        ? hit(0.68 + support.length * 0.05, 0.80, teamConfidence(t), `${displayNames(support)} supply extensive shooting, cutting or finishing value without monopolizing the ball.`, { players: support.map(p => p.playerName), values: { offBallSupportCount: support.length } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'TOO_MANY_FINISHERS', type: 'concern', category: 'off_ball',
    evaluate: t => {
      const finishers = t.players.filter(p =>
        ['Slasher', 'Athletic Finisher', 'Post Scorer', 'Roll & Cut Big'].includes(p.offensiveArchetype ?? '') &&
        p.minutes >= 15,
      );
      const creators = t.creatorCount ?? 0;
      return finishers.length >= 4 && creators <= 1
        ? hit(0.72, 0.86, teamConfidence(t), `The roster has many finishers (${displayNames(finishers)}) but too little creation to consistently generate their best opportunities.`, { players: finishers.map(p => p.playerName), values: { finisherCount: finishers.length, creatorCount: creators } }, 0.92)
        : inactive;
    }
  },
  {
    id: 'ELITE_PERIMETER_DEFENSE', type: 'strength', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_positive', suppresses: ['MULTIPLE_PERIMETER_DEFENDERS', 'POA_DEFENDER_PRESENT'],
    evaluate: t => {
      const s = t.perimeterDefenseScore ?? 0;
      const n = t.starterPerimeterDefenderCount ?? 0;
      return s >= 0.80 && n >= 2
        ? hit(s, 0.94, teamConfidence(t), 'The primary rotation projects as elite on the perimeter, with multiple credible defensive matchups.', { values: { perimeterDefenseScore: s, starterPerimeterDefenderCount: n } })
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_PERIMETER_DEFENDERS', type: 'strength', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_positive',
    evaluate: t => {
      const defenders = t.players
        .filter(p => p.isPerimeterDefenderRole && (p.defensiveImpact ?? 0) >= 65 && p.minutes >= 15)
        .sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0));
      return defenders.length >= 3
        ? hit(0.66 + defenders.length * 0.06, 0.86, teamConfidence(t), `${displayNames(defenders)} give the rotation multiple credible perimeter matchups.`, { players: defenders.map(p => p.playerName), values: { perimeterDefenderCount: defenders.length } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'POA_DEFENDER_PRESENT', type: 'strength', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_positive',
    evaluate: t => {
      const defenders = t.players.filter(isCrediblePoa).sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0));
      return defenders.length > 0
        ? hit(0.70, 0.83, teamConfidence(t), `${defenders[0].playerName} provides a credible first line of defense against primary ball handlers.`, { players: [defenders[0].playerName], values: { defensiveImpact: defenders[0].defensiveImpact ?? 0, minutes: defenders[0].minutes } }, 0.88)
        : inactive;
    }
  },
  {
    id: 'WING_STOPPER_PRESENT', type: 'strength', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_positive',
    evaluate: t => {
      const defenders = t.players.filter(isCredibleWingStopper).sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0));
      return defenders.length > 0
        ? hit(0.70, 0.84, teamConfidence(t), `${defenders[0].playerName} supplies a credible matchup for elite scoring wings.`, { players: [defenders[0].playerName], values: { defensiveImpact: defenders[0].defensiveImpact ?? 0, minutes: defenders[0].minutes } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'PERIMETER_DEFENSE_BENCH_DEPTH', type: 'strength', category: 'perimeter_defense',
    evaluate: t => {
      const defenders = t.bench
        .filter(p => p.isPerimeterDefenderRole && (p.defensiveImpact ?? 0) >= 65 && p.minutes >= 12)
        .sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0));
      return defenders.length >= 2
        ? hit(0.72, 0.78, teamConfidence(t), `Perimeter defense survives substitutions through ${displayNames(defenders)} on the bench.`, { players: defenders.map(p => p.playerName), values: { benchPerimeterDefenderCount: defenders.length } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'NO_POA_DEFENDER', type: 'concern', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_negative',
    evaluate: t => {
      // Mirrors defensiveCohesion: a strong guard Wing Stopper/Chaser can credibly take the ball
      // even when the incumbent role label is not literally `Point of Attack`.
      const has = t.players.some(isCrediblePoa);
      return !has ? hit(0.72, 0.89, teamConfidence(t), 'The primary rotation lacks a clear point-of-attack defensive role.', { values: { hasPOADefender: false } }) : inactive;
    }
  },
  {
    id: 'NO_WING_STOPPER', type: 'concern', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_negative',
    evaluate: t => !t.players.some(isCredibleWingStopper)
      ? hit(0.70, 0.88, teamConfidence(t), 'The rotation lacks a credible primary matchup for elite scoring wings.', { values: { hasWingStopper: false } }, 0.9)
      : inactive
  },
  {
    id: 'ELITE_RIM_PROTECTION', type: 'strength', category: 'rim_protection',
    suppressionGroup: 'rim_positive', suppresses: ['RIM_PROTECTOR_PRESENT', 'MULTIPLE_RIM_PROTECTORS'],
    evaluate: t => {
      const s = t.rimProtectionScore ?? 0;
      // 2026-09-17, contradiction audit: `rimProtectionScore` only reads the STARTING rim
      // protector(s)' D-TAL, so it said nothing about bench depth — confirmed live, a team with
      // exactly one elite starting anchor and zero backups cleared this bar while
      // SINGLE_RIM_PROTECTOR_DEPENDENCY (whole-roster count === 1) fired right next to it, and
      // "reliable rim protection" directly contradicts "bench units lose much of that protection."
      // Requiring a real second rim-protector-tagged player closes the gap with no overlap
      // (SINGLE_RIM_PROTECTOR_DEPENDENCY's own count is exactly 1).
      const depth = t.rimProtectorCount ?? 0;
      return s >= 0.82 && depth >= 2
        ? hit(s, 0.95, teamConfidence(t), 'The roster has elite interior defensive coverage and reliable rim protection.', { values: { rimProtectionScore: s, rimProtectorCount: depth } })
        : inactive;
    }
  },
  {
    id: 'RIM_PROTECTION_CONTINUITY', type: 'strength', category: 'rim_protection',
    suppressionGroup: 'rim_positive',
    evaluate: t => {
      const ps = t.players.filter(p => p.isRimProtectorRole && p.minutes >= 10);
      return ps.length >= 2
        ? hit(0.60 + ps.length * 0.08, 0.85, teamConfidence(t), `${displayNames(ps)} preserve rim protection across frontcourt substitutions rather than leaving one lone anchor.`, { players: ps.map(p => p.playerName), values: { rimProtectorCount: ps.length } })
        : inactive;
    }
  },
  {
    id: 'NO_RIM_PROTECTOR', type: 'concern', category: 'rim_protection',
    suppressionGroup: 'rim_negative',
    evaluate: t => (t.rimProtectorCount ?? 0) === 0
      ? hit(0.86, 0.96, teamConfidence(t), 'The roster lacks a recognized rim-protection role in its playoff rotation.', { values: { rimProtectorCount: 0 } })
      : inactive
  },
  {
    id: 'SINGLE_RIM_PROTECTOR_DEPENDENCY', type: 'concern', category: 'rim_protection',
    suppressionGroup: 'rim_negative',
    evaluate: t => {
      const ps = t.players.filter(p => p.isRimProtectorRole && p.minutes >= 10);
      if (ps.length !== 1) return inactive;
      const p = ps[0];
      return hit(0.64, Math.min(1, p.minutes / 36), teamConfidence(t), `Interior defense depends heavily on ${p.playerName}; bench units lose much of that protection.`, { players: [p.playerName], values: { minutes: p.minutes } });
    }
  },
  {
    id: 'ELITE_DEFENSIVE_LAYERING', type: 'strength', category: 'defensive_structure',
    suppressionGroup: 'defense_positive', suppresses: ['ELITE_PERIMETER_DEFENSE', 'ELITE_RIM_PROTECTION', 'MULTIPLE_PERIMETER_DEFENDERS', 'POA_DEFENDER_PRESENT', 'RIM_PROTECTOR_PRESENT', 'BALANCED_DEFENSIVE_COVERAGE'],
    evaluate: t => {
      const s = t.defensiveLayeringScore ?? 0;
      const perimeter = t.players
        .filter(p => p.isPerimeterDefenderRole && (p.defensiveImpact ?? 0) >= 60 && p.minutes >= 18)
        .sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0))[0];
      const rim = t.players
        .filter(p => p.isRimProtectorRole && (p.defensiveImpact ?? 0) >= 60 && p.minutes >= 18)
        .sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0))[0];
      return s >= 0.82
        ? hit(s, 0.98, teamConfidence(t), `Elite defensive layering pairs ${perimeter?.playerName ?? 'strong perimeter resistance'} with ${rim?.playerName ?? 'reliable interior protection'} behind the play.`, { players: [perimeter?.playerName, rim?.playerName].filter((name): name is string => Boolean(name)), values: { defensiveLayeringScore: s } })
        : inactive;
    }
  },
  {
    id: 'BALANCED_DEFENSIVE_COVERAGE', type: 'strength', category: 'defensive_structure',
    suppressionGroup: 'defense_positive',
    evaluate: t => {
      const layering = t.defensiveLayeringScore ?? 0;
      const weakLinks = t.defensiveWeakLinkCount ?? 0;
      return layering >= 0.65 && weakLinks <= 1
        ? hit(layering, 0.86, teamConfidence(t), 'The rotation combines credible perimeter containment with back-line rim protection and few obvious matchup targets.', { values: { defensiveLayeringScore: layering, defensiveWeakLinkCount: weakLinks } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'DEFENSE_SURVIVES_SUBSTITUTIONS', type: 'strength', category: 'defensive_structure',
    suppressionGroup: 'defense_positive',
    evaluate: t => {
      const benchDefenders = t.bench
        .filter(p => (p.defensiveImpact ?? 0) >= 68 && p.defensiveRole !== 'Low Activity' && p.minutes >= 12)
        .sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0));
      return benchDefenders.length >= 2 && (t.defensiveTargetableMinutes ?? 0) <= 30
        ? hit(0.74, 0.82, teamConfidence(t), `${displayNames(benchDefenders)} keep defensive quality on the floor when starters rest.`, { players: benchDefenders.map(p => p.playerName), values: { benchDefenderCount: benchDefenders.length, targetableMinutes: t.defensiveTargetableMinutes ?? 0 } }, 0.92)
        : inactive;
    }
  },
  {
    id: 'DEFENSIVE_WEAK_LINK', type: 'concern', category: 'defensive_structure',
    suppressionGroup: 'defense_negative',
    evaluate: t => {
      // 2026-09-17, contradiction audit: reads the same canonical `defensiveHuntability` offender
      // list `defensiveWeakLinkCount`/`BALANCED_DEFENSIVE_COVERAGE` already use, instead of a flat
      // `defensiveImpact < 60` re-derivation that could disagree with them (confirmed live: a bench
      // PG at D-TAL 55 cleared his own real position bar but failed the flat 60 cut, so this fired
      // right alongside "few obvious matchup targets").
      const weak = [...(t.defensiveWeakLinkPlayers ?? [])].sort((a, b) => b.minutes - a.minutes);
      return weak.length === 1
        ? hit(0.55 + weak[0].minutes / 80, 0.91, teamConfidence(t), `${weak[0].playerName} (${Math.round(weak[0].defensiveImpact)} D-TAL, ${weak[0].minutes} min) is the rotation's clearest matchup-hunting target.`, { players: [weak[0].playerName], values: { defensiveTalent: weak[0].defensiveImpact, minutes: weak[0].minutes, targetableMinutes: t.defensiveTargetableMinutes ?? weak[0].minutes } }, 0.94)
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_DEFENSIVE_WEAK_LINKS', type: 'concern', category: 'defensive_structure',
    suppressionGroup: 'defense_negative', suppresses: ['DEFENSIVE_WEAK_LINK'],
    evaluate: t => {
      const n = t.defensiveWeakLinkCount ?? 0;
      const weak = [...(t.defensiveWeakLinkPlayers ?? [])].sort((a, b) => b.minutes - a.minutes);
      return n >= 2
        ? hit(0.60 + n * 0.10, 0.94, teamConfidence(t), `${displayNames(weak)} combine for ${t.defensiveTargetableMinutes ?? 0} targetable minutes, giving opponents multiple matchup-hunting options.`, { players: weak.map(p => p.playerName), values: { defensiveWeakLinkCount: n, targetableMinutes: t.defensiveTargetableMinutes ?? 0 }, notes: weak.map(p => `${p.playerName}: D-TAL ${Math.round(p.defensiveImpact)}, ${p.minutes} min`) }, 0.96)
        : inactive;
    }
  },
  {
    id: 'DEFENSE_DEPENDS_ON_STARTERS', type: 'concern', category: 'defensive_structure',
    suppressionGroup: 'defense_negative',
    evaluate: t => {
      const benchTargets = t.bench
        .filter(p => (p.defensiveImpact ?? 100) < 60 && p.minutes >= 10)
        .sort((a, b) => b.minutes - a.minutes);
      const targetMinutes = benchTargets.reduce((sum, p) => sum + p.minutes, 0);
      return (t.defensiveLayeringScore ?? 0) >= 0.68 && targetMinutes >= 24
        ? hit(0.58 + targetMinutes / 160, 0.88, teamConfidence(t), `The starting defensive structure weakens when ${displayNames(benchTargets)} enter; those bench targets cover ${targetMinutes} minutes.`, { players: benchTargets.map(p => p.playerName), values: { benchTargetableMinutes: targetMinutes } }, 0.94)
        : inactive;
    }
  },
  {
    id: 'STRONG_STARTING_REBOUNDING', type: 'strength', category: 'rebounding',
    evaluate: t => {
      const s = t.starterReboundingScore ?? 0;
      const rebounders = [...t.starters].sort((a, b) => (b.rpg ?? 0) - (a.rpg ?? 0)).slice(0, 2);
      return s >= 0.68
        ? hit(s, 0.80, teamConfidence(t), `${displayNames(rebounders)} lead a starting five strong enough on the glass to protect possessions.`, { players: rebounders.map(p => p.playerName), values: { starterReboundingScore: s } })
        : inactive;
    }
  },
  {
    // 2026-08-19, user's explicit ask ("look for ways to make around 7 strengths and concerns"):
    // 0.40 never fired across a real 48-team simulated sample (`scripts/_measureDeadConcernSignals.ts`,
    // deleted after use) — `starterReboundingScore`'s own real p10 is 0.600, so even the worst 10%
    // of real drafted rosters cleared the old bar by a wide margin. Raised to 0.62 (just above the
    // real p10), so this now flags the genuinely weakest rebounding tier instead of a threshold
    // that was unreachable under this game's real roster distribution.
    id: 'WEAK_STARTING_REBOUNDING', type: 'concern', category: 'rebounding',
    evaluate: t => {
      const s = t.starterReboundingScore ?? 1;
      return s <= WEAK_STARTING_REBOUNDING_THRESHOLD
        ? hit(1 - s, 0.82, teamConfidence(t), 'The starting group projects as vulnerable on the glass and may concede extra possessions.', { values: { starterReboundingScore: s } })
        : inactive;
    }
  },
  {
    id: 'NATURAL_POSITION_ROTATION', type: 'strength', category: 'position',
    suppressionGroup: 'rotation_positive',
    evaluate: t => (t.positionalCompromiseCount ?? 0) === 0
      ? hit(0.72, 0.77, teamConfidence(t), 'Every rotation assignment stays within a player’s natural or demonstrated secondary positions.', { values: { positionalCompromiseCount: 0 } }, 0.86)
      : inactive
  },
  {
    id: 'ONE_POSITIONAL_COMPROMISE', type: 'concern', category: 'position',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const compromised = t.players.filter(p => (p.naturalPositionFit ?? 1) < 0.95 && p.minutes > 0);
      return (t.positionalCompromiseCount ?? 0) === 1
        ? hit(0.58, 0.72, teamConfidence(t), `${t.positionalCompromisePlayers?.[0] ?? displayNames(compromised)} requires one meaningful out-of-position assignment to complete the rotation.`, { players: t.positionalCompromisePlayers ?? compromised.map(p => p.playerName), values: { positionalCompromiseCount: 1 } }, 0.86)
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_POSITIONAL_COMPROMISES', type: 'concern', category: 'position',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const n = t.positionalCompromiseCount ?? 0;
      return n >= 2
        ? hit(0.50 + n * 0.11, 0.86, teamConfidence(t), `${n} rotation slots ask ${t.positionalCompromisePlayers?.join(', ') ?? 'multiple players'} to play out of position.`, { players: t.positionalCompromisePlayers, values: { positionalCompromiseCount: n } })
        : inactive;
    }
  },
  {
    id: 'SEVERE_POSITIONAL_STRAIN', type: 'concern', category: 'position',
    suppressionGroup: 'rotation_negative', suppresses: ['ONE_POSITIONAL_COMPROMISE', 'MULTIPLE_POSITIONAL_COMPROMISES'],
    evaluate: t => {
      const n = t.severePositionalCompromiseCount ?? 0;
      const names = t.severePositionalCompromisePlayers ?? [];
      return n >= 1
        ? hit(0.76 + n * 0.08, 0.94, teamConfidence(t), names.length === 1
          ? `${names[0]} is pushed well beyond a natural positional range, creating a major rotation strain.`
          : `${names.join(', ') || 'The affected players'} are pushed well beyond their natural positional ranges, creating a major rotation strain.`, { players: names, values: { severePositionalCompromiseCount: n } }, 0.96)
        : inactive;
    }
  },
  {
    id: 'PLAYER_ABOVE_MINUTES_CEILING', type: 'concern', category: 'rotation',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const over = t.players.filter(p => p.minuteCeiling != null && p.minutes > p.minuteCeiling);
      return over.length === 1
        ? hit(0.62 + (over[0].minutes - (over[0].minuteCeiling ?? over[0].minutes)) / 20, 0.86, teamConfidence(t), `${over[0].playerName} is assigned ${over[0].minutes} minutes against a ${over[0].minuteCeiling}-minute durability ceiling.`, { players: [over[0].playerName], values: { minutes: over[0].minutes, minuteCeiling: over[0].minuteCeiling ?? 0 } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_MINUTES_CEILING_VIOLATIONS', type: 'concern', category: 'rotation',
    suppressionGroup: 'rotation_negative', suppresses: ['PLAYER_ABOVE_MINUTES_CEILING'],
    evaluate: t => {
      const n = t.minutesCeilingViolationCount ?? 0;
      const ps = t.players.filter(p => p.minuteCeiling != null && p.minutes > p.minuteCeiling);
      return n >= 2
        ? hit(0.55 + n * 0.10, 0.90, teamConfidence(t), `${n} players are being asked to exceed their projected minutes ceiling.`, { players: ps.map(p => p.playerName), values: { minutesCeilingViolationCount: n }, notes: ps.map(p => `${p.playerName}: ${p.minutes}/${p.minuteCeiling} min`) })
        : inactive;
    }
  },
  {
    id: 'STAR_MINUTES_UNDERUSED', type: 'concern', category: 'rotation',
    evaluate: t => {
      const underused = t.players.filter(p => {
        const target = Math.min(32, p.minuteCeiling ?? 32);
        return (p.tal ?? 0) >= 90 && p.minutes < target - 4;
      });
      return underused.length > 0
        ? hit(0.72, 0.88, teamConfidence(t), `${displayNames(underused)} are not receiving enough minutes for their talent tier, leaving elite value on the bench.`, { players: underused.map(p => p.playerName), values: { underusedStarCount: underused.length }, notes: underused.map(p => `${p.playerName}: ${p.minutes} min`) }, 0.94)
        : inactive;
    }
  },
  {
    // 2026-08-15, threshold raised 0.72->0.9 alongside `insightMapper.ts`'s divisor fix after the
    // old pair fired on 100% of 96 measured teams. In the active 9-man format this is intentionally
    // the "nearly the full roster receives 15+ minutes" signal; `DEAD_NINTH_SLOT_ACCEPTABLE`
    // separately recognizes a strong eight-man playoff rotation behind a cheap unused ninth slot.
    id: 'DEEP_PLAYOFF_ROTATION', type: 'strength', category: 'depth',
    suppressionGroup: 'rotation_positive',
    evaluate: t => {
      const s = t.deepRotationScore ?? 0;
      // Matches `insightMapper.ts`'s own `MEANINGFUL_ROTATION_MINUTES` bar (15) that
      // `deepRotationScore` is actually built from — kept in sync so the displayed count never
      // disagrees with the score it's explaining.
      const n = t.players.filter(p => p.minutes >= 15).length;
      return s >= 0.9
        ? hit(s, 0.76, teamConfidence(t), `${n} players project for meaningful playoff minutes, giving the roster credible functional depth.`, { values: { deepRotationScore: s, usefulPlayers: n } })
        : inactive;
    }
  },
  {
    // 2026-08-19, user's explicit ask ("look for ways to make around 7 strengths and concerns"):
    // 0.68 never fired across a real 48-team simulated sample (`scripts/_measureDeadConcernSignals.ts`,
    // deleted after use) — `topHeavyScore`'s own real max was 0.612, so this bar was structurally
    // unreachable, not just rare. Lowered to 0.38 (real p90), so this now flags the genuinely most
    // top-heavy tenth of rosters instead of a threshold no real roster could ever clear.
    id: 'TOP_HEAVY_ROTATION', type: 'concern', category: 'depth',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const s = t.topHeavyScore ?? 0;
      return s >= 0.38
        ? hit(s, 0.82, teamConfidence(t), 'Team quality falls sharply outside the primary core, making the rotation fragile when stars sit.', { values: { topHeavyScore: s, benchDropoffScore: t.benchDropoffScore ?? null } })
        : inactive;
    }
  },
  {
    id: 'ROLE_FLEXIBILITY_HIGH', type: 'strength', category: 'fit',
    suppressionGroup: 'rotation_positive',
    evaluate: t => {
      const s = t.roleFlexibilityScore ?? 0;
      return s >= 0.72
        ? hit(s, 0.72, teamConfidence(t), 'The roster supports several credible role configurations without creating a major structural weakness.', { values: { roleFlexibilityScore: s } })
        : inactive;
    }
  },
  {
    id: 'MATCHUP_SPECIALIST_AVAILABLE', type: 'strength', category: 'depth',
    suppressionGroup: 'rotation_positive',
    evaluate: t => {
      const specialists = t.bench.filter(p =>
        p.minutes >= 10 &&
        ((p.defensiveImpact ?? 0) >= 80 || (p.isSpacingArchetype && (p.tal ?? 100) <= 75)),
      );
      return specialists.length > 0
        ? hit(0.68, 0.72, teamConfidence(t), `${displayNames(specialists)} ${specialists.length === 1 ? 'gives' : 'give'} the bench a specialist option for matchup-specific defensive or spacing needs.`, { players: specialists.map(p => p.playerName), values: { specialistCount: specialists.length } }, 0.9)
        : inactive;
    }
  },
  {
    // 2026-08-19, user's explicit ask ("look for ways to make around 7 strengths and concerns"):
    // this compound gate almost never fired — `positionalCompromiseCount>=2` alone was already rare
    // (this session's earlier rotation-fit work made real compromises uncommon, a good outcome for
    // gameplay), so requiring it on TOP of a low flexibility score compounded two rare conditions.
    // Measured directly (`scripts/_measureDeadConcernSignals.ts`, 48 real teams, deleted after use):
    // `roleFlexibilityScore` real p25 is 0.222. Loosened the compromise co-requirement to >=1 (still
    // a real positional strain, just not requiring the much rarer >=2) and kept the flexibility bar
    // near its real p25 so the combination is reachable without becoming a universal firer.
    id: 'ROLE_FLEXIBILITY_LOW', type: 'concern', category: 'fit',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const flexibility = t.roleFlexibilityScore ?? 1;
      const compromises = t.positionalCompromiseCount ?? 0;
      return flexibility <= 0.23 && compromises >= 1
        ? hit(0.72, 0.78, teamConfidence(t), 'The roster has little positional flexibility, so injuries or matchup changes quickly force uncomfortable assignments.', { values: { roleFlexibilityScore: flexibility, positionalCompromiseCount: compromises } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'ELITE_TWO_WAY_CORE', type: 'strength', category: 'two_way',
    evaluate: t => {
      const twoWay = t.starters
        .filter(p => (p.offensiveImpact ?? 0) >= 75 && (p.defensiveImpact ?? 0) >= 75)
        .sort((a, b) => (b.overallImpact ?? 0) - (a.overallImpact ?? 0));
      return twoWay.length >= 2
        ? hit(0.76 + twoWay.length * 0.06, 0.94, teamConfidence(t), `${displayNames(twoWay)} form an elite two-way core that does not require offense-defense substitutions.`, { players: twoWay.map(p => p.playerName), values: { eliteTwoWayCount: twoWay.length } }, 0.98)
        : inactive;
    }
  },
  {
    id: 'STAR_POWER_WITHOUT_USAGE_COLLISION', type: 'strength', category: 'cross',
    evaluate: t => {
      const stars = t.players.filter(p => (p.tal ?? 0) >= 85 && p.minutes >= 24);
      const overlap = t.usageOverlapScore ?? 0;
      const compression = t.fgaCompressionScore ?? 0;
      return stars.length >= 2 && overlap <= 0.50 && compression < 0.55
        ? hit(0.78, 0.92, teamConfidence(t), `${displayNames(stars)} provide star-level talent without forcing severe on-ball or shot overlap.`, { players: stars.map(p => p.playerName), values: { starCount: stars.length, usageOverlapScore: overlap, fgaCompressionScore: compression } }, 0.96)
        : inactive;
    }
  },
  {
    id: 'HIGH_VALUE_ROLE_PLAYERS', type: 'strength', category: 'depth',
    evaluate: t => {
      const rolePlayers = t.bench
        .filter(p => (p.tal ?? 0) >= 68 && p.fga <= 12 && (p.highUsageWeight ?? 0) <= 0.25 && p.minutes >= 15)
        .sort((a, b) => (b.tal ?? 0) - (a.tal ?? 0));
      return rolePlayers.length >= 2
        ? hit(0.74, 0.84, teamConfidence(t), `${displayNames(rolePlayers)} supply useful bench impact at a manageable shot and usage cost.`, { players: rolePlayers.map(p => p.playerName), values: { highValueRolePlayerCount: rolePlayers.length } }, 0.92)
        : inactive;
    }
  },
  {
    id: 'NO_MAJOR_STRUCTURAL_HOLE', type: 'strength', category: 'cross',
    evaluate: t => {
      const sound =
        (t.creatorCount ?? 0) >= 2 &&
        (t.starterSpacingStrength ?? 0) >= 0.55 &&
        (t.starterNonSpacerCount ?? 0) <= 1 &&
        (t.defensiveLayeringScore ?? 0) >= 0.60 &&
        // 2026-09-17, contradiction audit: was `>= 0.50`, a real overlapping window against
        // WEAK_STARTING_REBOUNDING's own `<= 0.62` concern threshold — confirmed live at
        // starterReboundingScore=0.55, both fired for the same roster. Now shares that detector's
        // exact threshold so "clears every checkpoint" can never claim rebounding is fine while the
        // dedicated rebounding concern calls the same number vulnerable.
        (t.starterReboundingScore ?? 0) > WEAK_STARTING_REBOUNDING_THRESHOLD &&
        (t.defensiveWeakLinkCount ?? 0) <= 1 &&
        (t.positionalCompromiseCount ?? 0) <= 1;
      return sound
        ? hit(0.80, 0.90, teamConfidence(t), 'The roster clears every major structural checkpoint: creation, spacing, defensive layers, rebounding and positional coverage.', { values: { creatorCount: t.creatorCount ?? 0, starterSpacingStrength: t.starterSpacingStrength ?? 0, defensiveLayeringScore: t.defensiveLayeringScore ?? 0, starterReboundingScore: t.starterReboundingScore ?? 0 } }, 0.98)
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_STRUCTURAL_HOLES', type: 'concern', category: 'cross',
    evaluate: t => {
      const holes: string[] = [];
      if ((t.creatorCount ?? 0) === 0) holes.push('creation');
      if ((t.starterSpacingStrength ?? 1) <= 0.42) holes.push('spacing');
      if ((t.defensiveLayeringScore ?? 1) <= 0.42) holes.push('defensive structure');
      if ((t.starterReboundingScore ?? 1) <= 0.40) holes.push('rebounding');
      if ((t.positionalCompromiseCount ?? 0) >= 3) holes.push('positional coverage');
      return holes.length >= 2
        ? hit(0.62 + holes.length * 0.10, 0.96, teamConfidence(t), `Multiple structural holes at once: ${holes.join(', ')}.`, { values: { structuralHoleCount: holes.length }, notes: holes }, 0.98)
        : inactive;
    }
  },
  {
    id: 'GOOD_SPACING_BUT_ONE_NONSHOOTER_BOTTLENECK', type: 'concern', category: 'cross',
    evaluate: t => {
      const nonShooters = t.starters.filter(p => !p.isSpacingArchetype);
      const shooters = t.starterPlusShooterCount ?? 0;
      return shooters >= 4 && nonShooters.length === 1
        ? hit(0.64, 0.83, teamConfidence(t), `${nonShooters[0].playerName} is the lone starting non-shooter, giving opponents one clear place to help off the floor.`, { players: [nonShooters[0].playerName], values: { starterPlusShooterCount: shooters, starterNonSpacerCount: 1 } }, 0.92)
        : inactive;
    }
  },
  {
    id: 'DEFENSE_AT_COST_OF_SPACING', type: 'concern', category: 'cross',
    evaluate: t => {
      const d = t.defensiveLayeringScore ?? 0;
      const s = t.starterSpacingStrength ?? 1;
      return d >= 0.72 && s <= 0.45
        ? hit((d + (1 - s)) / 2, 0.94, teamConfidence(t), 'The strongest defensive configurations come with a meaningful spacing trade-off.', { values: { defensiveLayeringScore: d, starterSpacingStrength: s } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'ELITE_DEFENSE_LOW_FGA_COST', type: 'strength', category: 'cross',
    evaluate: t => {
      const d = t.defensiveLayeringScore ?? 0;
      const f = t.fgaEfficiencyScore ?? 0;
      const c = t.lowUsageComplementCount ?? 0;
      return d >= 0.78 && f >= 0.68 && c >= 2
        ? hit((d + f) / 2, 0.92, teamConfidence(t), 'The roster gets elite defensive value from several low-shot players, preserving shots for its offensive engines.', { values: { defensiveLayeringScore: d, fgaEfficiencyScore: f, lowUsageComplementCount: c } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'STAR_POWER_WITH_USAGE_COLLISION', type: 'concern', category: 'cross',
    suppresses: ['MULTIPLE_HIGH_USAGE_PLAYERS', 'SEVERE_USAGE_COLLISION', 'STAR_FGA_COMPRESSION', 'OFFENSIVE_ROLE_REDUNDANCY'],
    evaluate: t => {
      const overlap = t.usageOverlapScore ?? 0;
      const compression = t.fgaCompressionScore ?? 0;
      const stars = t.players.filter(p => (p.tal ?? 0) >= 85 && p.minutes >= 24);
      return stars.length >= 3 && Math.max(overlap, compression) >= 0.65
        ? hit(Math.max(overlap, compression), 0.96, teamConfidence(t), `${displayNames(stars)} provide major star power, but their combined shot volume and on-ball demand create a difficult resource-allocation problem.`, { players: stars.map(p => p.playerName), values: { usageOverlapScore: overlap, fgaCompressionScore: compression } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'GREAT_STARTERS_WEAK_BENCH', type: 'concern', category: 'cross',
    evaluate: t => {
      const drop = t.benchDropoffScore ?? 0;
      const mins = t.starters.reduce((s, p) => s + p.minutes, 0);
      const tal = t.starters.reduce((s, p) => s + (p.tal ?? 0) * p.minutes, 0) / Math.max(1, mins);
      return tal >= 78 && drop >= 0.62
        ? hit(drop, 0.90, teamConfidence(t), 'The starting group is strong, but team quality drops materially when the bench enters.', { values: { weightedStarterTal: tal, benchDropoffScore: drop } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'RIM_PROTECTION_BUT_POOR_PERIMETER_DEFENSE', type: 'concern', category: 'cross',
    evaluate: t => {
      const r = t.rimProtectionScore ?? 0;
      const p = t.perimeterDefenseScore ?? 1;
      return r >= 0.72 && p <= 0.42
        ? hit((r + (1 - p)) / 2, 0.90, teamConfidence(t), 'Strong rim protection is forced to cover for weak perimeter containment.', { values: { rimProtectionScore: r, perimeterDefenseScore: p } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'PERIMETER_DEFENSE_BUT_NO_RIM_PROTECTION', type: 'concern', category: 'cross',
    evaluate: t => {
      const p = t.perimeterDefenseScore ?? 0;
      const r = t.rimProtectionScore ?? 1;
      return p >= 0.72 && r <= 0.40
        ? hit((p + (1 - r)) / 2, 0.90, teamConfidence(t), 'Strong perimeter defense lacks reliable back-line rim protection behind it.', { values: { perimeterDefenseScore: p, rimProtectionScore: r } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'ELITE_CREATION_POOR_SPACING', type: 'concern', category: 'cross',
    evaluate: t => {
      const c = t.creatorCount ?? 0;
      const s = t.starterSpacingStrength ?? 1;
      return c >= 2 && s <= 0.42
        ? hit(0.58 + (1 - s) * 0.32, 0.94, teamConfidence(t), 'The roster has strong creation talent, but limited spacing may reduce how efficiently that creation converts into team offense.', { values: { creatorCount: c, starterSpacingStrength: s } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'ELITE_SPACING_WEAK_CREATION', type: 'concern', category: 'cross',
    evaluate: t => {
      const s = t.starterSpacingStrength ?? 0;
      // `creatorCount` is rotation-wide now (insightMapper.ts, 2026-08-16 fix — a real bench
      // creator like Chauncey Billups or Tyrese Haliburton used to be invisible to this check
      // entirely, so a roster with 3 real creators split starters/bench could still read as
      // "may lack enough advantage creation"), so this concern now correctly means the WHOLE
      // roster is thin on creation, not just the starting five.
      const c = t.creatorCount ?? 0;
      // Same MULTIPLE_NON_SPACERS contradiction guard as the two positive spacing detectors
      // above — "excellent spacing" shouldn't fire in the same breath as "N starters are
      // non-spacers."
      const nonSpacers = t.starterNonSpacerCount ?? 0;
      return s >= 0.75 && c <= 1 && nonSpacers <= 1
        ? hit(0.58 + s * 0.28, 0.90, teamConfidence(t), 'The roster has excellent spacing but may lack enough advantage creation to fully exploit it.', { values: { starterSpacingStrength: s, creatorCount: c, starterNonSpacerCount: nonSpacers } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'LOW_FGA_HIGH_IMPACT_CONSTRUCTION', type: 'strength', category: 'cross',
    suppresses: ['EFFICIENT_FGA_BUDGET', 'HIGH_TALENT_PER_FGA'],
    evaluate: t => {
      const f = t.fgaEfficiencyScore ?? 0;
      const n = t.netRatingProjection ?? 0;
      return f >= 0.78 && n >= 3
        ? hit(0.60 + f * 0.35, 0.96, teamConfidence(t), 'The roster creates unusually high projected team impact without overspending its shot budget.', { values: { fgaEfficiencyScore: f, netRatingProjection: n, totalFga: t.totalFga } }, 0.98)
        : inactive;
    }
  },
  {
    id: 'STRONG_CORE_FRAGILE_ROTATION', type: 'concern', category: 'cross',
    evaluate: t => {
      const top = t.topHeavyScore ?? 0;
      const deep = t.deepRotationScore ?? 1;
      return top >= 0.65 && deep <= 0.45
        ? hit((top + (1 - deep)) / 2, 0.88, teamConfidence(t), 'The core is strong, but the overall playoff rotation is fragile outside its best lineups.', { values: { topHeavyScore: top, deepRotationScore: deep } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_PATHS_TO_VIABLE_LINEUP', type: 'strength', category: 'cross',
    evaluate: t => {
      const f = t.roleFlexibilityScore ?? 0;
      const d = t.deepRotationScore ?? 0;
      const def = t.defensiveLayeringScore ?? 0;
      const sp = t.spacingStrength ?? 0;
      return f >= 0.70 && d >= 0.62 && Math.min(def, sp) >= 0.55
        ? hit((f + d + def + sp) / 4, 0.84, teamConfidence(t), 'The roster supports multiple viable lineup constructions rather than depending on one specific five-man unit.', { values: { roleFlexibilityScore: f, deepRotationScore: d, defensiveLayeringScore: def, spacingStrength: sp } }, 0.98)
        : inactive;
    }
  },
  {
    id: 'MOVEMENT_SHOOTING_GRAVITY', type: 'strength', category: 'spacing',
    evaluate: t => {
      const strength = t.movementShootingStrength ?? 0;
      const minutes = t.movementShooterMinutes ?? 0;
      const names = t.movementShooterNames ?? [];
      const movementPlayers = t.players.filter((player) => names.includes(player.playerName));
      const evidenceConfidence = Math.max(
        0,
        ...movementPlayers.map((player) => player.movementShootingConfidence ?? 0),
      );
      return strength >= TEAM_MODEL_THRESHOLDS.movementShooting &&
        minutes >= TEAM_MODEL_THRESHOLDS.movementMinutes
        ? hit(
          strength,
          0.90,
          Math.min(teamConfidence(t), evidenceConfidence),
          `${displayNameList(names)} supplies real movement-shooting gravity without requiring extra on-ball possessions.`,
          {
            players: names,
            values: { movementShootingStrength: strength, movementShooterMinutes: minutes },
            notes: movementPlayers.flatMap((player) => player.movementShootingEvidence ? [player.movementShootingEvidence] : []),
          },
          0.97,
        )
        : inactive;
    }
  },
  {
    id: 'SPACING_WITH_TWO_BIGS_VIABLE', type: 'strength', category: 'spacing',
    evaluate: t => {
      const bigs = t.naturalBigStarterCount ?? 0;
      const frontcourtSpacing = t.frontcourtSpacingStrength ?? 0;
      const frontcourtSpacers = t.frontcourtSpacerCount ?? 0;
      const penalty = t.nonlinearNonSpacerPenalty ?? 1;
      const startersWhoSpace = t.starterPlusShooterCount ?? 0;
      return bigs >= 2 && frontcourtSpacers >= 1 && frontcourtSpacing >= 0.45 &&
        startersWhoSpace >= 3 && penalty <= 0.27
        ? hit(
          0.76,
          0.86,
          teamConfidence(t),
          'The two-big starting structure remains offensively viable because frontcourt shooting and perimeter spacing keep the paint open.',
          { values: { naturalBigStarterCount: bigs, frontcourtSpacerCount: frontcourtSpacers, frontcourtSpacingStrength: frontcourtSpacing, starterPlusShooterCount: startersWhoSpace, nonlinearNonSpacerPenalty: penalty } },
          0.96,
        )
        : inactive;
    }
  },
  {
    id: 'NON_SPACER_OVERLOAD', type: 'concern', category: 'spacing',
    suppresses: ['MULTIPLE_NON_SPACERS', 'LOW_STARTING_SPACING', 'NO_FRONTCOURT_SPACING'],
    evaluate: t => {
      const count = t.starterNonSpacerCount ?? 0;
      const penalty = t.nonlinearNonSpacerPenalty ?? 0;
      return count >= 2 && penalty >= 0.35
        ? hit(
          penalty,
          0.94,
          teamConfidence(t),
          `${count} starting non-spacers create a nonlinear paint-congestion problem that the roster's current gravity cannot sufficiently offset.`,
          { values: { starterNonSpacerCount: count, nonlinearNonSpacerPenalty: penalty, movementShootingStrength: t.movementShootingStrength ?? 0, frontcourtSpacingStrength: t.frontcourtSpacingStrength ?? 0 } },
          0.96,
        )
        : inactive;
    }
  },
  {
    id: 'DEFENSIVE_COVERAGE_CAPACITY_ELITE', type: 'strength', category: 'defensive_structure',
    suppresses: ['ELITE_DEFENSIVE_LAYERING', 'BALANCED_DEFENSIVE_COVERAGE'],
    evaluate: t => {
      const coverage = t.defensiveCoverageCapacity ?? 0;
      const confirmed = t.defensiveCoverageConfirmedLayers ?? 0;
      return coverage >= TEAM_MODEL_THRESHOLDS.eliteDefensiveCoverage && confirmed === 3
        ? hit(
          coverage,
          0.94,
          Math.min(teamConfidence(t), 0.82),
          'The starting five has confirmed point-of-attack, wing and rim coverage with credible switchability behind those layers.',
          { values: { defensiveCoverageCapacity: coverage, confirmedDefensiveLayers: confirmed, switchabilityScore: t.switchabilityScore ?? 0 }, notes: ['Help, post and screen-navigation inputs are not yet available and are not inferred.'] },
          0.98,
        )
        : inactive;
    }
  },
  {
    id: 'HUNTABLE_SPECIALIST_MITIGATED', type: 'strength', category: 'defensive_structure',
    evaluate: t => {
      const names = t.mitigatedSpecialistNames ?? [];
      const coverage = t.defensiveCoverageCapacity ?? 0;
      const mitigation = t.huntabilityMitigationScore ?? 0;
      return names.length > 0 && coverage >= 0.72 && mitigation >= 0.25
        ? hit(
          0.65,
          0.82,
          Math.min(teamConfidence(t), 0.80),
          `${displayNameList(names)} remains attackable, but limited bench minutes and strong defensive coverage reduce the playoff exposure.`,
          { players: names, values: { defensiveCoverageCapacity: coverage, huntabilityMitigationScore: mitigation, huntabilityExposureScore: t.huntabilityExposureScore ?? 0 } },
          0.97,
        )
        : inactive;
    }
  },
  {
    id: 'HUNTABLE_STARTER_EXPOSED', type: 'concern', category: 'defensive_structure',
    suppresses: ['MULTIPLE_DEFENSIVE_WEAK_LINKS', 'DEFENSIVE_WEAK_LINK'],
    evaluate: t => {
      const names = t.targetableStarterNames ?? [];
      const rotationTargets = t.targetableRotationNames ?? names;
      const exposure = t.huntabilityExposureScore ?? 0;
      return names.length > 0 && exposure >= 0.18
        ? hit(
          Math.max(exposure, 0.62),
          0.96,
          teamConfidence(t),
          `${displayNameList(names)} carries starter-level defensive exposure; ${displayNameList(rotationTargets)} account for ${t.defensiveTargetableMinutes ?? 0} targetable minutes across the rotation that coverage can reduce but not hide.`,
          { players: rotationTargets, values: { huntabilityExposureScore: exposure, huntabilityMitigationScore: t.huntabilityMitigationScore ?? 0, defensiveTargetableMinutes: t.defensiveTargetableMinutes ?? 0 } },
          0.98,
        )
        : inactive;
    }
  },
  {
    id: 'LOW_FGA_ROTATION_VALUE', type: 'strength', category: 'fga',
    evaluate: t => {
      const count = t.lowFgaImpactCount ?? 0;
      const names = t.lowFgaImpactPlayers ?? [];
      return count > 0
        ? hit(
          Math.min(0.88, 0.62 + 0.08 * count),
          0.88,
          teamConfidence(t),
          `${displayNameList(names)} supplies real rotation impact at eight or fewer shots, preserving scarce shot budget for higher-creation roles.`,
          { players: names, values: { lowFgaImpactCount: count, maxQualifyingFga: TEAM_MODEL_THRESHOLDS.lowFga, minimumQualifyingMinutes: TEAM_MODEL_THRESHOLDS.lowFgaMinutes } },
          0.96,
        )
        : inactive;
    }
  },
  {
    id: 'STAR_FGA_COST_JUSTIFIED', type: 'strength', category: 'fga',
    evaluate: t => {
      const stars = t.players
        .filter((player) =>
          player.fga >= TEAM_MODEL_THRESHOLDS.highFgaStar &&
          (player.offensiveImpact ?? 0) >= TEAM_MODEL_THRESHOLDS.eliteCreation &&
          (player.highUsageWeight ?? 0) >= 0.5 &&
          player.minutes >= 28
        )
        .sort((left, right) => (right.offensiveImpact ?? 0) - (left.offensiveImpact ?? 0));
      const depth = t.playoffRotationDepthScore ?? 0;
      const dropoff = t.benchDropoffScore ?? 1;
      return stars.length > 0 && t.totalFga <= CAP_LIMIT && depth >= 1 && dropoff <= 0.45
        ? hit(
          0.78,
          0.94,
          teamConfidence(t),
          `${stars[0].playerName}'s shot cost buys creation nobody else on the roster could replace — and there's still enough left for a real eight-man rotation.`,
          { players: [stars[0].playerName], values: { starFga: stars[0].fga, offensiveImpact: stars[0].offensiveImpact ?? 0, playoffRotationDepthScore: depth, benchDropoffScore: dropoff } },
          0.98,
        )
        : inactive;
    }
  },
  {
    id: 'STAR_FGA_COST_HURTS_DEPTH', type: 'concern', category: 'fga',
    evaluate: t => {
      const stars = t.players
        .filter((player) => player.fga >= TEAM_MODEL_THRESHOLDS.highFgaStar && player.minutes >= 28)
        .sort((left, right) => right.fga - left.fga);
      const depth = t.playoffRotationDepthScore ?? 1;
      const dropoff = t.benchDropoffScore ?? 0;
      const nearCap = t.totalFga >= 98;
      return stars.length > 0 && nearCap && (depth < 1 || dropoff >= 0.50)
        ? hit(
          Math.max(0.64, 1 - depth, dropoff),
          0.92,
          teamConfidence(t),
          `${stars[0].playerName}'s ${stars[0].fga.toFixed(1)} shot cost absorbs a large share of the cap while supporting quality falls sharply outside the primary core.`,
          { players: [stars[0].playerName], values: { starFga: stars[0].fga, totalFga: t.totalFga, playoffRotationDepthScore: depth, benchDropoffScore: dropoff } },
          0.96,
        )
        : inactive;
    }
  },
  {
    id: 'DEAD_NINTH_SLOT_ACCEPTABLE', type: 'strength', category: 'rotation',
    evaluate: t => {
      const dead = t.deadRosterSlotCount ?? 0;
      const names = t.deadRosterSlotPlayers ?? [];
      const robustEight = (t.meaningfulPlayoffPlayerCount ?? 0) >= TEAM_MODEL_THRESHOLDS.robustPlayoffRotationPlayers;
      const lowCost = (t.deadRosterSlotFga ?? Infinity) <= TEAM_MODEL_THRESHOLDS.deadSlotFga;
      const structurallySound = (t.severePositionalCompromiseCount ?? 0) === 0 && (t.minutesCeilingViolationCount ?? 0) === 0;
      return t.players.length === 9 && dead === 1 && robustEight && lowCost && structurallySound
        ? hit(
          0.68,
          0.80,
          teamConfidence(t),
          `${displayNameList(names)} can remain outside the playoff rotation without damage: eight other players cover meaningful minutes and the ninth slot consumes few shots.`,
          { players: names, values: { deadRosterSlotCount: dead, deadRosterSlotFga: t.deadRosterSlotFga ?? 0, meaningfulPlayoffPlayerCount: t.meaningfulPlayoffPlayerCount ?? 0 } },
          0.98,
        )
        : inactive;
    }
  },
  {
    id: 'DEAD_SLOT_HURTS_ROTATION', type: 'concern', category: 'rotation',
    evaluate: t => {
      const dead = t.deadRosterSlotCount ?? 0;
      const names = t.deadRosterSlotPlayers ?? [];
      const meaningful = t.meaningfulPlayoffPlayerCount ?? 0;
      const expensiveDeadSlot = (t.deadRosterSlotFga ?? 0) > TEAM_MODEL_THRESHOLDS.deadSlotFga;
      const strained = meaningful < TEAM_MODEL_THRESHOLDS.robustPlayoffRotationPlayers ||
        (t.severePositionalCompromiseCount ?? 0) > 0 ||
        (t.minutesCeilingViolationCount ?? 0) > 0;
      const message = expensiveDeadSlot && !strained
        ? `${displayNameList(names)} uses ${(t.deadRosterSlotFga ?? 0).toFixed(1)} shots without a playoff rotation role, an avoidable resource cost even behind a functional eight-man group.`
        : `${displayNameList(names)} is effectively outside the rotation while the remaining roster still lacks a clean, robust eight-man playoff structure.`;
      return t.players.length === 9 && dead > 0 && (expensiveDeadSlot || strained)
        ? hit(
          0.72,
          0.88,
          teamConfidence(t),
          message,
          { players: names, values: { deadRosterSlotCount: dead, deadRosterSlotFga: t.deadRosterSlotFga ?? 0, meaningfulPlayoffPlayerCount: meaningful, severePositionalCompromiseCount: t.severePositionalCompromiseCount ?? 0, minutesCeilingViolationCount: t.minutesCeilingViolationCount ?? 0 } },
          0.98,
        )
        : inactive;
    }
  },
  {
    id: 'CLOSING_FIVE_STABLE', type: 'strength', category: 'rotation',
    evaluate: t => {
      const c = t.closingLineups;
      if (!c) return inactive;
      const overlap = c.offenseDefensePersonnelOverlap;
      const cheapTradeoff = c.balancedOffenseTradeoff <= 0.12 && c.balancedDefenseTradeoff <= 0.12;
      return overlap >= 4 && cheapTradeoff && c.balanced.score >= 0.55
        ? hit(
          c.balanced.score,
          0.80,
          teamConfidence(t),
          `${displayNames(t.players.filter(p => c.balanced.players.some(bp => bp.playerId === p.playerId)))} close games as effectively together as any specialized grouping the roster could field — there is no real offense-vs-defense five-man tradeoff to make.`,
          { players: c.balanced.players.map(p => p.playerName), values: { offenseDefensePersonnelOverlap: overlap, balancedOffenseTradeoff: c.balancedOffenseTradeoff, balancedDefenseTradeoff: c.balancedDefenseTradeoff, balancedScore: c.balanced.score } },
          0.9,
        )
        : inactive;
    }
  },
  {
    id: 'CLOSING_FIVE_REQUIRES_TRADEOFF', type: 'concern', category: 'rotation',
    evaluate: t => {
      const c = t.closingLineups;
      if (!c) return inactive;
      // 2026-08-30, measured directly (`scripts/testClosingLineups.ts`, real drafted-style
      // fixtures): even a roster deliberately built from real offense-only/defense-only
      // specialists at the same positions (Barros/Korver vs Ward/Sefolosha/Roberson) only reaches
      // a ~0.14 tradeoff, because a real nine-man roster generally CAN field a competent five
      // either way — that's the format working as intended, not a measurement error. After the
      // shared role-minute model landed, the same real two-big fixture measures 0.113. A 0.11 bar
      // keeps that material two-player closing choice visible; mutual exclusion remains structural
      // because this concern requires overlap <4 while `CLOSING_FIVE_STABLE` requires overlap >=4.
      const meaningfulTradeoff = c.balancedOffenseTradeoff >= 0.11 || c.balancedDefenseTradeoff >= 0.11;
      if (c.offenseDefensePersonnelOverlap >= 4 || !meaningfulTradeoff) return inactive;
      const offenseOnly = c.offense.players.filter(p => !c.defense.players.some(dp => dp.playerId === p.playerId));
      const defenseOnly = c.defense.players.filter(p => !c.offense.players.some(op => op.playerId === p.playerId));
      const costsOffense = c.balancedOffenseTradeoff >= c.balancedDefenseTradeoff;
      return hit(
        Math.max(c.balancedOffenseTradeoff, c.balancedDefenseTradeoff),
        0.78,
        teamConfidence(t),
        `There is a real closing-lineup choice to make: the best offensive five (${displayNameList(offenseOnly.map(p => p.playerName))} over the defensive alternative) and the best defensive five (${displayNameList(defenseOnly.map(p => p.playerName))} instead) only share ${c.offenseDefensePersonnelOverlap} of 5 players, and the balanced compromise gives up meaningful ${costsOffense ? 'offense' : 'defense'} to hold both ends together.`,
        { players: [...offenseOnly, ...defenseOnly].map(p => p.playerName), values: { offenseDefensePersonnelOverlap: c.offenseDefensePersonnelOverlap, balancedOffenseTradeoff: c.balancedOffenseTradeoff, balancedDefenseTradeoff: c.balancedDefenseTradeoff } },
        0.85,
      );
    }
  },
];

function materialize(d: RosterInsightDetector, r: DetectorResult): RosterInsight {
  const severity = r.severity ?? 0.5;
  const relevance = r.relevance ?? 0.5;
  const confidence = r.confidence ?? 0.5;
  const uniqueness = r.uniqueness ?? 0.8;
  return {
    id: d.id, type: d.type, category: d.category,
    severity, relevance, confidence, uniqueness,
    score: scoreInsight(severity, relevance, confidence, uniqueness),
    message: r.message ?? d.id,
    evidence: r.evidence ?? {},
    suppressionGroup: d.suppressionGroup,
    suppresses: d.suppresses,
  };
}

function applyExplicitSuppression(items: RosterInsight[]): RosterInsight[] {
  const suppressed = new Set<DetectorId>();
  for (const i of items) {
    for (const id of [...(EXPLICIT_SUPPRESSION[i.id] ?? []), ...(i.suppresses ?? [])]) {
      suppressed.add(id);
    }
  }
  return items.filter(i => !suppressed.has(i.id));
}

function dedupeGroups(items: RosterInsight[]): RosterInsight[] {
  const grouped = new Map<string, RosterInsight[]>();
  const free: RosterInsight[] = [];
  for (const i of items) {
    if (!i.suppressionGroup) { free.push(i); continue; }
    const arr = grouped.get(i.suppressionGroup) ?? [];
    arr.push(i);
    grouped.set(i.suppressionGroup, arr);
  }
  const winners = [...grouped.values()].map(g => g.sort((a, b) => b.score - a.score)[0]);
  return [...free, ...winners];
}

export interface InsightEngineOutput {
  strengths: RosterInsight[];
  concerns: RosterInsight[];
  allActiveInsights: RosterInsight[];
}

export function generateRosterInsights(
  team: TeamFeatureSnapshot,
  config = DEFAULT_INSIGHT_CONFIG,
): InsightEngineOutput {
  const raw = DETECTORS
    .map(d => {
      const r = d.evaluate(team);
      return r.active ? materialize(d, r) : null;
    })
    .filter((x): x is RosterInsight => x !== null);

  const ranked = dedupeGroups(applyExplicitSuppression(raw))
    .sort((a, b) => b.score - a.score);

  const eligible = ranked.filter(i => i.score >= config.minScore);
  const strengths = eligible.filter(i => i.type === 'strength').slice(0, config.maxPerSide);
  const concerns = eligible.filter(i => i.type === 'concern').slice(0, config.maxPerSide);

  return { strengths, concerns, allActiveInsights: ranked };
}

export function toInsightDebugRows(output: InsightEngineOutput) {
  return output.allActiveInsights.map(i => ({
    id: i.id,
    type: i.type,
    score: Number(i.score.toFixed(3)),
    severity: Number(i.severity.toFixed(3)),
    relevance: Number(i.relevance.toFixed(3)),
    confidence: Number(i.confidence.toFixed(3)),
    message: i.message,
    evidence: i.evidence,
  }));
}
