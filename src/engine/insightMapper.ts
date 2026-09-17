import type { PlayerSpan, Position } from '../data/schema';
import { HIGH_USAGE_ARCHETYPE_WEIGHT, RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES, normalizePlayerName } from '../data/schema';
import type { Team } from './types';
import type { PlayerTeamFeature, TeamFeatureSnapshot } from './insights';
import { STARTER_SLOTS, ROSTER_SIZE, positionFitMultiplier, positionDistance } from './positions';
import { computeOffensiveTalent, computeDefensiveTalent } from './talent';
import { effectiveTalent } from './grades';
import { computeSpacing, isShootingAnomalyPlayer } from './spacing';
import { isPlusShooter } from './shooting';
import { maxSustainableMinutes, computeDurability } from './durability';
import { allAssignments, primaryStarters, benchWithMinutes, totalMinutesForPlayer, MAX_MINUTES_PER_PLAYER, GAME_MINUTES } from './rotation';
import { projectedNetRating } from './netRatingProjection';
import { benchDepthScore, talentScore } from './scoring';
import { draftPool as allPoolPlayers } from '../data/draftPool';
import { defensiveHuntability } from './defensiveHuntability';
import { fitScore, shadowRoleProfileForDiagnostics } from './fit';
import { buildTeamModelExtension } from './teamModel';
import { buildClosingLineups } from './closingLineups';

/**
 * 2026-08-15, the Team → `TeamFeatureSnapshot` translation `insights.ts`'s own docstring points
 * to. Every field below is either a DIRECT reuse of an existing, already-validated engine signal
 * (noted inline where that's the case — same real percentile anchors `fitScore` itself uses:
 * spacing p10=0/p50=40/p90=85, D-TAL p10=19/p50=42/p90=79, O-POR p10=29/p50=48/p90=67, starter
 * rebounding floor=25 raw rpg — `scoring.ts`'s own comments are the source for each of these, not
 * re-derived here) or an explicitly-marked first-pass APPROXIMATION where this project has no
 * existing equivalent signal (most visibly: `PlayerSpan`'s `BoxLine` has no usage%/assist-rate/
 * turnover-rate/ORB%/DRB% at all — those `PlayerTeamFeature` fields are left undefined rather than
 * invented from nothing). Treat the approximated fields as a working first draft, the same way
 * every other calibrated constant in this codebase started as a reasonable guess before a real
 * report justified tightening it — not as finished, measured values.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Linear 0..1 normalization between two real reference points — the same shape `fitScore` uses
 * inline (deficitRatio/excessRatio), pulled out once here since the mapper reuses it repeatedly. */
const normalize = (value: number, lo: number, hi: number) => clamp01((value - lo) / (hi - lo));

// Same real percentile anchors `fitScore` (scoring.ts) is itself calibrated against — reused
// directly rather than re-measured, so this mapper's 0-1 scores agree with what `fitScore` already
// treats as "neutral"/"elite" for the exact same underlying metric.
const SPACING_LO = 0;
const SPACING_HI = 85;
const DTAL_LO = 19;
const DTAL_HI = 79;
const REBOUNDING_LO = 19; // fitScore's own "all-guard five" reference point
const REBOUNDING_HI = 40; // a bigs-heavy five comfortably above the ~30 "normal" combined total

const movementRoleCache = new Map<string, {
  score: number;
  confidence: number;
  evidence: string;
}>();

function movementShootingForSpan(span: PlayerSpan) {
  const cached = movementRoleCache.get(span.id);
  if (cached) return cached;
  const profile = shadowRoleProfileForDiagnostics(span);
  const incumbent = profile.incumbentOffensiveRole === 'Movement Shooter';
  const proposed = profile.proposedOffensiveRoles.find((fit) => fit.role === 'Movement Shooter');
  const fit = profile.offensiveFits.find((candidate) => candidate.role === 'Movement Shooter');
  const supported = incumbent || proposed !== undefined;
  const result = {
    score: supported ? (fit?.score ?? 0) / 100 : 0,
    confidence: incumbent ? 0.90 : proposed?.confidence === 'medium' ? 0.75 : proposed ? 0.55 : 0,
    evidence: incumbent
      ? 'incumbent Movement Shooter role + recorded 3PA/3P%'
      : proposed
        ? proposed.evidence.join('; ')
        : '',
  };
  movementRoleCache.set(span.id, result);
  return result;
}

