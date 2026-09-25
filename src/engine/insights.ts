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
  // 2026-09-25 (descriptions part 2): real box-score lines so descriptions can name what a player
  // actually did (assists, steals, blocks, free throws) and when he played.
  ppg?: number;
  apg?: number;
  spg?: number;
  bpg?: number;
  ftPct?: number;
  /** First season of the span, e.g. 1966 for "1966-68". */
  startYear?: number;
  /** False before 1973-74, when the NBA started recording steals and blocks. */
  defensiveStatsTracked?: boolean;
  /** Every season of the span came before the 3-point line (1979-80). */
  playedBeforeThreePointLine?: boolean;
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
  | 'CLOSING_FIVE_STABLE' | 'CLOSING_FIVE_REQUIRES_TRADEOFF'
  | 'ELITE_FLOOR_GENERAL' | 'NO_TRUE_PLAYMAKER' | 'FREE_THROW_LIABILITY'
  | 'BALL_HAWKS' | 'SHOT_BLOCKING_ANCHOR' | 'NO_GO_TO_SCORER';

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

function huntableStarterMessage(starters: string[], others: string[], minutes: number): string {
  const lead = `${displayNameList(starters)} ${plural(starters, 'is a starter', 'are starters')} opponents will attack on defense`;
  return others.length > 0
    ? `${lead}; with ${displayNameList(others)} too, that's ${minutes} targetable minutes your teammates can only partly cover.`
    : `${lead} — ${minutes} targetable minutes your teammates can only partly cover.`;
}

/** The 3-point line arrived in 1979-80; a span that ended before it never had one to shoot from. */
function playedBeforeThreePointLine(p: PlayerTeamFeature): boolean {
  return p.playedBeforeThreePointLine === true;
}

/** " — X played before the 3-point line existed" for the named non-shooters it applies to, so a
 * 1960s guard isn't described as someone who simply can't shoot. */
function preThreePointNote(players: PlayerTeamFeature[]): string {
  const early = players.filter(playedBeforeThreePointLine);
  if (early.length === 0) return '';
  if (early.length === players.length && players.length > 1) return ' — none of them had a 3-point line to shoot from';
  return ` (${displayNames(early)} played before the 3-point line existed)`;
}

/** 2026-09-25, user-reported live ("Durant, Nash and Gobert are all stars who need the ball and a lot
 * of shots" — Gobert barely needs the ball, and Nash creates shots for others): a player only
 * competes for SHOTS if he actually takes a lot of them, plays a ball-dominant role, and isn't a
 * pass-first creator (lots of assists for his shot volume). */
function isPassFirst(p: PlayerTeamFeature): boolean {
  return (p.apg ?? 0) >= 7 && (p.apg ?? 0) >= p.fga * 0.5;
}
function isShotHungry(p: PlayerTeamFeature): boolean {
  return p.fga >= 16 && (p.highUsageWeight ?? 0) > 0 && !isPassFirst(p);
}
function shotHungryRotation(t: TeamFeatureSnapshot): PlayerTeamFeature[] {
  return t.players.filter(p => p.minutes >= 20 && isShotHungry(p)).sort((a, b) => b.fga - a.fga);
}

/** Cheap players who still give real value, best value first — for "bargain" strengths. */
function bargains(t: TeamFeatureSnapshot): PlayerTeamFeature[] {
  return t.players
    .filter(p => p.fga <= 10 && p.minutes >= 12 && (p.overallImpact ?? 0) >= 60)
    .sort((a, b) => (b.overallImpact ?? 0) / Math.max(b.fga, 2) - (a.overallImpact ?? 0) / Math.max(a.fga, 2));
}

function spacingConcentratedMessage(t: TeamFeatureSnapshot): string {
  const shooters = t.players.filter(p => p.isSpacingArchetype && p.minutes >= 12).sort((a, b) => b.minutes - a.minutes);
  if (shooters.length === 0) return 'Your outside shooting comes from just one or two players.';
  return `Your outside shooting comes down to ${displayNames(shooters.slice(0, 2))} — when ${plural(shooters.slice(0, 2), 'he sits', 'they sit')}, the paint fills up.`;
}

function nonSpacerOverloadMessage(t: TeamFeatureSnapshot, count: number): string {
  const nonShooters = t.starters.filter(p => !p.isSpacingArchetype);
  if (nonShooters.length === 0) return `${count} of your starters don't shoot from outside — defenses will pack the paint and your offense gets cramped.`;
  return `${displayNames(nonShooters, 4)} don't shoot from outside — defenses will pack the paint and your offense gets cramped${preThreePointNote(nonShooters)}.`;
}

function elitePerimeterMessage(t: TeamFeatureSnapshot): string {
  const defenders = t.players
    .filter(p => p.isPerimeterDefenderRole && p.minutes >= 15 && (p.defensiveImpact ?? 0) >= 60)
    .sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0));
  return defenders.length >= 2
    ? `Elite perimeter defense — ${displayNames(defenders)} can all take the other team's best scorer.`
    : "Elite perimeter defense — several players can guard the other team's best scorers.";
}

function eliteRimMessage(t: TeamFeatureSnapshot): string {
  const bigs = t.players
    .filter(p => p.isRimProtectorRole && p.minutes >= 12)
    .sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0));
  if (bigs.length === 0) return 'Elite rim protection — opponents will struggle to score inside.';
  const lead = bigs[0];
  const blocks = lead.defensiveStatsTracked !== false && (lead.bpg ?? 0) >= 1.5 ? ` (${(lead.bpg ?? 0).toFixed(1)} blocks a game)` : '';
  const partner = bigs[1] ? ` and ${bigs[1].playerName}` : '';
  return `Elite rim protection — ${lead.playerName}${blocks}${partner} make scoring inside a real struggle.`;
}

function bargainMessage(t: TeamFeatureSnapshot, fallback: string): string {
  const best = bargains(t).slice(0, 2);
  if (best.length === 0) return fallback;
  return `${fallback.replace(/\.$/, '')}: ${joinNames(best.map(capsText), 0)} ${plural(best, 'gives', 'give')} you real value for very little.`;
}

function weakBenchMessage(t: TeamFeatureSnapshot): string {
  const weakest = t.bench
    .filter(p => p.minutes >= 8)
    .sort((a, b) => (a.overallImpact ?? 0) - (b.overallImpact ?? 0))
    .slice(0, 2);
  return weakest.length > 0
    ? `Your starting five is strong, but the team drops off when ${displayNames(weakest)} ${plural(weakest, 'comes', 'come')} in.`
    : 'Your starting five is strong, but the team drops off when the bench comes in.';
}

function creatorsPoorSpacingMessage(t: TeamFeatureSnapshot): string {
  const creators = t.players
    .filter(p => (p.highUsageWeight ?? 0) >= 0.5 && p.minutes >= 24)
    .sort((a, b) => (b.offensiveImpact ?? 0) - (a.offensiveImpact ?? 0))
    .slice(0, 2);
  return creators.length > 0
    ? `${displayNames(creators)} can create ${plural(creators, 'his', 'their')} own shots, but poor spacing lets defenses load up on ${plural(creators, 'him', 'them')}.`
    : 'Great shot creators, but poor spacing makes their job harder.';
}

function capsText(p: PlayerTeamFeature): string {
  return `${p.playerName} (${Math.round(p.fga)} caps)`;
}

/** Names the bench players who don't shoot, so the concern says who drags the spacing down. */
function benchSpacingMessage(t: TeamFeatureSnapshot): string {
  const nonShooters = t.bench
    .filter(p => p.minutes >= 8 && !p.isSpacingArchetype)
    .sort((a, b) => b.minutes - a.minutes);
  return nonShooters.length > 0
    ? `Spacing falls apart when the bench comes in — ${displayNames(nonShooters, 3)} ${plural(nonShooters, "doesn't", "don't")} shoot from outside.`
    : 'Spacing falls apart when the bench comes in.';
}

// 2026-09-24, player-facing copy pass ("wejdź w rolę gracza"): lists read as English ("A, B and
// C", "A, B and 2 more") instead of comma dumps with a "+1 more" tail, and `plural` below keeps
// verbs in agreement ("Diop, Powell and Andersen are…", not "…is").
function joinNames(visible: string[], hidden: number): string {
  if (hidden > 0) return `${visible.join(', ')} and ${hidden} more`;
  if (visible.length <= 1) return visible.join('');
  return `${visible.slice(0, -1).join(', ')} and ${visible[visible.length - 1]}`;
}

function displayNames(players: { playerName: string }[], limit = 3): string {
  return displayNameList(players.map((player) => player.playerName), limit);
}

/** "A, B and 1 more" hides a name to save exactly one name — just show it. */
function displayNameList(names: string[], limit = 3): string {
  const shown = names.length === limit + 1 ? names.length : limit;
  return joinNames(names.slice(0, shown), Math.max(0, names.length - shown));
}

/** `one` for a single subject, `many` otherwise — `plural(names, 'is', 'are')`. */
function plural(subjects: readonly unknown[] | number, one: string, many: string): string {
  const n = typeof subjects === 'number' ? subjects : subjects.length;
  return n === 1 ? one : many;
}

