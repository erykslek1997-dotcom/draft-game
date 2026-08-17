import type { OffensiveArchetype, DefensiveRole, Position } from '../data/schema';

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
 * - `WEAK_NINTH_MAN` removed entirely: this session also removed the 9th roster spot
 *   (`ROSTER_SIZE` 9→8, positions.ts) as the structural fix for the exact problem that detector
 *   named — a dedicated "the last bench spot is weak" insight no longer has a subject.
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

  teamOrbScore?: number;             // 0..1
  teamDrbScore?: number;             // 0..1
  starterReboundingScore?: number;   // 0..1

  positionalCompromiseCount?: number;
  severePositionalCompromiseCount?: number;
  minutesCeilingViolationCount?: number;
  deepRotationScore?: number;        // 0..1
  topHeavyScore?: number;            // 0..1
  roleFlexibilityScore?: number;     // 0..1
  benchDropoffScore?: number;        // 0..1
  availabilityRisk?: number;         // 0..1
  uncertainty?: number;              // 0..1
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
  | 'MULTIPLE_PATHS_TO_VIABLE_LINEUP';

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
  creation_negative: ['CREATION_SHORTAGE', 'SINGLE_CREATOR_DEPENDENCY', 'BENCH_CREATION_SHORTAGE'],
  usage_negative: ['MULTIPLE_HIGH_USAGE_PLAYERS', 'SEVERE_USAGE_COLLISION', 'STAR_FGA_COMPRESSION', 'UNDERUSED_OFFENSIVE_TALENT'],
  spacing_positive: ['ELITE_STARTING_SPACING', 'GOOD_STARTING_SPACING', 'SPACING_DISTRIBUTED', 'BENCH_SPACING', 'STRETCH_BIG_VALUE'],
  spacing_negative: ['LOW_STARTING_SPACING', 'MULTIPLE_NON_SPACERS', 'SPACING_CONCENTRATED', 'BENCH_SPACING_COLLAPSE', 'NO_FRONTCOURT_SPACING', 'ONE_CRITICAL_SHOOTER'],
  perimeter_positive: ['ELITE_PERIMETER_DEFENSE', 'MULTIPLE_PERIMETER_DEFENDERS', 'POA_DEFENDER_PRESENT', 'WING_STOPPER_PRESENT', 'PERIMETER_DEFENSE_BENCH_DEPTH'],
  perimeter_negative: ['NO_POA_DEFENDER', 'NO_WING_STOPPER'],
  rim_positive: ['ELITE_RIM_PROTECTION', 'RIM_PROTECTOR_PRESENT', 'MULTIPLE_RIM_PROTECTORS', 'RIM_PROTECTION_CONTINUITY'],
  rim_negative: ['NO_RIM_PROTECTOR', 'SINGLE_RIM_PROTECTOR_DEPENDENCY', 'BENCH_RIM_PROTECTION_COLLAPSE'],
  defense_positive: ['ELITE_DEFENSIVE_LAYERING', 'BALANCED_DEFENSIVE_COVERAGE', 'DEFENSE_SURVIVES_SUBSTITUTIONS'],
  defense_negative: ['DEFENSIVE_WEAK_LINK', 'MULTIPLE_DEFENSIVE_WEAK_LINKS', 'DEFENSE_DEPENDS_ON_STARTERS'],
  rotation_positive: ['NATURAL_POSITION_ROTATION', 'DEEP_PLAYOFF_ROTATION', 'MATCHUP_SPECIALIST_AVAILABLE', 'ROLE_FLEXIBILITY_HIGH'],
  rotation_negative: ['ONE_POSITIONAL_COMPROMISE', 'MULTIPLE_POSITIONAL_COMPROMISES', 'SEVERE_POSITIONAL_STRAIN', 'PLAYER_ABOVE_MINUTES_CEILING', 'MULTIPLE_MINUTES_CEILING_VIOLATIONS', 'TOP_HEAVY_ROTATION', 'ROLE_FLEXIBILITY_LOW'],
};