function toPlayerFeature(
  p: PlayerSpan,
  minutes: number,
  assignedSlots: { slot: Position; minutes: number }[],
  starterSlot?: Position,
): PlayerTeamFeature {
  // Minutes-weighted average fit across every slot this player actually plays — a combo guard
  // split PG/SG isn't fairly described by either slot alone.
  const naturalPositionFit =
    assignedSlots.length > 0
      ? assignedSlots.reduce((sum, a) => sum + positionFitMultiplier(p, a.slot) * a.minutes, 0) /
        assignedSlots.reduce((sum, a) => sum + a.minutes, 0)
      : 1;
  const movement = movementShootingForSpan(p);
  return {
    playerId: p.id,
    playerName: p.playerName,
    spanLabel: p.spanLabel,
    minutes,
    fga: p.fga,
    rpg: p.box.rpg,
    tal: effectiveTalent(p),
    primaryPosition: p.primaryPosition,
    secondaryPositions: p.secondaryPositions,
    offensiveArchetype: p.offensiveArchetype,
    defensiveRole: p.defensiveRole,
    highUsageWeight: HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0,
    // APPROXIMATION: role-tag-or-stat-threshold, not a dedicated "is this a real spacer" flag —
    // matches how `fitScore` itself treats a real plus-shooter (`isPlusShooter`) or a lone
    // shooting anomaly (Curry) as "spacing solved," rather than reading the archetype tag alone.
    isSpacingArchetype: isPlusShooter(p) || isShootingAnomalyPlayer(p),
    isRimProtectorRole: RIM_PROTECTOR_ROLES.includes(p.defensiveRole),
    isPerimeterDefenderRole: PERIMETER_DEFENDER_ROLES.includes(p.defensiveRole),
    threePct: p.box.threePct,
    threePA: p.box.threePA,
    tsPct: p.box.tsPct,
    // No usage%/assist-rate/turnover-rate/ORB%/DRB% exist in this project's `BoxLine` — left
    // undefined rather than faked (see this file's own docstring).
    offensiveImpact: computeOffensiveTalent(p),
    defensiveImpact: computeDefensiveTalent(p),
    overallImpact: effectiveTalent(p),
    minuteCeiling: maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER),
    // APPROXIMATION: durability isn't separately exposed as a 0-1 "availability" read here;
    // `minuteCeiling` already carries the real durability signal for the detectors that use it
    // (MULTIPLE_MINUTES_CEILING_VIOLATIONS etc.), so `availability` is left undefined rather than
    // duplicating that signal under a different name.
    naturalPositionFit,
    // APPROXIMATION: no real "how many distinct roles has this player actually played" signal
    // exists — approximated from how many secondary positions the span carries (0 -> single-role,
    // 2+ -> fully flexible).
    roleFlexibility: clamp01((p.secondaryPositions.length ?? 0) / 2),
    starterSlot,
    spacingImpact: normalize(computeSpacing(p), SPACING_LO, SPACING_HI),
    movementShooting: movement.score,
    movementShootingConfidence: movement.confidence,
    movementShootingEvidence: movement.evidence || undefined,
  };
}