/**
 * 2026-09-23, user-reported live: gating on the literal `defensiveRole` string permanently
 * excluded real point-of-attack defenders whose tag reads something else. Scottie Pippen is
 * tagged 'Wing Stopper' on every one of his 15 spans and primaryPosition SF, so the old
 * `roleFits` (Wing Stopper only counted at PG/SG) could never pass for him on any span — one of
 * the best perimeter defenders in the sport, structurally unable to register. Derrick White is a
 * separate gap: tagged 'Helper'/'Low Activity' on all 7 of his spans, never once landing on
 * 'Point of Attack'/'Chaser'/'Wing Stopper' despite a real D-TAL of 75-94 across every span — a
 * classifier-tag miss, not something a role-string gate could ever have caught.
 *
 * User's own rule: above a real defensive-talent bar, PG/SG/SF read as credible point-of-attack
 * defenders, and SG/SF (a position that plausibly switches both ball-handlers and wings) also
 * read as credible wing stoppers — driven by the number (`defensiveImpact`, i.e. D-TAL), not by
 * whichever single label the upstream role classifier happened to pick. Same `>= 60`/`>= 18
 * minutes` bar as before; verified directly against real D-TAL (White 75-94, Pippen mostly
 * 82-99) — both clear it on nearly every span.
 */
function isCrediblePoa(player: PlayerTeamFeature): boolean {
  const positionFits =
    player.primaryPosition === 'PG' || player.primaryPosition === 'SG' || player.primaryPosition === 'SF';
  return positionFits && (player.defensiveImpact ?? 0) >= 60 && player.minutes >= 18;
}