export const EXPLICIT_SUPPRESSION: Partial<Record<DetectorId, DetectorId[]>> = {
  SEVERE_USAGE_COLLISION: ['MULTIPLE_HIGH_USAGE_PLAYERS'],
  ELITE_STARTING_SPACING: ['GOOD_STARTING_SPACING'],
  ELITE_PERIMETER_DEFENSE: ['MULTIPLE_PERIMETER_DEFENDERS', 'POA_DEFENDER_PRESENT'],
  ELITE_RIM_PROTECTION: ['RIM_PROTECTOR_PRESENT', 'MULTIPLE_RIM_PROTECTORS'],
  ELITE_DEFENSIVE_LAYERING: ['POA_DEFENDER_PRESENT', 'RIM_PROTECTOR_PRESENT', 'BALANCED_DEFENSIVE_COVERAGE'],
  MULTIPLE_MINUTES_CEILING_VIOLATIONS: ['PLAYER_ABOVE_MINUTES_CEILING'],
  SEVERE_POSITIONAL_STRAIN: ['ONE_POSITIONAL_COMPROMISE', 'MULTIPLE_POSITIONAL_COMPROMISES'],
  MULTIPLE_DEFENSIVE_WEAK_LINKS: ['DEFENSIVE_WEAK_LINK'],
  STAR_POWER_WITH_USAGE_COLLISION: ['MULTIPLE_HIGH_USAGE_PLAYERS', 'OFFENSIVE_ROLE_REDUNDANCY'],
  LOW_FGA_HIGH_IMPACT_CONSTRUCTION: ['EFFICIENT_FGA_BUDGET', 'HIGH_TALENT_PER_FGA'],
};