export function buildTeamFeatureSnapshot(team: Team): TeamFeatureSnapshot {
  const assignments = allAssignments(team);
  const starterEntries = primaryStarters(team);
  const bench = benchWithMinutes(team);

  const slotsByPlayer = new Map<string, { slot: Position; minutes: number }[]>();
  for (const a of assignments) {
    const list = slotsByPlayer.get(a.player.id) ?? [];
    list.push({ slot: a.slot, minutes: a.minutes });
    slotsByPlayer.set(a.player.id, list);
  }

  const starterSlotByPlayer = new Map(starterEntries.map((entry) => [entry.player.id, entry.slot]));

  const players = team.roster.map((p) =>
    toPlayerFeature(
      p,
      totalMinutesForPlayer(team.rotation, p.id),
      slotsByPlayer.get(p.id) ?? [],
      starterSlotByPlayer.get(p.id),
    ),
  );
  const playerById = new Map(players.map((p) => [p.playerId, p]));
  const starters = starterEntries.map((s) => playerById.get(s.player.id)!);
  const benchFeatures = bench.map(({ player }) => playerById.get(player.id)!);

  const starterSpans = starterEntries.map((s) => s.player);
  const rotationPlayers = players.filter((p) => p.minutes > 0);

  const totalFga = team.roster.reduce((sum, p) => sum + p.fga, 0);
  const totalMinutes = STARTER_SLOTS.length * GAME_MINUTES;

  const netRating = projectedNetRating(team);

  // Same shape as `fitScore`'s own `usageWeight` (starters only) — reused for the "on-ball
  // redundancy" family of detectors.
  const startersUsageWeight = starterSpans.reduce((sum, p) => sum + (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0), 0);
  const highUsageStarters = starterSpans.filter((p) => (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0) > 0);
  // 2026-08-16, user-reported bug: this used to be `starterSpans.filter(isSelfCreatorArchetype)`
  // — STARTERS only — while both detectors that read `creatorCount`
  // (ELITE_SPACING_WEAK_CREATION/ELITE_CREATION_POOR_SPACING, insights.ts) phrase their message
  // in terms of "the roster," not "the starting five." Concretely: a team with LeBron James
  // starting (a real self-creator) plus Chauncey Billups and Tyrese Haliburton both on the bench
  // (also real self-creators, per `HIGH_USAGE_ARCHETYPE_WEIGHT`) still read as "may lack enough
  // advantage creation" because only the ONE starter counted — the two bench creators were
  // invisible to this signal even though they're real, available creation off the bench. Reuses
  // `rotationPlayers`' own already-computed `highUsageWeight` (built from the same
  // `HIGH_USAGE_ARCHETYPE_WEIGHT` table `isSelfCreatorArchetype` read) instead of re-filtering
  // `PlayerSpan`s directly, which also makes the now-unused `isSelfCreatorArchetype` helper dead —
  // removed rather than left orphaned.
  const creators = rotationPlayers.filter((p) => (p.highUsageWeight ?? 0) >= 1);
  const secondaryCreators = rotationPlayers.filter((p) => (p.highUsageWeight ?? 0) > 0 && (p.highUsageWeight ?? 0) < 1);
  const lowUsageComplements = rotationPlayers.filter((p) => (p.highUsageWeight ?? 0) === 0);

  const avgStarterSpacing = starterSpans.length > 0 ? starterSpans.reduce((s, p) => s + computeSpacing(p), 0) / starterSpans.length : 0;
  const avgStarterDTal = starterSpans.length > 0 ? starterSpans.reduce((s, p) => s + computeDefensiveTalent(p), 0) / starterSpans.length : 0;
  const benchSpans = bench.map(({ player }) => player);
  const avgBenchSpacing = benchSpans.length > 0 ? benchSpans.reduce((s, p) => s + computeSpacing(p), 0) / benchSpans.length : avgStarterSpacing;

  const starterPlusShooters = starterSpans.filter(isPlusShooter);
  const hasShootingAnomaly = starterSpans.some(isShootingAnomalyPlayer);
  const allPlusShooters = rotationPlayers.filter((p) => p.isSpacingArchetype);
  const totalShooterMinutes = allPlusShooters.reduce((s, p) => s + p.minutes, 0);
  const topShooterMinutes = allPlusShooters.length > 0 ? Math.max(...allPlusShooters.map((p) => p.minutes)) : 0;

  const starterPerimeterDefenders = starterSpans.filter((p) => PERIMETER_DEFENDER_ROLES.includes(p.defensiveRole));
  const starterRimProtectors = starterSpans.filter((p) => RIM_PROTECTOR_ROLES.includes(p.defensiveRole));
  const rimProtectors = rotationPlayers.filter((p) => p.isRimProtectorRole);
  const perimeterDefenders = rotationPlayers.filter((p) => p.isPerimeterDefenderRole);

  const totalStarterRpg = starterSpans.reduce((sum, p) => sum + p.box.rpg, 0);

  const minutesCeilingViolations = rotationPlayers.filter((p) => p.minuteCeiling != null && p.minutes > p.minuteCeiling);

  // Positional compromise: a rotation minute where the player is neither at their primary
  // position nor a listed secondary — same real-fit definition `assessNeeds`/`isRealPositionFit`
  // (positions.ts) already use, applied per assignment rather than per player.
  const positionalCompromises = assignments.filter(
    (a) => a.minutes > 0 && a.player.primaryPosition !== a.slot && !a.player.secondaryPositions.includes(a.slot),
  );
  const positionalCompromisePlayers = [...new Set(positionalCompromises.map((assignment) => assignment.player.playerName))];
  const severePositionalCompromises = positionalCompromises.filter(
    (a) => positionDistance(a.slot, a.player.primaryPosition) >= 2,
  );
  const severePositionalCompromisePlayers = [...new Set(severePositionalCompromises.map((assignment) => assignment.player.playerName))];

  // Depth/top-heaviness — reuses `benchDepthScore`/`talentScore` (scoring.ts) directly rather
  // than re-deriving a parallel "how good is the core vs. the bench" measure.
  const coreTal = talentScore(team);
  const depthTal = benchDepthScore(team);
  const topHeavyScore = coreTal > 0 ? clamp01((coreTal - depthTal) / coreTal) : 0;
  const benchDropoffScore = topHeavyScore;
  // 2026-08-15 fix: measured directly (`scripts/_measureInsightRates.ts`, 96 real drafted teams)
  // that the old fixed `/7` divisor let DEEP_PLAYOFF_ROTATION clear its 0.72 gate on literally
  // 100% of teams. This now derives from the active `ROSTER_SIZE` (9): a score near 1 means the
  // entire nine-man roster receives real minutes, while Team Model's separate playoff-depth signal
  // can still recognize a robust eight-man group with a cheap dead ninth slot. The per-player bar
  // remains 15 rather than a bare 10
  // (token garbage-time minutes) to 15 (a genuine, meaningful rotation share) so the detector
  // asks a harder, still-real question — "does the FULL roster get real run," not just "does it
  // get SOME run."
  const MEANINGFUL_ROTATION_MINUTES = 15;
  const deepRotationScore = clamp01(rotationPlayers.filter((p) => p.minutes >= MEANINGFUL_ROTATION_MINUTES).length / ROSTER_SIZE);

  const roleFlexibilityScore = rotationPlayers.length > 0
    ? clamp01(rotationPlayers.reduce((s, p) => s + (p.roleFlexibility ?? 0), 0) / rotationPlayers.length)
    : 0;

  // 2026-08-15 fix: was a fixed 0.15 default, no real signal behind it. `computeDurability`
  // (durability.ts) already exists on the same real 0-100 scale as every other judge metric —
  // reused directly, minutes-weighted across the actual rotation (a garbage-time bench arm's
  // fragility matters far less than a 36-minute starter's), and inverted (low durability = high
  // risk). No existing percentile anchor for durability specifically (unlike spacing/D-TAL/O-POR
  // above) — a straightforward 0-100 reversal is the honest default until one exists.
  const rotationMinutesTotal = rotationPlayers.reduce((s, p) => s + p.minutes, 0);
  const weightedDurability =
    rotationMinutesTotal > 0
      ? team.roster.reduce((s, p) => s + computeDurability(p) * totalMinutesForPlayer(team.rotation, p.id), 0) / rotationMinutesTotal
      : 100;
  const availabilityRisk = clamp01(1 - weightedDurability / 100);

  // 2026-08-15 fix: an earlier version of this approximated "compression" as overall cap
  // utilization — mathematically wrong, since nearly every legal roster spends close to the full
  // cap by construction (that's the whole point of the format), so it saturated near 1.0 for
  // almost every real team and never actually discriminated anything (confirmed directly,
  // `scripts/_checkInsights.ts`, all 4 sampled real drafted teams). This game HAS a real, if
  // different, analogue: a player is drafted as one specific SPAN with a fixed FGA, and the cap
  // can force a star into a lower-FGA (lower-usage, cheaper) span of themselves than their own
  // real peak — checked directly against the full pool (`peakDraftPool.ts`'s own "peak span"
  // concept) rather than against team-wide spending.
  const highValueStarters = starterSpans.filter((p) => effectiveTalent(p) >= 85);
  const compressionRatios = highValueStarters.map((p) => {
    const ownMaxFga = Math.max(
      p.fga,
      ...allPoolPlayers.filter((o) => normalizePlayerName(o.playerName) === normalizePlayerName(p.playerName)).map((o) => o.fga),
    );
    return ownMaxFga > 0 ? clamp01((ownMaxFga - p.fga) / ownMaxFga) : 0;
  });
  const fgaCompressionScore = compressionRatios.length > 0 ? Math.max(...compressionRatios) : 0;

  // Talent-per-FGA across the rotation, normalized against the pool-wide baseline this project
  // already calibrates `BASE_FGA_PENALTY`/etc. against (talent.ts's own "points per FGA" anchor) —
  // approximated here via each rotation player's own TAL/FGA ratio, min-max normalized against a
  // reasonable observed range (4 = replacement-level cheap role player, 9 = elite efficiency).
  const avgTalPerFga = rotationPlayers.length > 0
    ? rotationPlayers.reduce((s, p) => s + (p.fga > 0 ? (p.tal ?? 0) / p.fga : 0), 0) / rotationPlayers.length
    : 0;
  const fgaEfficiencyScore = normalize(avgTalPerFga, 4, 9);

  const perimeterDefenseScore = normalize(
    starterPerimeterDefenders.length > 0
      ? starterPerimeterDefenders.reduce((s, p) => s + computeDefensiveTalent(p), 0) / starterPerimeterDefenders.length
      : avgStarterDTal,
    DTAL_LO,
    DTAL_HI,
  );
  // 2026-09-03 (audit "rim-protection overclaim"): the D-TAL average alone is blind to whether the
  // tagged rim protectors actually contest shots at the rim — a rebounding-heavy big (Dirk Nowitzki
  // 2002-04: "Mobile Big" tag, D-TAL ~65 from 9.3 rpg, only 1.2 bpg) inflated this enough to fire
  // "reliable interior protection" prose that specifically claims shot-contesting. Fold in a real
  // block-volume factor: the rim protectors' mean bpg mapped over [0.6, 2.4] (Dirk 1.2 -> 0.33,
  // Gobert ~2.2 -> 0.89, Mutombo ~3.4 -> 1.0). A big body with no blocks still keeps most of the
  // D-TAL credit (0.55 floor — they occupy space) but can no longer read as *elite* rim protection.
  const rimProtectorBpg =
    starterRimProtectors.length > 0
      ? starterRimProtectors.reduce((s, p) => s + p.box.bpg, 0) / starterRimProtectors.length
      : 0;
  const rimDeterrenceFactor = starterRimProtectors.length > 0 ? 0.55 + 0.45 * clamp01((rimProtectorBpg - 0.6) / 1.8) : 1;
  const rimProtectionScore =
    normalize(
      starterRimProtectors.length > 0
        ? starterRimProtectors.reduce((s, p) => s + computeDefensiveTalent(p), 0) / starterRimProtectors.length
        : avgStarterDTal,
      DTAL_LO,
      DTAL_HI,
    ) * rimDeterrenceFactor;
  const defensiveLayeringScore =
    starterRimProtectors.length > 0 && starterPerimeterDefenders.length > 0
      ? clamp01((perimeterDefenseScore + rimProtectionScore) / 2 + 0.1)
      : (perimeterDefenseScore + rimProtectionScore) / 2;

  // Reuse the production playoff weak-link definition instead of maintaining a second, much
  // lower starter-only threshold for prose. Descriptions now agree with Defense/FIT/DRTG about
  // who is targetable and count the offender's real assigned minutes.
  const huntability = defensiveHuntability(team);
  const teamModelExtension = buildTeamModelExtension({
    players,
    starters,
    bench: benchFeatures,
    fit: fitScore(team),
    huntability,
  });

  return {
    teamId: team.id,
    players,
    starters,
    bench: benchFeatures,
    totalMinutes,
    totalFga,

    offenseProjection: netRating.offense,
    defenseProjection: netRating.defense,
    netRatingProjection: netRating.net,

    highUsagePlayerCount: highUsageStarters.length,
    creatorCount: creators.length,
    secondaryCreatorCount: secondaryCreators.length,
    lowUsageComplementCount: lowUsageComplements.length,
    usageOverlapScore: clamp01(startersUsageWeight / 3),
    fgaCompressionScore,
    fgaEfficiencyScore,

    spacingCount: allPlusShooters.length,
    starterSpacingCount: starterPlusShooters.length,
    spacingStrength: normalize(avgStarterSpacing, SPACING_LO, SPACING_HI),
    starterSpacingStrength: hasShootingAnomaly ? 1 : normalize(avgStarterSpacing, SPACING_LO, SPACING_HI),
    benchSpacingStrength: normalize(avgBenchSpacing, SPACING_LO, SPACING_HI),
    nonSpacerCount: rotationPlayers.filter((p) => !p.isSpacingArchetype).length,
    starterNonSpacerCount: starterSpans.filter((p) => !isPlusShooter(p) && !isShootingAnomalyPlayer(p)).length,
    plusShooterCount: allPlusShooters.length,
    starterPlusShooterCount: starterPlusShooters.length,
    topShooterMinuteShare: totalShooterMinutes > 0 ? topShooterMinutes / totalShooterMinutes : 0,

    perimeterDefenderCount: perimeterDefenders.length,
    starterPerimeterDefenderCount: starterPerimeterDefenders.length,
    rimProtectorCount: rimProtectors.length,
    starterRimProtectorCount: starterRimProtectors.length,
    perimeterDefenseScore,
    rimProtectionScore,
    defensiveLayeringScore,
    defensiveWeakLinkCount: huntability.offenders.length,
    defensiveTargetableMinutes: huntability.targetableMinutes,
    // 2026-09-17, contradiction audit: `DEFENSIVE_WEAK_LINK`/`MULTIPLE_DEFENSIVE_WEAK_LINKS`
    // (insights.ts) used to re-derive "who's weak" from a flat `defensiveImpact < 60` filter,
    // independent of the position-relative `defensiveHuntability` calc that `defensiveWeakLinkCount`
    // above and `BALANCED_DEFENSIVE_COVERAGE` already use — confirmed live to let both
    // "few obvious matchup targets" (canonical) and "X is the clearest matchup-hunting target"
    // (flat threshold) fire together for the same roster. Threading the actual named offenders
    // through so every weak-link detector reads the one real calc, not two disagreeing ones.
    defensiveWeakLinkPlayers: huntability.offenders.map((o) => ({
      playerName: o.playerName,
      defensiveImpact: o.defensiveTalent,
      minutes: o.minutes,
    })),

    // APPROXIMATION: no split ORB%/DRB% signal exists (see this file's own docstring) — both
    // folded into the same combined-rebounding read `fitScore`'s own `STARTER_REBOUNDING_FLOOR`
    // already uses.
    teamOrbScore: normalize(totalStarterRpg, REBOUNDING_LO, REBOUNDING_HI),
    teamDrbScore: normalize(totalStarterRpg, REBOUNDING_LO, REBOUNDING_HI),
    starterReboundingScore: normalize(totalStarterRpg, REBOUNDING_LO, REBOUNDING_HI),

    positionalCompromiseCount: positionalCompromises.length,
    severePositionalCompromiseCount: severePositionalCompromises.length,
    positionalCompromisePlayers,
    severePositionalCompromisePlayers,
    minutesCeilingViolationCount: minutesCeilingViolations.length,
    deepRotationScore,
    topHeavyScore,
    roleFlexibilityScore,
    benchDropoffScore,
    availabilityRisk,
    // Small-sample/derived-signal count feeding `teamConfidence` — kept modest and fixed for now
    // (this project's own `SmallSampleBadge` concept could feed this later if wired through).
    uncertainty: 0.15,
    ...teamModelExtension,
    closingLineups: buildClosingLineups(team.roster) ?? undefined,
  };
}