function isCredibleWingStopper(player: PlayerTeamFeature): boolean {
  const positionFits = player.primaryPosition === 'SG' || player.primaryPosition === 'SF';
  return positionFits && (player.defensiveImpact ?? 0) >= 60 && player.minutes >= 18;
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

/** 2026-09-25, user-reported live ("elite" on almost every team): in an all-time draft every roster
 * has stars, so the old bars fired on most of the field — ELITE_PRIMARY_CREATOR on 92% of 192
 * AI-drafted teams (12 seeded drafts), STRONG_STARTING_REBOUNDING 92%, DEFENSIVE_COVERAGE_CAPACITY_ELITE
 * 63%, ELITE_DEFENSIVE_LAYERING 76%. A strength only means something when it sets the team apart,
 * so each bar is now set where roughly the top quarter-to-third of that same sample clears it
 * (several of these inputs are capped at 1.0 / 100, so the top of the scale is where the real
 * separation lives). Measured values in the comments. */
const ELITE_BARS = {
  primaryCreatorImpact: 100, // 31% (was 82: 92%)
  starterRebounding: 0.99,   // 35% (was 0.68: 92%)
  defensiveCoverage: 0.90,   // 30% (was 0.82: 63%)
  defensiveLayering: 1.0,    // 27% (was 0.82: 76%)
  perimeterDefense: 0.9,     // 29% (was 0.80: 54%)
  rimProtection: 0.95,       // 42% (was 0.82: 51%; the input saturates, can't separate further)
  twoWayImpact: 80,          // 18% (was 75: 39%)
  lowUsageComplements: 6,    // 32% (was 5: 70%)
} as const;

export const DETECTORS: RosterInsightDetector[] = [
  {
    id: 'ELITE_PRIMARY_CREATOR', type: 'strength', category: 'creation',
    suppressionGroup: 'creation_positive',
    evaluate: t => {
      const creators = t.players
        .filter(p => (p.highUsageWeight ?? 0) >= 0.5 && p.minutes >= 24)
        .sort((a, b) => (b.offensiveImpact ?? 0) - (a.offensiveImpact ?? 0));
      const lead = creators[0];
      return lead && (lead.offensiveImpact ?? 0) >= ELITE_BARS.primaryCreatorImpact
        ? hit((lead.offensiveImpact ?? 0) / 100, 0.94, teamConfidence(t), `${lead.playerName} is an elite shot creator — he can get a good look out of almost any possession.`, { players: [lead.playerName], values: { offensiveImpact: lead.offensiveImpact ?? 0, minutes: lead.minutes } }, 0.95)
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
        ? hit(0.62 + creators.length * 0.07, 0.91, teamConfidence(t), `${displayNames(creators)} can all create their own shot, so the offense doesn't hinge on one player.`, { players: creators.map(p => p.playerName), values: { creatorCount: creators.length } }, 0.92)
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
        ? hit(0.66, 0.78, teamConfidence(t), `${displayNames(secondary)} can run the offense when your main creator is trapped or resting.`, { players: secondary.map(p => p.playerName), values: { secondaryCreatorCount: secondary.length } })
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
        ? hit(0.70, 0.87, teamConfidence(t), `${displayNames(benchCreators)} ${plural(benchCreators, 'keeps', 'keep')} the offense running when your starters sit.`, { players: benchCreators.map(p => p.playerName), values: { benchCreatorCount: benchCreators.length } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'CREATION_SHORTAGE', type: 'concern', category: 'creation',
    suppressionGroup: 'creation_negative',
    evaluate: t => (t.creatorCount ?? 0) === 0
      ? hit(0.92, 0.98, teamConfidence(t), 'Nobody can reliably create a shot on his own — the offense stalls once the first option is taken away.', { values: { creatorCount: 0 } }, 0.95)
      : inactive
  },
  {
    id: 'SINGLE_CREATOR_DEPENDENCY', type: 'concern', category: 'creation',
    suppressionGroup: 'creation_negative',
    evaluate: t => {
      const creators = t.players.filter(p => (p.highUsageWeight ?? 0) >= 1 && p.minutes >= 20);
      const otherCreation = t.players.filter(p => (p.highUsageWeight ?? 0) > 0 && !creators.includes(p) && p.minutes >= 15);
      return creators.length === 1 && otherCreation.length === 0
        ? hit(0.75, 0.92, teamConfidence(t), `The offense runs almost entirely through ${creators[0].playerName} — there's no real second ball handler behind him.`, { players: [creators[0].playerName], values: { creatorCount: 1 } }, 0.92)
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
        ? hit(s, 0.95, teamConfidence(t), `Your starting five spaces the floor beautifully — ${n} real outside shooters.`, { values: { starterSpacingStrength: s, starterPlusShooterCount: n, starterNonSpacerCount: nonSpacers } })
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
        ? hit(s, 0.88, teamConfidence(t), `Your starting five has decent spacing — ${n} real outside shooters.`, { values: { starterSpacingStrength: s, starterPlusShooterCount: n, starterNonSpacerCount: nonSpacers } })
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
      return hit(Math.max(1 - s, (3 - n) / 3), 0.95, teamConfidence(t), `Only ${n} real outside shooter${n === 1 ? '' : 's'} in the starting five — defenders can leave ${displayNames(nonShooters)} and crowd the paint.`, { players: nonShooters.map(p => p.playerName), values: { starterSpacingStrength: s, starterPlusShooterCount: n } });
    }
  },
  {
    id: 'MULTIPLE_NON_SPACERS', type: 'concern', category: 'spacing',
    suppressionGroup: 'spacing_negative',
    evaluate: t => {
      const n = t.starterNonSpacerCount ?? 0;
      // 2026-09-23, user-reported live (Curry-Pippen-Barkley five: SPACING badge 100, this
      // detector still fired "chujowy spacing"): missing the same shooting-anomaly contradiction
      // guard `LOW_STARTING_SPACING` above already has. That sibling reads `starterSpacingStrength`
      // (forced to 1 when a shooting-anomaly player like Curry is on the floor) and stays inactive
      // above 0.45 — this one only ever counted raw non-spacer headcount and had no such escape,
      // so it kept firing on the exact fives Curry's real gravity already covers for.
      const s = t.starterSpacingStrength ?? 1;
      if (s > 0.45) return inactive;
      const nonShooters = t.starters.filter(p => !p.isSpacingArchetype);
      return n >= 2
        ? hit(0.55 + (n - 2) * 0.18, 0.92, teamConfidence(t), `${displayNames(nonShooters)} don't shoot from outside, so defenders can leave them and crowd the paint${preThreePointNote(nonShooters)}.`, { players: nonShooters.map(p => p.playerName), values: { starterNonSpacerCount: n } })
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
        ? hit(0.5 + share * 0.45, 0.83, teamConfidence(t), spacingConcentratedMessage(t), { values: { topShooterMinuteShare: share, plusShooterCount: n } })
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
        ? hit(0.55 + drop * 0.65, 0.78, teamConfidence(t), benchSpacingMessage(t), { values: { starterSpacingStrength: a, benchSpacingStrength: b, drop } })
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
        ? hit(0.62 + n * 0.06, 0.86, teamConfidence(t), `${n} players in the rotation can really shoot, so spacing doesn't hang on one specialist.`, { values: { plusShooterCount: n, topShooterMinuteShare: share, starterNonSpacerCount: nonSpacers } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'BENCH_SPACING', type: 'strength', category: 'spacing',
    evaluate: t => {
      const shooters = t.bench.filter(p => p.isSpacingArchetype && p.minutes >= 12);
      const strength = t.benchSpacingStrength ?? 0;
      return strength >= 0.65 && shooters.length >= 2
        ? hit(strength, 0.76, teamConfidence(t), `${displayNames(shooters)} ${plural(shooters, 'keeps', 'keep')} the floor spaced when the bench comes in.`, { players: shooters.map(p => p.playerName), values: { benchSpacingStrength: strength, benchShooterCount: shooters.length } }, 0.88)
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
        ? hit(0.70, 0.84, teamConfidence(t), `${displayNames(bigs)} ${plural(bigs, 'is a big who shoots', 'are bigs who shoot')} from outside, pulling the other team's rim protector away from the basket.`, { players: bigs.map(p => p.playerName), values: { stretchBigCount: bigs.length } }, 0.92)
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
        ? hit(0.73, 0.88, teamConfidence(t), `Your starting bigs (${displayNames(frontcourt)}) don't shoot from outside, so the paint gets crowded${preThreePointNote(frontcourt)}.`, { players: frontcourt.map(p => p.playerName), values: { frontcourtSpacingCount: 0 } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'ONE_CRITICAL_SHOOTER', type: 'concern', category: 'spacing',
    suppressionGroup: 'spacing_negative',
    evaluate: t => {
      const shooters = t.players.filter(p => p.isSpacingArchetype && p.minutes >= 12);
      return shooters.length === 1 && (t.topShooterMinuteShare ?? 0) >= 0.45
        ? hit(0.78, 0.90, teamConfidence(t), `Your spacing depends on ${shooters[0].playerName} — without him on the floor, defenses can pack the paint.`, { players: [shooters[0].playerName], values: { plusShooterCount: 1, topShooterMinuteShare: t.topShooterMinuteShare ?? 0 } }, 0.94)
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_HIGH_USAGE_PLAYERS', type: 'concern', category: 'usage',
    suppressionGroup: 'usage_negative',
    evaluate: t => {
      const hungry = shotHungryRotation(t);
      const overlap = t.usageOverlapScore ?? 0;
      return hungry.length >= 3 && overlap >= 0.48
        ? hit(0.45 + overlap * 0.45, 0.93, teamConfidence(t), `${displayNames(hungry)} all want the ball and a lot of shots — there may not be enough to go around.`, { players: hungry.map(p => p.playerName), values: { highUsagePlayerCount: hungry.length, usageOverlapScore: overlap } })
        : inactive;
    }
  },
  {
    id: 'SEVERE_USAGE_COLLISION', type: 'concern', category: 'usage',
    suppressionGroup: 'usage_negative', suppresses: ['MULTIPLE_HIGH_USAGE_PLAYERS'],
    evaluate: t => {
      const hungry = shotHungryRotation(t);
      const overlap = t.usageOverlapScore ?? 0;
      return hungry.length >= 3 && overlap >= 0.75
        ? hit(overlap, 0.96, teamConfidence(t), `${displayNames(hungry)} all need the ball to score — they'll be fighting over the same possessions.`, { players: hungry.map(p => p.playerName), values: { highUsagePlayerCount: hungry.length, usageOverlapScore: overlap } })
        : inactive;
    }
  },
  {
    id: 'STAR_FGA_COMPRESSION', type: 'concern', category: 'fga',
    suppressionGroup: 'usage_negative',
    evaluate: t => {
      const c = t.fgaCompressionScore ?? 0;
      // 2026-09-17, "dodatkowe opisy" audit (user's own ask, after real playtester feedback about
      // the panel — measured which of the 86 detectors never fire on a real 160-roster sample):
      // 0.55 was more than double the real observed max (0.266, `scripts` diagnostic, deleted
      // after use) — `fgaCompressionScore` only ever reaches 1.0 in the extreme case a star's
      // drafted span is a TOTAL cap-forced downgrade from his own real peak FGA, which essentially
      // never happens under this game's real cap/pool. Lowered to just above the real p90 (0.221),
      // so this now flags the genuine top decile of cap-forced-down stars instead of a threshold
      // this field could never reach.
      return c >= 0.18
        ? hit(c, 0.94, teamConfidence(t), 'At least one of your best scorers will have to take far fewer shots than he did in real life.', { values: { fgaCompressionScore: c, totalFga: t.totalFga } })
        : inactive;
    }
  },
  {
    id: 'EFFICIENT_FGA_BUDGET', type: 'strength', category: 'fga',
    evaluate: t => {
      const s = t.fgaEfficiencyScore ?? 0;
      return s >= 0.70
        ? hit(s, 0.90, teamConfidence(t), bargainMessage(t, 'You got a lot for your caps — very little wasted.'), { values: { fgaEfficiencyScore: s, totalFga: t.totalFga } })
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
      return n >= ELITE_BARS.lowUsageComplements
        ? hit(0.50 + n * 0.09, 0.82, teamConfidence(t), `${n} players give you useful minutes without needing a lot of shots.`, { values: { lowUsageComplementCount: n } })
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
        ? hit(0.76, 0.87, teamConfidence(t), `${displayNames(offBall)} ${plural(offBall, 'does', 'do')} damage without the ball, so your creators and role players don't get in each other's way.`, { players: [...creators, ...offBall].map(p => p.playerName), values: { creatorCount: creators.length, offBallSupportCount: offBall.length } }, 0.94)
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
        ? hit(0.68 + support.length * 0.05, 0.80, teamConfidence(t), `${displayNames(support)} ${plural(support, 'helps', 'help')} with shooting, cutting or finishing without needing the ball.`, { players: support.map(p => p.playerName), values: { offBallSupportCount: support.length } }, 0.9)
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
        ? hit(0.72, 0.86, teamConfidence(t), `Plenty of finishers (${displayNames(finishers)}), but not enough players who can set them up.`, { players: finishers.map(p => p.playerName), values: { finisherCount: finishers.length, creatorCount: creators } }, 0.92)
        : inactive;
    }
  },
  {
    id: 'ELITE_PERIMETER_DEFENSE', type: 'strength', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_positive', suppresses: ['MULTIPLE_PERIMETER_DEFENDERS', 'POA_DEFENDER_PRESENT'],
    evaluate: t => {
      const s = t.perimeterDefenseScore ?? 0;
      const n = t.starterPerimeterDefenderCount ?? 0;
      return s >= ELITE_BARS.perimeterDefense && n >= 2
        ? hit(s, 0.94, teamConfidence(t), elitePerimeterMessage(t), { values: { perimeterDefenseScore: s, starterPerimeterDefenderCount: n } })
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
        ? hit(0.66 + defenders.length * 0.06, 0.86, teamConfidence(t), `${displayNames(defenders)} can all guard good perimeter scorers.`, { players: defenders.map(p => p.playerName), values: { perimeterDefenderCount: defenders.length } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'POA_DEFENDER_PRESENT', type: 'strength', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_positive',
    evaluate: t => {
      const defenders = t.players.filter(isCrediblePoa).sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0));
      return defenders.length > 0
        ? hit(0.70, 0.83, teamConfidence(t), `${defenders[0].playerName} can guard the other team's lead ball handler.`, { players: [defenders[0].playerName], values: { defensiveImpact: defenders[0].defensiveImpact ?? 0, minutes: defenders[0].minutes } }, 0.88)
        : inactive;
    }
  },
  {
    id: 'WING_STOPPER_PRESENT', type: 'strength', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_positive',
    evaluate: t => {
      const defenders = t.players.filter(isCredibleWingStopper).sort((a, b) => (b.defensiveImpact ?? 0) - (a.defensiveImpact ?? 0));
      return defenders.length > 0
        ? hit(0.70, 0.84, teamConfidence(t), `${defenders[0].playerName} can guard elite scoring wings.`, { players: [defenders[0].playerName], values: { defensiveImpact: defenders[0].defensiveImpact ?? 0, minutes: defenders[0].minutes } }, 0.9)
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
        ? hit(0.72, 0.78, teamConfidence(t), `${displayNames(defenders)} ${plural(defenders, 'keeps', 'keep')} the perimeter defense solid when the starters rest.`, { players: defenders.map(p => p.playerName), values: { benchPerimeterDefenderCount: defenders.length } }, 0.9)
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
      return !has ? hit(0.72, 0.89, teamConfidence(t), "Nobody in your rotation can really slow down the other team's lead ball handler.", { values: { hasPOADefender: false } }) : inactive;
    }
  },
  {
    id: 'NO_WING_STOPPER', type: 'concern', category: 'perimeter_defense',
    suppressionGroup: 'perimeter_negative',
    evaluate: t => !t.players.some(isCredibleWingStopper)
      ? hit(0.70, 0.88, teamConfidence(t), 'Nobody in your rotation can really guard elite scoring wings.', { values: { hasWingStopper: false } }, 0.9)
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
      return s >= ELITE_BARS.rimProtection && depth >= 2
        ? hit(s, 0.95, teamConfidence(t), eliteRimMessage(t), { values: { rimProtectionScore: s, rimProtectorCount: depth } })
        : inactive;
    }
  },
  {
    id: 'RIM_PROTECTION_CONTINUITY', type: 'strength', category: 'rim_protection',
    suppressionGroup: 'rim_positive',
    evaluate: t => {
      const ps = t.players.filter(p => p.isRimProtectorRole && p.minutes >= 10);
      return ps.length >= 2
        ? hit(0.60 + ps.length * 0.08, 0.85, teamConfidence(t), `${displayNames(ps)} give you more than one real rim protector, so the paint stays guarded when a big sits.`, { players: ps.map(p => p.playerName), values: { rimProtectorCount: ps.length } })
        : inactive;
    }
  },
  {
    id: 'NO_RIM_PROTECTOR', type: 'concern', category: 'rim_protection',
    suppressionGroup: 'rim_negative',
    evaluate: t => (t.rimProtectorCount ?? 0) === 0
      ? hit(0.86, 0.96, teamConfidence(t), 'No real rim protector in your playoff rotation.', { values: { rimProtectorCount: 0 } })
      : inactive
  },
  {
    id: 'SINGLE_RIM_PROTECTOR_DEPENDENCY', type: 'concern', category: 'rim_protection',
    suppressionGroup: 'rim_negative',
    evaluate: t => {
      const ps = t.players.filter(p => p.isRimProtectorRole && p.minutes >= 10);
      if (ps.length !== 1) return inactive;
      const p = ps[0];
      return hit(0.64, Math.min(1, p.minutes / 36), teamConfidence(t), `Your rim protection is all ${p.playerName} — when he sits, the paint opens up.`, { players: [p.playerName], values: { minutes: p.minutes } });
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
      return s >= ELITE_BARS.defensiveLayering
        ? hit(s, 0.98, teamConfidence(t), `${perimeter?.playerName ?? 'Strong perimeter defense'} out front and ${rim?.playerName ?? 'a real rim protector'} behind him make you very hard to score on.`, { players: [perimeter?.playerName, rim?.playerName].filter((name): name is string => Boolean(name)), values: { defensiveLayeringScore: s } })
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
        ? hit(layering, 0.86, teamConfidence(t), 'Solid perimeter defenders, a rim protector behind them, and few weak spots to attack.', { values: { defensiveLayeringScore: layering, defensiveWeakLinkCount: weakLinks } }, 0.9)
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
        ? hit(0.74, 0.82, teamConfidence(t), `${displayNames(benchDefenders)} ${plural(benchDefenders, 'keeps', 'keep')} the defense strong when the starters rest.`, { players: benchDefenders.map(p => p.playerName), values: { benchDefenderCount: benchDefenders.length, targetableMinutes: t.defensiveTargetableMinutes ?? 0 } }, 0.92)
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
        ? hit(0.55 + weak[0].minutes / 80, 0.91, teamConfidence(t), `${weak[0].playerName} is the weakest defender in your rotation (defense ${Math.round(weak[0].defensiveImpact)}, ${weak[0].minutes} min) — opponents will go right at him.`, { players: [weak[0].playerName], values: { defensiveTalent: weak[0].defensiveImpact, minutes: weak[0].minutes, targetableMinutes: t.defensiveTargetableMinutes ?? weak[0].minutes } }, 0.94)
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
        ? hit(0.60 + n * 0.10, 0.94, teamConfidence(t), `${displayNames(weak)} are defensive weak spots — opponents get ${t.defensiveTargetableMinutes ?? 0} targetable minutes to go after them.`, { players: weak.map(p => p.playerName), values: { defensiveWeakLinkCount: n, targetableMinutes: t.defensiveTargetableMinutes ?? 0 }, notes: weak.map(p => `${p.playerName}: D-TAL ${Math.round(p.defensiveImpact)}, ${p.minutes} min`) }, 0.96)
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
        ? hit(0.58 + targetMinutes / 160, 0.88, teamConfidence(t), `Your defense gets weaker when ${displayNames(benchTargets)} ${plural(benchTargets, 'comes', 'come')} off the bench (${targetMinutes} minutes).`, { players: benchTargets.map(p => p.playerName), values: { benchTargetableMinutes: targetMinutes } }, 0.94)
        : inactive;
    }
  },
  {
    id: 'STRONG_STARTING_REBOUNDING', type: 'strength', category: 'rebounding',
    evaluate: t => {
      const s = t.starterReboundingScore ?? 0;
      const rebounders = [...t.starters].sort((a, b) => (b.rpg ?? 0) - (a.rpg ?? 0)).slice(0, 2);
      return s >= ELITE_BARS.starterRebounding
        ? hit(s, 0.80, teamConfidence(t), `${displayNames(rebounders)} ${plural(rebounders, 'makes', 'make')} your starting five strong on the boards.`, { players: rebounders.map(p => p.playerName), values: { starterReboundingScore: s } })
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
        ? hit(1 - s, 0.82, teamConfidence(t), 'Your starting five is weak on the boards and will give up second chances.', { values: { starterReboundingScore: s } })
        : inactive;
    }
  },
  {
    id: 'NATURAL_POSITION_ROTATION', type: 'strength', category: 'position',
    suppressionGroup: 'rotation_positive',
    evaluate: t => (t.positionalCompromiseCount ?? 0) === 0
      ? hit(0.72, 0.77, teamConfidence(t), 'Everyone in the rotation plays a position he really played.', { values: { positionalCompromiseCount: 0 } }, 0.86)
      : inactive
  },
  {
    id: 'ONE_POSITIONAL_COMPROMISE', type: 'concern', category: 'position',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const compromised = t.players.filter(p => (p.naturalPositionFit ?? 1) < 0.95 && p.minutes > 0);
      return (t.positionalCompromiseCount ?? 0) === 1
        ? hit(0.58, 0.72, teamConfidence(t), `${t.positionalCompromisePlayers?.[0] ?? displayNames(compromised)} has to play out of position to fill the rotation.`, { players: t.positionalCompromisePlayers ?? compromised.map(p => p.playerName), values: { positionalCompromiseCount: 1 } }, 0.86)
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_POSITIONAL_COMPROMISES', type: 'concern', category: 'position',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const n = t.positionalCompromiseCount ?? 0;
      return n >= 2
        ? hit(0.50 + n * 0.11, 0.86, teamConfidence(t), `${n} rotation spots put ${t.positionalCompromisePlayers ? displayNameList(t.positionalCompromisePlayers) : 'several players'} out of position.`, { players: t.positionalCompromisePlayers, values: { positionalCompromiseCount: n } })
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
          ? `${names[0]} is playing far from his real position — that hurts the rotation a lot.`
          : `${displayNameList(names) || 'Several players'} are playing far from their real positions — that hurts the rotation a lot.`, { players: names, values: { severePositionalCompromiseCount: n } }, 0.96)
        : inactive;
    }
  },
  {
    id: 'PLAYER_ABOVE_MINUTES_CEILING', type: 'concern', category: 'rotation',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const over = t.players.filter(p => p.minuteCeiling != null && p.minutes > p.minuteCeiling);
      return over.length === 1
        ? hit(0.62 + (over[0].minutes - (over[0].minuteCeiling ?? over[0].minutes)) / 20, 0.86, teamConfidence(t), `${over[0].playerName} plays ${over[0].minutes} minutes but can only handle about ${over[0].minuteCeiling} — move some of those minutes to the bench.`, { players: [over[0].playerName], values: { minutes: over[0].minutes, minuteCeiling: over[0].minuteCeiling ?? 0 } }, 0.9)
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
        ? hit(0.55 + n * 0.10, 0.90, teamConfidence(t), `${joinNames(ps.slice(0, 3).map(p => `${p.playerName} (${p.minutes} of ${p.minuteCeiling} min)`), Math.max(0, ps.length - 3))} play more minutes than they can handle — move some of those minutes to the bench.`, { players: ps.map(p => p.playerName), values: { minutesCeilingViolationCount: n }, notes: ps.map(p => `${p.playerName}: ${p.minutes}/${p.minuteCeiling} min`) })
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
        ? hit(0.72, 0.88, teamConfidence(t), `${joinNames(underused.slice(0, 3).map(p => `${p.playerName} (${p.minutes} min)`), Math.max(0, underused.length - 3))} ${plural(underused, 'is', 'are')} good enough to play more — take minutes from a weaker backup.`, { players: underused.map(p => p.playerName), values: { underusedStarCount: underused.length }, notes: underused.map(p => `${p.playerName}: ${p.minutes} min`) }, 0.94)
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
      // 2026-09-17, "dodatkowe opisy" audit: `deepRotationScore` is a discrete `k/9` (k = players
      // clearing the 15-minute bar), so its real ceiling below a perfect 9/9 is 8/9 = 0.889 — 0.9
      // was one player short of ever being reachable (measured: real max across a 160-roster
      // sample was exactly 0.889, never 1.0). Lowered to 0.85, comfortably inside the 8/9 case this
      // was clearly meant to reward.
      return s >= 0.85
        ? hit(s, 0.76, teamConfidence(t), `${n} players are good enough for real playoff minutes — solid depth.`, { values: { deepRotationScore: s, usefulPlayers: n } })
        : inactive;
    }
  },
  {
    // 2026-08-19, user's explicit ask ("look for ways to make around 7 strengths and concerns"):
    // 0.68 never fired across a real 48-team simulated sample (`scripts/_measureDeadConcernSignals.ts`,
    // deleted after use) — `topHeavyScore`'s own real max was 0.612 at the time, so 0.38 (that
    // sample's real p90) was chosen to flag the genuinely most top-heavy tenth of rosters.
    // 2026-09-17: the same field's real distribution has since shifted (later talent/rotation
    // recalibrations) — a fresh 160-roster sample now tops out at 0.356, below the 2026-08-19 fix's
    // own 0.38 bar, making it unreachable again. Lowered to 0.30 (this sample's real p90/p95
    // boundary) — re-measure again if a future formula change shifts this field once more, the
    // same way this second pass caught the first fix going stale.
    id: 'TOP_HEAVY_ROTATION', type: 'concern', category: 'depth',
    suppressionGroup: 'rotation_negative',
    evaluate: t => {
      const s = t.topHeavyScore ?? 0;
      return s >= 0.30
        ? hit(s, 0.82, teamConfidence(t), 'The team drops off sharply whenever your stars sit.', { values: { topHeavyScore: s, benchDropoffScore: t.benchDropoffScore ?? null } })
        : inactive;
    }
  },
  {
    id: 'ROLE_FLEXIBILITY_HIGH', type: 'strength', category: 'fit',
    suppressionGroup: 'rotation_positive',
    evaluate: t => {
      const s = t.roleFlexibilityScore ?? 0;
      // 2026-09-17, "dodatkowe opisy" audit: `roleFlexibilityScore` averages each player's own
      // `roleFlexibility` (0/0.5/1 for 0/1/2 real secondary positions) — a real 160-roster sample
      // topped out at 0.50, well short of 0.72 (would need most of the roster carrying two
      // secondary positions each, essentially never true for real drafted spans). Lowered to 0.40,
      // just above the real p90 (0.389).
      return s >= 0.40
        ? hit(s, 0.72, teamConfidence(t), 'You can arrange this roster several ways without opening a big weakness.', { values: { roleFlexibilityScore: s } })
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
        ? hit(0.68, 0.72, teamConfidence(t), `${displayNames(specialists)} ${plural(specialists, 'gives', 'give')} you a bench specialist to bring in for the right matchup — defense or shooting.`, { players: specialists.map(p => p.playerName), values: { specialistCount: specialists.length } }, 0.9)
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
        ? hit(0.72, 0.78, teamConfidence(t), 'Few players can cover more than one position, so one injury or bad matchup forces awkward lineups.', { values: { roleFlexibilityScore: flexibility, positionalCompromiseCount: compromises } }, 0.9)
        : inactive;
    }
  },
  {
    id: 'ELITE_TWO_WAY_CORE', type: 'strength', category: 'two_way',
    evaluate: t => {
      const twoWay = t.starters
        .filter(p => (p.offensiveImpact ?? 0) >= ELITE_BARS.twoWayImpact && (p.defensiveImpact ?? 0) >= ELITE_BARS.twoWayImpact)
        .sort((a, b) => (b.overallImpact ?? 0) - (a.overallImpact ?? 0));
      return twoWay.length >= 2
        ? hit(0.76 + twoWay.length * 0.06, 0.94, teamConfidence(t), `${displayNames(twoWay)} ${plural(twoWay, 'is', 'are')} great at both ends — no need to sub for offense or defense.`, { players: twoWay.map(p => p.playerName), values: { eliteTwoWayCount: twoWay.length } }, 0.98)
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
        ? hit(0.78, 0.92, teamConfidence(t), `${displayNames(stars)} give you star talent without stepping on each other's toes.`, { players: stars.map(p => p.playerName), values: { starCount: stars.length, usageOverlapScore: overlap, fgaCompressionScore: compression } }, 0.96)
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
        ? hit(0.74, 0.84, teamConfidence(t), `${displayNames(rolePlayers)} ${plural(rolePlayers, 'adds', 'add')} useful bench minutes without needing many shots.`, { players: rolePlayers.map(p => p.playerName), values: { highValueRolePlayerCount: rolePlayers.length } }, 0.92)
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
        ? hit(0.80, 0.90, teamConfidence(t), 'No real weak spot: shot creation, spacing, defense, rebounding and positions are all covered.', { values: { creatorCount: t.creatorCount ?? 0, starterSpacingStrength: t.starterSpacingStrength ?? 0, defensiveLayeringScore: t.defensiveLayeringScore ?? 0, starterReboundingScore: t.starterReboundingScore ?? 0 } }, 0.98)
        : inactive;
    }
  },
  {
    id: 'MULTIPLE_STRUCTURAL_HOLES', type: 'concern', category: 'cross',
    evaluate: t => {
      const holes: string[] = [];
      // 2026-09-17, "dodatkowe opisy" audit: three of these five per-dimension bars were far
      // enough below their field's real observed range that "2+ holes at once" could never
      // mathematically happen (measured on a 160-roster sample: starterSpacingStrength's own real
      // p5 was 0.494, defensiveLayeringScore's p5 was 0.753, starterReboundingScore's p5 was
      // 0.543 — all comfortably above the old 0.40-0.42 bars). Raised each to sit just below its
      // own real p10-p15 (spacing/rebounding) or with real headroom below the real p5 (defense,
      // which almost never reads low at all), so a genuinely bad-in-two-ways roster can actually
      // trip this. `creatorCount === 0` and the positional-compromise bar were already reachable
      // (both fire in the real sample) — left unchanged.
      if ((t.creatorCount ?? 0) === 0) holes.push('shot creation');
      if ((t.starterSpacingStrength ?? 1) <= 0.58) holes.push('spacing');
      if ((t.defensiveLayeringScore ?? 1) <= 0.70) holes.push('team defense');
      if ((t.starterReboundingScore ?? 1) <= 0.58) holes.push('rebounding');
      if ((t.positionalCompromiseCount ?? 0) >= 3) holes.push('positions');
      return holes.length >= 2
        ? hit(0.62 + holes.length * 0.10, 0.96, teamConfidence(t), `Several holes at once: ${holes.join(', ')}.`, { values: { structuralHoleCount: holes.length }, notes: holes }, 0.98)
        : inactive;
    }
  },
  {
    id: 'GOOD_SPACING_BUT_ONE_NONSHOOTER_BOTTLENECK', type: 'concern', category: 'cross',
    evaluate: t => {
      const nonShooters = t.starters.filter(p => !p.isSpacingArchetype);
      const shooters = t.starterPlusShooterCount ?? 0;
      return shooters >= 4 && nonShooters.length === 1
        ? hit(0.64, 0.83, teamConfidence(t), playedBeforeThreePointLine(nonShooters[0])
          ? `${nonShooters[0].playerName} played before the 3-point line and is your only starter who doesn't shoot from outside, so defenders know exactly who to leave.`
          : `${nonShooters[0].playerName} is the only starter who doesn't shoot from outside, so defenders know exactly who to leave.`, { players: [nonShooters[0].playerName], values: { starterPlusShooterCount: shooters, starterNonSpacerCount: 1 } }, 0.92)
        : inactive;
    }
  },
  {
    id: 'DEFENSE_AT_COST_OF_SPACING', type: 'concern', category: 'cross',
    evaluate: t => {
      const d = t.defensiveLayeringScore ?? 0;
      const s = t.starterSpacingStrength ?? 1;
      return d >= 0.72 && s <= 0.45
        ? hit((d + (1 - s)) / 2, 0.94, teamConfidence(t), "Your best defensive lineups can't shoot — you'll have to trade defense for spacing.", { values: { defensiveLayeringScore: d, starterSpacingStrength: s } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'ELITE_DEFENSE_LOW_FGA_COST', type: 'strength', category: 'cross',
    evaluate: t => {
      const d = t.defensiveLayeringScore ?? 0;
      const f = t.fgaEfficiencyScore ?? 0;
      const c = t.lowUsageComplementCount ?? 0;
      return d >= ELITE_BARS.defensiveLayering - 0.05 && f >= 0.72 && c >= 2
        ? hit((d + f) / 2, 0.92, teamConfidence(t), 'Several cheap players give you elite defense, leaving more caps for your scorers.', { values: { defensiveLayeringScore: d, fgaEfficiencyScore: f, lowUsageComplementCount: c } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'STAR_POWER_WITH_USAGE_COLLISION', type: 'concern', category: 'cross',
    suppresses: ['MULTIPLE_HIGH_USAGE_PLAYERS', 'SEVERE_USAGE_COLLISION', 'STAR_FGA_COMPRESSION', 'OFFENSIVE_ROLE_REDUNDANCY'],
    evaluate: t => {
      const overlap = t.usageOverlapScore ?? 0;
      const compression = t.fgaCompressionScore ?? 0;
      const stars = t.players.filter(p => (p.tal ?? 0) >= 85 && p.minutes >= 24 && isShotHungry(p));
      const starShots = stars.reduce((sum, p) => sum + p.fga, 0);
      return stars.length >= 3 && starShots >= 55 && Math.max(overlap, compression) >= 0.65
        ? hit(Math.max(overlap, compression), 0.96, teamConfidence(t), `${displayNames(stars)} are all stars who need the ball and a lot of shots — there isn't enough to go around.`, { players: stars.map(p => p.playerName), values: { usageOverlapScore: overlap, fgaCompressionScore: compression } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'GREAT_STARTERS_WEAK_BENCH', type: 'concern', category: 'cross',
    evaluate: t => {
      const drop = t.benchDropoffScore ?? 0;
      const mins = t.starters.reduce((s, p) => s + p.minutes, 0);
      const tal = t.starters.reduce((s, p) => s + (p.tal ?? 0) * p.minutes, 0) / Math.max(1, mins);
      // 2026-09-17, "dodatkowe opisy" audit: `weightedStarterTal >= 78` was never the real gate —
      // a real 160-roster sample's weighted-starter-TAL never dropped below 85.7 (drafted starters
      // are always elite-caliber by construction), so `tal>=78` was already unconditionally true.
      // The actual blocker was `drop >= 0.62`: `benchDropoffScore` is the exact same field
      // `topHeavyScore` reads (see insightMapper.ts), whose own real max is 0.356 — 0.62 could
      // never fire. Lowered to 0.26 (real p90), matching the same recalibration TOP_HEAVY_ROTATION
      // just got for the identical underlying number.
      return tal >= 78 && drop >= 0.26
        ? hit(drop, 0.90, teamConfidence(t), weakBenchMessage(t), { values: { weightedStarterTal: tal, benchDropoffScore: drop } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'RIM_PROTECTION_BUT_POOR_PERIMETER_DEFENSE', type: 'concern', category: 'cross',
    evaluate: t => {
      const r = t.rimProtectionScore ?? 0;
      const p = t.perimeterDefenseScore ?? 1;
      return r >= 0.72 && p <= 0.42
        ? hit((r + (1 - p)) / 2, 0.90, teamConfidence(t), 'Your rim protector has to clean up after weak perimeter defense.', { values: { rimProtectionScore: r, perimeterDefenseScore: p } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'PERIMETER_DEFENSE_BUT_NO_RIM_PROTECTION', type: 'concern', category: 'cross',
    evaluate: t => {
      const p = t.perimeterDefenseScore ?? 0;
      const r = t.rimProtectionScore ?? 1;
      // 2026-09-17, "dodatkowe opisy" audit: `perimeterDefenseScore >= 0.72` was already easily
      // reachable (real p25 was 0.783), so the real blocker was `rimProtectionScore <= 0.40` — a
      // real 160-roster sample's own worst 5% still read 0.537, so 0.40 was below anything a real
      // drafted team produces. Lowered to 0.55 (just above the real p10, 0.588's neighbor), so this
      // now flags a genuinely rim-protection-poor team instead of an unreachable floor.
      return p >= 0.72 && r <= 0.55
        ? hit((p + (1 - r)) / 2, 0.90, teamConfidence(t), 'Good perimeter defenders, but no rim protector behind them.', { values: { perimeterDefenseScore: p, rimProtectionScore: r } }, 0.95)
        : inactive;
    }
  },
  {
    id: 'ELITE_CREATION_POOR_SPACING', type: 'concern', category: 'cross',
    evaluate: t => {
      const c = t.creatorCount ?? 0;
      const s = t.starterSpacingStrength ?? 1;
      return c >= 2 && s <= 0.42
        ? hit(0.58 + (1 - s) * 0.32, 0.94, teamConfidence(t), creatorsPoorSpacingMessage(t), { values: { creatorCount: c, starterSpacingStrength: s } }, 0.95)
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
        ? hit(0.58 + s * 0.28, 0.90, teamConfidence(t), 'Great spacing, but maybe not enough players who can create shots to use it.', { values: { starterSpacingStrength: s, creatorCount: c, starterNonSpacerCount: nonSpacers } }, 0.95)
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
        ? hit(0.60 + f * 0.35, 0.96, teamConfidence(t), bargainMessage(t, 'A lot of team impact for the caps you spent.'), { values: { fgaEfficiencyScore: f, netRatingProjection: n, totalFga: t.totalFga } }, 0.98)
        : inactive;
    }
  },
  {
    id: 'STRONG_CORE_FRAGILE_ROTATION', type: 'concern', category: 'cross',
    evaluate: t => {
      const top = t.topHeavyScore ?? 0;
      const deep = t.deepRotationScore ?? 1;
      // 2026-09-17, "dodatkowe opisy" audit: doubly unreachable on a real 160-roster sample —
      // `topHeavyScore` (same field TOP_HEAVY_ROTATION/GREAT_STARTERS_WEAK_BENCH just got
      // recalibrated for) never exceeded 0.356, and `deepRotationScore`'s own real worst case never
      // dropped below 0.667 (it's a discrete k/9 — 6/9 rounds to 0.667). Lowered both to the same
      // real p90-ish neighborhood the sibling depth detectors above now use, so a genuinely
      // top-heavy-AND-shallow roster (this concern's whole point, and the exact shape the
      // DEAD_NINTH_SLOT_ACCEPTABLE suppression below this file's EXPLICIT_SUPPRESSION now depends
      // on) can actually fire instead of being permanently dead code.
      return top >= 0.26 && deep <= 0.70
        ? hit((top + (1 - deep)) / 2, 0.88, teamConfidence(t), 'Your best lineups are strong, but the full playoff rotation is fragile.', { values: { topHeavyScore: top, deepRotationScore: deep } }, 0.95)
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
      // 2026-09-17, "dodatkowe opisy" audit: `roleFlexibilityScore >= 0.70` was the blocker here
      // too (same field ROLE_FLEXIBILITY_HIGH above was just recalibrated for — real max 0.50).
      // `d`/`def`/`sp`'s own bars were already comfortably reachable on their own. Lowered just
      // this one leg to 0.35, a notch below ROLE_FLEXIBILITY_HIGH's own new 0.40 since this is only
      // one of four ANDed conditions here, not the detector's sole claim.
      return f >= 0.35 && d >= 0.62 && Math.min(def, sp) >= 0.55
        ? hit((f + d + def + sp) / 4, 0.84, teamConfidence(t), 'You can win with several different lineups, not just one.', { values: { roleFlexibilityScore: f, deepRotationScore: d, defensiveLayeringScore: def, spacingStrength: sp } }, 0.98)
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
          `${displayNameList(names)} ${plural(names, 'is a shooter', 'are shooters')} defenses must chase off screens — scoring without needing the ball.`,
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
          'You start two bigs, but enough shooting keeps the paint open.',
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
          nonSpacerOverloadMessage(t, count),
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
      return coverage >= Math.max(TEAM_MODEL_THRESHOLDS.eliteDefensiveCoverage, ELITE_BARS.defensiveCoverage) && confirmed === 3
        ? hit(
          coverage,
          0.94,
          Math.min(teamConfidence(t), 0.82),
          'Your starting five has a defender for the ball handler, the wings and the rim, and can switch screens.',
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
          `${displayNameList(names)} ${plural(names, 'is a defensive weak spot', 'are defensive weak spots')}, but limited minutes and good help around ${plural(names, 'him', 'them')} keep it manageable.`,
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
          huntableStarterMessage(names, rotationTargets.filter(name => !names.includes(name)), t.defensiveTargetableMinutes ?? 0),
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
          `${displayNameList(names)} ${plural(names, 'gives', 'give')} real value for 8 caps or less, saving caps for your stars.`,
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
          `${stars[0].playerName} is worth his caps — nobody else creates like him, and there's still room for a real eight-man rotation.`,
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
          `${stars[0].playerName} costs ${stars[0].fga.toFixed(1)} caps, and the roster around him is thin because of it.`,
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
          `${displayNameList(names)} can sit out the playoff rotation without hurting you — eight others cover the minutes and the ninth spot cost few caps.`,
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
        ? `${displayNameList(names)} ${plural(names, 'costs', 'cost')} ${(t.deadRosterSlotFga ?? 0).toFixed(1)} caps but won't play in the playoffs — caps that could have gone elsewhere.`
        : `${displayNameList(names)} ${plural(names, "isn't", "aren't")} good enough to play, so the rest of your rotation has to cover too many minutes or play out of position.`;
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
          `${displayNames(t.players.filter(p => c.balanced.players.some(bp => bp.playerId === p.playerId)), 5)} are your closing lineup at both ends — no need to choose between offense and defense late in games.`,
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
      // 2026-09-23: 0.11 -> 0.10 after `UNCORROBORATED_CEILING` (defensiveTalent.ts, 78->58) capped
      // Dirk Nowitzki's 2006-08 D-TAL further (his own real corroboration is thin for this span),
      // which pulled this same fixture's `balancedDefenseTradeoff` from 0.113 to exactly 0.10 —
      // re-measured directly, not guessed; still the same real two-big offense/defense split this
      // bar exists to keep visible.
      // 2026-09-24: 0.10 -> 0.09 after the `displayExtraDefenseBonus` source-count ramp
      // (defensiveTalent.ts) lifted Dirk Nowitzki 2006-08's D-TAL, moving this same fixture's
      // `balancedDefenseTradeoff` 0.1000 -> 0.0967. Measured, not guessed — but note the last two
      // bar moves both simply tracked this one fixture, so treat 0.09 as "roughly a tenth of the
      // composite," not a validated cutoff.
      // 2026-09-24: 0.09 -> 0.08 after the real-data excess pooling / matchup discount
      // (darkoCorrection.ts) moved this same fixture's `balancedDefenseTradeoff` 0.0967 -> 0.087.
      // Third bar move in two days that simply tracks `twoBig` — the threshold is a fixture-chaser,
      // not a validated cutoff; a relative measure (or a fixture with a clearly larger split) would
      // stop it drifting with every D-TAL calibration.
      const meaningfulTradeoff = c.balancedOffenseTradeoff >= 0.08 || c.balancedDefenseTradeoff >= 0.08;
      if (c.offenseDefensePersonnelOverlap >= 4 || !meaningfulTradeoff) return inactive;
      const offenseOnly = c.offense.players.filter(p => !c.defense.players.some(dp => dp.playerId === p.playerId));
      const defenseOnly = c.defense.players.filter(p => !c.offense.players.some(op => op.playerId === p.playerId));
      const costsOffense = c.balancedOffenseTradeoff >= c.balancedDefenseTradeoff;
      return hit(
        Math.max(c.balancedOffenseTradeoff, c.balancedDefenseTradeoff),
        0.78,
        teamConfidence(t),
        `Late in games you'll have to choose: your best offensive five (with ${displayNameList(offenseOnly.map(p => p.playerName))}) and best defensive five (with ${displayNameList(defenseOnly.map(p => p.playerName))}) share only ${c.offenseDefensePersonnelOverlap} of 5 players, and the in-between lineup gives up some ${costsOffense ? 'offense' : 'defense'}.`,
        { players: [...offenseOnly, ...defenseOnly].map(p => p.playerName), values: { offenseDefensePersonnelOverlap: c.offenseDefensePersonnelOverlap, balancedOffenseTradeoff: c.balancedOffenseTradeoff, balancedDefenseTradeoff: c.balancedDefenseTradeoff } },
        0.85,
      );
    }
  },
  // ---- 2026-09-25, descriptions part 2: detectors that read real box-score lines, so the text can
  // say what a player actually did. Bars measured on 192 AI-drafted teams (12 seeded drafts).
  {
    // Best rotation passer at 10.5+ assists: ~22% of teams (median best passer: 8.8).
    id: 'ELITE_FLOOR_GENERAL', type: 'strength', category: 'creation',
    evaluate: t => {
      const passer = [...t.players].filter(p => p.minutes >= 28).sort((a, b) => (b.apg ?? 0) - (a.apg ?? 0))[0];
      return passer && (passer.apg ?? 0) >= 10.5
        ? hit(0.70 + Math.min(0.2, ((passer.apg ?? 0) - 10.5) / 15), 0.88, teamConfidence(t), `${passer.playerName} runs the show — ${(passer.apg ?? 0).toFixed(1)} assists a game, so your scorers get easy looks.`, { players: [passer.playerName], values: { apg: passer.apg ?? 0 } }, 0.94)
        : inactive;
    }
  },
  {
    // Nobody in the rotation above 6.5 assists: ~8% of teams.
    id: 'NO_TRUE_PLAYMAKER', type: 'concern', category: 'creation',
    evaluate: t => {
      const rotation = t.players.filter(p => p.minutes >= 18);
      const best = [...rotation].sort((a, b) => (b.apg ?? 0) - (a.apg ?? 0))[0];
      return best && (best.apg ?? 0) < 6.5
        ? hit(0.74, 0.88, teamConfidence(t), `Your best passer, ${best.playerName}, averaged just ${(best.apg ?? 0).toFixed(1)} assists — expect a lot of one-on-one basketball.`, { players: [best.playerName], values: { bestApg: best.apg ?? 0 } }, 0.94)
        : inactive;
    }
  },
  {
    // A heavy-minutes starter under 55% at the line — the Hack-a-Shaq problem.
    id: 'FREE_THROW_LIABILITY', type: 'concern', category: 'rotation',
    evaluate: t => {
      const poor = t.starters
        .filter(p => p.minutes >= 28 && (p.ftPct ?? 1) > 0 && (p.ftPct ?? 1) < 0.55)
        .sort((a, b) => (a.ftPct ?? 1) - (b.ftPct ?? 1));
      const worst = poor[0];
      return worst
        ? hit(0.62 + (0.55 - (worst.ftPct ?? 0.55)) * 0.8, 0.82, teamConfidence(t), `${worst.playerName} made only ${Math.round((worst.ftPct ?? 0) * 100)}% of his free throws — in a close game, opponents can foul him on purpose.`, { players: [worst.playerName], values: { ftPct: worst.ftPct ?? 0 } }, 0.95)
        : inactive;
    }
  },
  {
    // Steals only count where they were recorded (1973-74 on).
    id: 'BALL_HAWKS', type: 'strength', category: 'perimeter_defense',
    evaluate: t => {
      const hawks = t.players
        .filter(p => p.minutes >= 24 && p.defensiveStatsTracked !== false && (p.spg ?? 0) >= 2.0)
        .sort((a, b) => (b.spg ?? 0) - (a.spg ?? 0));
      const active = hawks.length >= 2 || (hawks[0]?.spg ?? 0) >= 2.5;
      return active
        ? hit(0.66 + hawks.length * 0.05, 0.84, teamConfidence(t), `${joinNames(hawks.slice(0, 3).map(p => `${p.playerName} (${(p.spg ?? 0).toFixed(1)} steals)`), Math.max(0, hawks.length - 3))} turn${hawks.length === 1 ? 's' : ''} defense into easy fast-break points.`, { players: hawks.map(p => p.playerName), values: { ballHawkCount: hawks.length } }, 0.94)
        : inactive;
    }
  },
  {
    // Blocks only count where they were recorded (1973-74 on).
    id: 'SHOT_BLOCKING_ANCHOR', type: 'strength', category: 'rim_protection',
    evaluate: t => {
      const anchor = t.players
        .filter(p => p.minutes >= 24 && p.defensiveStatsTracked !== false)
        .sort((a, b) => (b.bpg ?? 0) - (a.bpg ?? 0))[0];
      return anchor && (anchor.bpg ?? 0) >= 3.0
        ? hit(0.68 + Math.min(0.2, ((anchor.bpg ?? 0) - 3) / 10), 0.86, teamConfidence(t), `${anchor.playerName} blocked ${(anchor.bpg ?? 0).toFixed(1)} shots a game — every drive into the paint is a gamble.`, { players: [anchor.playerName], values: { bpg: anchor.bpg ?? 0 } }, 0.95)
        : inactive;
    }
  },
  {
    // No starter at 24+ points a game.
    id: 'NO_GO_TO_SCORER', type: 'concern', category: 'creation',
    evaluate: t => {
      const top = [...t.starters].sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0))[0];
      return top && (top.ppg ?? 0) < 24
        ? hit(0.72, 0.86, teamConfidence(t), `Your top scorer, ${top.playerName}, averaged ${(top.ppg ?? 0).toFixed(1)} points — when the offense stalls, there's no one to hand the ball to.`, { players: [top.playerName], values: { topPpg: top.ppg ?? 0 } }, 0.94)
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

/** The team's 0-100 score chips the results screen shows next to the text. */
export type InsightScoreArea = 'offense' | 'defense' | 'spacing' | 'benchDepth' | 'rotation' | 'fit';

/** What the results screen knows beyond the roster itself. Optional: without it the lists fall
 * back to a neutral size and no chip checks. */
export interface InsightContext {
  /** Where the team finished: 1 = best in the field, 0 = worst. */
  standing?: number;
  scores?: Partial<Record<InsightScoreArea, number>>;
}

export function insightContextFor(
  breakdown: { offenseScore: number; defenseScore: number; spacingScore: number; benchDepthScore: number; rotationScore: number; fitScore: number },
  rank: number,
  fieldSize: number,
): InsightContext {
  return {
    standing: fieldSize > 1 ? 1 - (rank - 1) / (fieldSize - 1) : 0.5,
    scores: {
      offense: breakdown.offenseScore,
      defense: breakdown.defenseScore,
      spacing: breakdown.spacingScore,
      benchDepth: breakdown.benchDepthScore,
      rotation: breakdown.rotationScore,
      fit: breakdown.fitScore,
    },
  };
}

/**
 * 2026-09-25, user-reported live (player-perspective copy review): the lists read as noise —
 * every team got 7 strengths whatever its finish (bottom-3 and top-3 of 192 AI teams both averaged
 * 7.0), the same topic came up 2-3 times per list, a strength and a concern often said opposite
 * things ("a defender for every spot" next to "X and Y are defensive weak spots": 50 of 192 teams),
 * text disagreed with the score chips (Bench Depth 75+ next to "not deep enough": 36 teams), and
 * the biggest problem wasn't first. Selection below, on top of the unchanged detectors/scores:
 * - topics: one sentence per narrow topic per side (two at most per broad one, e.g. defense); a strength and a concern on the same narrow topic
 *   (or a listed cross-topic pair) never both show — the chip for that area decides which is
 *   true, otherwise the stronger signal wins.
 * - chip consistency: no strength about an area scored under 55, no concern about one scored 75+.
 * - names: a strength that only repeats players an earlier strength already credited is skipped.
 * - priority: a concern about the team's weakest area jumps ahead, so the first concern is what
 *   cost the most points; commonplace strengths (things almost every drafted team has) sink.
 * - size: 2-5 strengths and 2-5 concerns depending on the team's finish.
 */
type InsightTopic =
  | 'creation' | 'usage' | 'spacing' | 'perimeter_def' | 'rim_def' | 'team_def' | 'weak_link_def'
  | 'rebounding' | 'position' | 'minutes' | 'depth' | 'closing' | 'structure' | 'playmaking' | 'free_throws';

const CATEGORY_TOPIC: Record<InsightCategory, InsightTopic> = {
  creation: 'creation', usage: 'usage', fga: 'usage', off_ball: 'usage', fit: 'usage', redundancy: 'usage',
  spacing: 'spacing', shooting: 'spacing',
  perimeter_defense: 'perimeter_def', rim_protection: 'rim_def', defensive_structure: 'team_def',
  rebounding: 'rebounding', position: 'position', rotation: 'minutes', depth: 'depth',
  two_way: 'closing', cross: 'structure',
};

const TOPIC_OVERRIDE: Partial<Record<DetectorId, InsightTopic>> = {
  STAR_POWER_WITHOUT_USAGE_COLLISION: 'usage',
  STAR_POWER_WITH_USAGE_COLLISION: 'usage',
  LOW_FGA_HIGH_IMPACT_CONSTRUCTION: 'usage',
  GOOD_SPACING_BUT_ONE_NONSHOOTER_BOTTLENECK: 'spacing',
  ELITE_CREATION_POOR_SPACING: 'spacing',
  ELITE_SPACING_WEAK_CREATION: 'creation',
  ELITE_DEFENSE_LOW_FGA_COST: 'team_def',
  // One named player opponents go after is a different claim from "the team defends well" — both
  // can be true (a Jordan/Gobert frame around a Brunson), so they only clash with each other.
  DEFENSIVE_WEAK_LINK: 'weak_link_def',
  MULTIPLE_DEFENSIVE_WEAK_LINKS: 'weak_link_def',
  HUNTABLE_STARTER_EXPOSED: 'weak_link_def',
  HUNTABLE_SPECIALIST_MITIGATED: 'weak_link_def',
  RIM_PROTECTION_BUT_POOR_PERIMETER_DEFENSE: 'perimeter_def',
  PERIMETER_DEFENSE_BUT_NO_RIM_PROTECTION: 'rim_def',
  GREAT_STARTERS_WEAK_BENCH: 'depth',
  STRONG_CORE_FRAGILE_ROTATION: 'depth',
  MULTIPLE_PATHS_TO_VIABLE_LINEUP: 'depth',
  DEAD_NINTH_SLOT_ACCEPTABLE: 'depth',
  DEAD_SLOT_HURTS_ROTATION: 'depth',
  ROLE_FLEXIBILITY_HIGH: 'position',
  ROLE_FLEXIBILITY_LOW: 'position',
  CLOSING_FIVE_STABLE: 'closing',
  ELITE_FLOOR_GENERAL: 'playmaking',
  NO_TRUE_PLAYMAKER: 'playmaking',
  FREE_THROW_LIABILITY: 'free_throws',
  CLOSING_FIVE_REQUIRES_TRADEOFF: 'closing',
  DEFENSE_AT_COST_OF_SPACING: 'closing',
};

/** Pairs on different topics that still contradict each other when read side by side. */
const TEAM_DEFENSE_HOLES: DetectorId[] = ['NO_WING_STOPPER', 'NO_POA_DEFENDER', 'NO_RIM_PROTECTOR', 'PERIMETER_DEFENSE_BUT_NO_RIM_PROTECTION', 'RIM_PROTECTION_BUT_POOR_PERIMETER_DEFENSE'];
const CROSS_TOPIC_CONFLICTS: Partial<Record<DetectorId, DetectorId[]>> = {
  CLOSING_FIVE_STABLE: ['NON_SPACER_OVERLOAD', 'MULTIPLE_NON_SPACERS', 'LOW_STARTING_SPACING'],
  NO_MAJOR_STRUCTURAL_HOLE: ['MULTIPLE_NON_SPACERS', 'NON_SPACER_OVERLOAD', ...TEAM_DEFENSE_HOLES],
  // "…and can switch screens" can't sit next to several defenders opponents hunt.
  DEFENSIVE_COVERAGE_CAPACITY_ELITE: [...TEAM_DEFENSE_HOLES, 'MULTIPLE_DEFENSIVE_WEAK_LINKS'],
  ELITE_DEFENSIVE_LAYERING: TEAM_DEFENSE_HOLES,
  BALANCED_DEFENSIVE_COVERAGE: TEAM_DEFENSE_HOLES,
  ELITE_DEFENSE_LOW_FGA_COST: [...TEAM_DEFENSE_HOLES, 'MULTIPLE_DEFENSIVE_WEAK_LINKS'],
};

const TOPIC_AREA: Partial<Record<InsightTopic, InsightScoreArea>> = {
  creation: 'offense', playmaking: 'offense', usage: 'fit', spacing: 'spacing',
  perimeter_def: 'defense', rim_def: 'defense', team_def: 'defense', weak_link_def: 'defense',
  minutes: 'rotation', position: 'rotation', depth: 'benchDepth',
};

/** Strengths nearly every drafted roster has (measured 56-97% of 192 AI teams) — true, but they
 * don't tell a player anything about THIS team, so they only fill space nothing better wants. */
const COMMONPLACE_STRENGTHS = new Set<DetectorId>([
  'POA_DEFENDER_PRESENT', 'WING_STOPPER_PRESENT', 'RIM_PROTECTION_CONTINUITY', 'MATCHUP_SPECIALIST_AVAILABLE',
  'SECONDARY_CREATION_PRESENT', 'MULTIPLE_CREATION_SOURCES', 'STRETCH_BIG_VALUE', 'EFFICIENT_FGA_BUDGET',
  'NATURAL_POSITION_ROTATION',
]);

const topicOf = (i: RosterInsight): InsightTopic => TOPIC_OVERRIDE[i.id] ?? CATEGORY_TOPIC[i.category];
const broadTopicOf = (i: RosterInsight): string => {
  const topic = topicOf(i);
  return topic.endsWith('_def') ? 'defense' : topic;
};

function contradicts(a: RosterInsight, b: RosterInsight): boolean {
  if (a.type === b.type) return false;
  const [strength, concern] = a.type === 'strength' ? [a, b] : [b, a];
  return topicOf(strength) === topicOf(concern) || (CROSS_TOPIC_CONFLICTS[strength.id]?.includes(concern.id) ?? false);
}

function selectForDisplay(eligible: RosterInsight[], config: typeof DEFAULT_INSIGHT_CONFIG, context: InsightContext) {
  const chipFor = (i: RosterInsight): number | undefined => {
    const area = TOPIC_AREA[topicOf(i)];
    return area ? context.scores?.[area] : undefined;
  };
  const tilt = context.standing == null ? 0 : (context.standing - 0.5) * 0.1;
  const priority = (i: RosterInsight): number => {
    const chip = chipFor(i);
    if (i.type === 'strength') {
      return i.score + tilt
        - (COMMONPLACE_STRENGTHS.has(i.id) ? 0.08 : 0)
        + (chip == null ? 0 : 0.15 * clamp01((chip - 70) / 30));
    }
    return i.score - tilt + (chip == null ? 0 : 0.3 * clamp01((70 - chip) / 40));
  };
  const slots = context.standing == null
    ? { strength: config.targetPerSide, concern: config.targetPerSide }
    : { strength: 2 + Math.round(context.standing * 3), concern: 2 + Math.round((1 - context.standing) * 3) };

  const candidates = eligible
    .filter(i => {
      const chip = chipFor(i);
      if (chip == null) return true;
      return i.type === 'strength' ? chip >= 55 : chip < 75;
    })
    .map(i => ({ insight: i, priority: priority(i) }))
    .sort((a, b) => b.priority - a.priority);

  const picked: RosterInsight[] = [];
  for (const { insight } of candidates) {
    const side = picked.filter(p => p.type === insight.type);
    if (side.length >= Math.min(slots[insight.type], config.maxPerSide)) continue;
    // One sentence per narrow topic, and at most two on the same broad one (e.g. perimeter and
    // rim defense can both show, a third defense line can't).
    if (side.some(p => topicOf(p) === topicOf(insight))) continue;
    if (side.filter(p => broadTopicOf(p) === broadTopicOf(insight)).length >= 2) continue;
    // A higher-priority item on the other side already made the opposite claim.
    if (picked.some(p => contradicts(p, insight))) continue;
    const names = insight.evidence.players ?? [];
    if (insight.type === 'strength' && names.length > 0) {
      const credited = new Set(side.flatMap(p => p.evidence.players ?? []));
      if (names.every(name => credited.has(name))) continue;
    }
    picked.push(insight);
  }
  return {
    strengths: picked.filter(i => i.type === 'strength'),
    concerns: picked.filter(i => i.type === 'concern'),
  };
}

export function generateRosterInsights(
  team: TeamFeatureSnapshot,
  config = DEFAULT_INSIGHT_CONFIG,
  context: InsightContext = {},
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
  // `allActiveInsights` stays in raw score order (debug/tooling reads it as a priority ranking).
  return { ...selectForDisplay(eligible, config, context), allActiveInsights: ranked };
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