export const DETECTORS: RosterInsightDetector[] = [
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
      if (s > 0.45 && n >= 2) return inactive;
      return hit(Math.max(1 - s, (3 - n) / 3), 0.95, teamConfidence(t), `Starting lineup has only ${n} credible plus shooter${n === 1 ? '' : 's'}, creating a spacing risk.`, { values: { starterSpacingStrength: s, starterPlusShooterCount: n } });
    }
  },
  {
    id: 'MULTIPLE_NON_SPACERS', type: 'concern', category: 'spacing',
    suppressionGroup: 'spacing_negative',
    evaluate: t => {
      const n = t.starterNonSpacerCount ?? 0;
      return n >= 2
        ? hit(0.55 + (n - 2) * 0.18, 0.92, teamConfidence(t), `${n} starters grade as non-spacers, increasing half-court congestion.`, { values: { starterNonSpacerCount: n } })
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
        ? hit(s, 0.90, teamConfidence(t), 'The roster uses the FGA budget efficiently, generating strong value per allocated shot.', { values: { fgaEfficiencyScore: s, totalFga: t.totalFga } })
        : inactive;
    }
  },
  {
    // 2026-08-15, threshold raised 3->5 (`scripts/_measureInsightRates.ts`, 96 real teams):
    // `HIGH_USAGE_ARCHETYPE_WEIGHT` only tags 4 of 12 offensive archetypes as "high usage," so on
    // an 8-man roster at least 3 non-ball-dominant complements was true of literally every team
    // (100% fire rate measured) — not a real differentiator. 5 (majority of an 8-man roster) still
    // clears comfortably for a genuinely complement-heavy build, without firing on everyone.
    id: 'LOW_USAGE_COMPLEMENTS', type: 'strength', category: 'fit',
    evaluate: t => {
      const n = t.lowUsageComplementCount ?? 0;
      return n >= 5
        ? hit(0.50 + n * 0.09, 0.82, teamConfidence(t), `${n} rotation players provide useful minutes without demanding star-level offensive volume.`, { values: { lowUsageComplementCount: n } })
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
    id: 'NO_POA_DEFENDER', type: 'concern', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_negative',
    evaluate: t => {
      const has = t.players.some(p => p.defensiveRole === 'Point of Attack' && p.minutes >= 18);
      return !has ? hit(0.72, 0.89, teamConfidence(t), 'The primary rotation lacks a clear point-of-attack defensive role.', { values: { hasPOADefender: false } }) : inactive;
    }
  },
  {
    id: 'ELITE_RIM_PROTECTION', type: 'strength', category: 'rim_protection',
    suppressionGroup: 'rim_positive', suppresses: ['RIM_PROTECTOR_PRESENT', 'MULTIPLE_RIM_PROTECTORS'],
    evaluate: t => {
      const s = t.rimProtectionScore ?? 0;
      return s >= 0.82
        ? hit(s, 0.95, teamConfidence(t), 'The roster has elite interior defensive coverage and reliable rim protection.', { values: { rimProtectionScore: s } })
        : inactive;
    }
  },
  {
    id: 'RIM_PROTECTION_CONTINUITY', type: 'strength', category: 'rim_protection',
    suppressionGroup: 'rim_positive',
    evaluate: t => {
      const ps = t.players.filter(p => p.isRimProtectorRole && p.minutes >= 10);
      return ps.length >= 2
        ? hit(0.60 + ps.length * 0.08, 0.85, teamConfidence(t), 'Rim protection survives center substitutions rather than depending on a single anchor.', { players: ps.map(p => p.playerName), values: { rimProtectorCount: ps.length } })
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
    suppressionGroup: 'defense_positive', suppresses: ['POA_DEFENDER_PRESENT', 'RIM_PROTECTOR_PRESENT', 'BALANCED_DEFENSIVE_COVERAGE'],
    evaluate: t => {
      const s = t.defensiveLayeringScore ?? 0;
      return s >= 0.82
        ? hit(s, 0.98, teamConfidence(t), 'Elite defensive layering: strong perimeter resistance is backed by reliable interior protection.', { values: { defensiveLayeringScore: s } })
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_DEFENSIVE_WEAK_LINKS', type: 'concern', category: 'defensive_structure',
    suppressionGroup: 'defense_negative', suppresses: ['DEFENSIVE_WEAK_LINK'],
    evaluate: t => {
      const n = t.defensiveWeakLinkCount ?? 0;
      return n >= 2
        ? hit(0.60 + n * 0.10, 0.94, teamConfidence(t), `${n} rotation spots grade as defensive weak links, increasing matchup-hunting risk.`, { values: { defensiveWeakLinkCount: n } })
        : inactive;
    }
  },
  {
    id: 'STRONG_STARTING_REBOUNDING', type: 'strength', category: 'rebounding',
    evaluate: t => {
      const s = t.starterReboundingScore ?? 0;
      return s >= 0.68
        ? hit(s, 0.80, teamConfidence(t), 'The starting five rebounds well enough to protect possessions without relying on one specialist.', { values: { starterReboundingScore: s } })
        : inactive;
    }
  },
  {
    id: 'WEAK_STARTING_REBOUNDING', type: 'concern', category: 'rebounding',
    evaluate: t => {
      const s = t.starterReboundingScore ?? 1;
      return s <= 0.40
        ? hit(1 - s, 0.82, teamConfidence(t), 'The starting group projects as vulnerable on the glass and may concede extra possessions.', { values: { starterReboundingScore: s } })
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_POSITIONAL_COMPROMISES', type: 'concern', category: 'position',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const n = t.positionalCompromiseCount ?? 0;
      return n >= 2
        ? hit(0.50 + n * 0.11, 0.86, teamConfidence(t), `${n} rotation assignments require players to operate outside their strongest natural positional fit.`, { values: { positionalCompromiseCount: n } })
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
    // 2026-08-15, threshold raised 0.72->0.9 alongside `insightMapper.ts`'s own divisor fix
    // (`/(STARTER_SLOTS.length+2)`=7, a leftover from ROSTER_SIZE=9, ->`/ROSTER_SIZE`=8) —
    // measured (`scripts/_measureInsightRates.ts`, 96 real teams) the old pair fired on 100% of
    // teams. 0.9 against the corrected /8 divisor requires essentially the full roster (7-8 of 8)
    // getting real minutes, which the same session's zero-minute-roster-spot diagnostic (~25% of
    // teams still have at least one dead spot) confirms is a genuine, non-universal bar.
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
    id: 'TOP_HEAVY_ROTATION', type: 'concern', category: 'depth',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const s = t.topHeavyScore ?? 0;
      return s >= 0.68
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
        ? hit((d + f) / 2, 0.92, teamConfidence(t), 'The roster gets elite defensive value from several low-FGA players, preserving shots for its offensive engines.', { values: { defensiveLayeringScore: d, fgaEfficiencyScore: f, lowUsageComplementCount: c } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'STAR_POWER_WITH_USAGE_COLLISION', type: 'concern', category: 'cross',
    suppresses: ['MULTIPLE_HIGH_USAGE_PLAYERS', 'OFFENSIVE_ROLE_REDUNDANCY'],
    evaluate: t => {
      const overlap = t.usageOverlapScore ?? 0;
      const compression = t.fgaCompressionScore ?? 0;
      const stars = t.players.filter(p => (p.tal ?? 0) >= 85 && p.minutes >= 24);
      return stars.length >= 3 && Math.max(overlap, compression) >= 0.65
        ? hit(Math.max(overlap, compression), 0.96, teamConfidence(t), 'The roster has major star power, but too much of that value competes for the same limited FGA and on-ball possessions.', { players: stars.map(p => p.playerName), values: { usageOverlapScore: overlap, fgaCompressionScore: compression } }, 0.95)
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
        ? hit(0.60 + f * 0.35, 0.96, teamConfidence(t), 'The roster creates unusually high projected team impact without overspending its FGA budget.', { values: { fgaEfficiencyScore: f, netRatingProjection: n, totalFga: t.totalFga } }, 0.98)
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
