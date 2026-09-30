import type { OffensiveArchetype, PlayerSpan, Position } from '../data/schema';
import { computeSpacing } from './spacing';
import { computeOffensiveTalent } from './talent';
import { isPlusShooter } from './shooting';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { rimPressureForFit } from './rimPressure';
import { teamSpacingValue } from './midrangeGravity';

/**
 * G6a — archetype-pair anti-patterns. `fitScore` grades every starter's role in isolation and
 * the lineup's aggregate geometry (non-spacer count, defensive layers), but never asks "does
 * A's game mesh with B's game." The D2 draft exercise surfaced several rosters where the roles
 * all check out individually and the fit still doesn't work: Dončić + Shaq (the lead guard wants
 * a screen-and-pop big, the center wants the block), a drive hub with no shooting to kick to,
 * two post-up hubs sharing the block, a five that wants to run four different offenses at once.
 *
 * Deliberately **zero ML** — every check reads signals the engine already has
 * (`offensiveArchetype`, `playmakingScoreForPlayer`, `computeSpacing`, `computeOffensiveTalent`,
 * `isPlusShooter`). Degrades gracefully: a pre-1997 pair is judged on archetype + playmaking +
 * box, a modern one gets the same plus shot-diet-derived spacing. **Notes only for now** — no
 * score term — until the D2 human vote says whether any of these should also cost points. The
 * era-mismatch tail (Curry ↔ Kareem "wrong decade") is NOT here — that needs curated style data
 * (see the backlog's G6b), not an archetype rule.
 */

const HARD_NON_SPACER_SPC = 30;
const DRIVE_HUB_SPACING_CEILING = 50;
const POST_CENTER_SPACING_CEILING = 20;
// 2026-09-30, engine calibration session 2: the note fired on Stockton + Hakeem, CP3 + Duncan and
// LeBron + Walton. A passing big (Walton 60, Duncan 65) or one with a face-up midrange game (team
// spacing value from midrange gravity >= POST_CENTER_FACE_UP_FLOOR — Duncan, Mourning) is a real
// pick-and-roll partner; the note keeps pure block scorers (Shaq, Howard).
const POST_CENTER_PASSING_EXEMPTION = 60;
const POST_CENTER_FACE_UP_FLOOR = 15;
const HIGH_USAGE_OTAL = 82;
/** A starter contributes their offensive "system" (pattern 5) only if they're a real scoring
 * option at this level — a Slasher/Off-Screen role player whose archetype implies more primacy
 * than their box output delivers (Kirilenko-as-"Slasher") should not read as a fourth offense. */
const SYSTEM_MEMBER_OTAL = 72;
export const PNR_LEAD_PLAYMAKING = 85;

/**
 * Shared by the anti-pattern check below (#3) and `mismatchStructureScore`'s positive mirror —
 * "who is the real pick-and-roll initiator, if any." A Primary Ball Handler always qualifies; a
 * Shot Creator or Secondary Ball Handler only qualifies with real measured playmaking, so a pure
 * scorer who happens to bring the ball up sometimes doesn't count. Not slot-gated to PG — a wing
 * initiator (Harden, Luka) runs just as much real ball-screen offense as a lead guard.
 */
function isRealInitiator(player: PlayerSpan): boolean {
  return (
    player.offensiveArchetype === 'Primary Ball Handler' ||
    ((playmakingScoreForPlayer(player) ?? 0) >= PNR_LEAD_PLAYMAKING &&
      (player.offensiveArchetype === 'Shot Creator' || player.offensiveArchetype === 'Secondary Ball Handler'))
  );
}

/**
 * 2026-09-25 engine audit: on-ball demand is a SHOT-volume signal (real usage%, or FGA x archetype
 * weight before 1996), so a pass-first lead guard never reaches 0.5 on it. Before 1996 a Primary
 * Ball Handler needs 18+ FGA to clear it and the playmaking fallback tops out at 0.49, which
 * silently dropped Magic, Stockton, Kevin Johnson, Mark Price and Terry Porter (24 spans at O-TAL
 * 80+) out of `mismatchStructureScore` entirely (0 instead of ~60). An elite-passing Primary Ball
 * Handler runs the offense regardless of how many shots he takes himself.
 */
// 2026-09-30, engine calibration session 3 (the user: "popraw" — Lowry + Duncan and Conley + David
// Robinson read a pick-and-roll structure of 0): a pass-first Secondary Ball Handler at the
// point (Lowry, Conley — playmaking ~90) takes few shots, so his on-ball demand stays under 0.5
// and he never counted as the lead, leaving the five with no initiator at all.
function isElitePassFirstLead(player: PlayerSpan): boolean {
  return (
    (player.offensiveArchetype === 'Primary Ball Handler' || player.offensiveArchetype === 'Secondary Ball Handler') &&
    (playmakingScoreForPlayer(player) ?? 0) >= PNR_LEAD_PLAYMAKING
  );
}

function findLeadInitiator(
  starters: PlayerSpan[],
  demandByPlayer: number[],
): { player: PlayerSpan; index: number } | null {
  // Filter to QUALIFYING candidates first, THEN take the highest-demand one — not the other way
  // around. Picking the single highest-demand starter across the whole lineup and only then
  // checking whether THAT ONE player qualifies would miss a real Primary Ball Handler sitting
  // right there whenever a teammate (a high-usage Shot Creator forward, say) happens to carry
  // more raw on-ball weight without being a real initiator archetype themselves.
  return (
    starters
      .map((player, index) => ({ player, index }))
      .filter(({ player, index }) => isRealInitiator(player) && (demandByPlayer[index] >= 0.5 || isElitePassFirstLead(player)))
      .sort((a, b) => demandByPlayer[b.index] - demandByPlayer[a.index])[0] ?? null
  );
}

type StyleBucket = 'iso' | 'post' | 'pnr' | 'motion';
const STYLE_BUCKET: Partial<Record<OffensiveArchetype, StyleBucket>> = {
  'Shot Creator': 'iso',
  Slasher: 'iso',
  'Post Scorer': 'post',
  'Primary Ball Handler': 'pnr',
  'Secondary Ball Handler': 'pnr',
  'Off Screen Shooter': 'motion',
  'Movement Shooter': 'motion',
  'Athletic Finisher': 'motion',
};
const STYLE_LABEL: Record<StyleBucket, string> = {
  iso: 'isolation',
  post: 'post-up',
  pnr: 'pick-and-roll',
  motion: 'off-ball motion',
};

/**
 * @param demandByPlayer per-starter on-ball demand, index-aligned with `starters` — computed by
 *   `fitScore` (`starterOnBallDemand`), passed in rather than recomputed to avoid a circular import.
 */
export function pairwiseFitNotes(
  starters: PlayerSpan[],
  slots: Position[],
  demandByPlayer: number[],
): string[] {
  if (starters.length < 5) return [];
  const notes: string[] = [];
  const spacing = starters.map(teamSpacingValue);
  const plusShooter = starters.map(isPlusShooter);

  // 1. Two post-up hubs sharing the frontcourt — both operate from the block, the paint clogs
  //    and neither one spaces the floor for the other.
  const postHubs = starters.filter(
    (p, i) => p.offensiveArchetype === 'Post Scorer' && (slots[i] === 'PF' || slots[i] === 'C'),
  );
  if (postHubs.length >= 2) {
    notes.push(
      `${postHubs.map((p) => p.playerName).join(' and ')} are both post-up hubs in the same frontcourt — they want the same block and neither spaces the floor for the other.`,
    );
  }

  // 2. A drive-dependent hub with no shooting to kick to — help defense sits in the lane because
  //    leaving it costs nothing.
  starters.forEach((p, i) => {
    if (demandByPlayer[i] < 0.9 || spacing[i] >= DRIVE_HUB_SPACING_CEILING) return;
    const shootersAround = starters.filter((_, j) => j !== i && plusShooter[j]).length;
    if (shootersAround < 2) {
      notes.push(
        `${p.playerName} attacks off the dribble with ${shootersAround === 0 ? 'no' : 'only one'} plus-shooter alongside him — help defense never has to leave the paint.`,
      );
    }
  });

  // 3. A guard pick-and-roll lead paired with a center who camps the block — their preferred
  //    actions compete for the same space (the D2 Dončić + Shaq case). Gated on the center being
  //    a `Post Scorer` (wants the block, not the roll — a `Roll & Cut Big` is the *right* PnR
  //    partner) who genuinely doesn't space (SPC < POST_CENTER_SPACING_CEILING, so a
  //    three-shooting Embiid-type doesn't count).
  // Restricted to the PG slot specifically — matches this note's original, validated scope (a
  // wing initiator triggers the newer, generalized `mismatchStructureScore` below instead).
  const pgOnlyDemand = starters.map((_, i) => (slots[i] === 'PG' ? demandByPlayer[i] : -1));
  const pgLead = findLeadInitiator(starters, pgOnlyDemand);
  const postCenter = starters.find(
    (p, i) =>
      slots[i] === 'C' &&
      p.offensiveArchetype === 'Post Scorer' &&
      computeSpacing(p) < POST_CENTER_SPACING_CEILING &&
      // a high-post passing big (Gasol, Sabonis, Jokić-type) is a real pick-and-roll partner even
      // without a jumper — the tension is with a pure block-scorer who neither pops nor reads.
      (playmakingScoreForPlayer(p) ?? 0) < POST_CENTER_PASSING_EXEMPTION &&
      teamSpacingValue(p) < POST_CENTER_FACE_UP_FLOOR,
  );
  if (pgLead && postCenter) {
    notes.push(
      `${pgLead.player.playerName} is a pick-and-roll lead guard paired with a block-camping center (${postCenter.playerName}) — a screen-and-pop big and a back-to-the-basket scorer are different jobs.`,
    );
  }

  // 4. Two non-shooting roll bigs in the starting five — the 4 and 5 give the offense no floor
  //    spacing at all.
  const rollBigs = starters.filter(
    (p, i) => p.offensiveArchetype === 'Roll & Cut Big' && spacing[i] < HARD_NON_SPACER_SPC,
  );
  if (rollBigs.length >= 2) {
    notes.push(
      `${rollBigs.map((p) => p.playerName).join(' and ')} are both non-shooting roll bigs — the frontcourt offers the offense no floor spacing.`,
    );
  }

  // 5. The starting five wants to run several different offenses — off-ball motion, a post-up,
  //    a pick-and-roll and an iso creator all demanding primacy at once ("gra do kilku bramek").
  const systems = offensiveSystemBuckets(starters, demandByPlayer);
  if (systems.length >= 3) {
    notes.push(
      `The starting five commits to ${systems.length} different offensive systems at once (${systems.map((s) => STYLE_LABEL[s]).join(', ')}) — no single one gets enough reps to become the identity.`,
    );
  }

  return notes;
}

/**
 * The distinct offensive "systems" a starting five is committed to (pattern 5 above, extracted so
 * `fitScore` can also read it). A starter contributes their archetype's system only if they clear
 * `SYSTEM_MEMBER_OTAL` AND are either a real on-ball demand (>= 0.5) or a high-usage scorer
 * (`HIGH_USAGE_OTAL`). Returns the buckets, deduped.
 */
export function offensiveSystemBuckets(starters: PlayerSpan[], demandByPlayer: number[]): StyleBucket[] {
  const systems = new Set<StyleBucket>();
  starters.forEach((p, i) => {
    const bucket = STYLE_BUCKET[p.offensiveArchetype];
    if (!bucket) return;
    const otal = computeOffensiveTalent(p);
    if (otal < SYSTEM_MEMBER_OTAL) return;
    if (demandByPlayer[i] >= 0.5 || otal >= HIGH_USAGE_OTAL) systems.add(bucket);
  });
  return [...systems];
}

/**
 * Points to dock from `creationStructure` when a five over-commits to too many offensive systems
 * — 2026-09-05, user's call ("powinno to liczyć w fit"): the pattern-5 note was diagnostic-only;
 * a five running 3+ co-primary systems genuinely lacks an offensive identity in a playoff series.
 * `PENALTY_PER_EXTRA_SYSTEM` per system beyond 2, capped at `MAX_SYSTEM_OVERLOAD_PENALTY`.
 */
const PENALTY_PER_EXTRA_SYSTEM = 6;
const MAX_SYSTEM_OVERLOAD_PENALTY = 12;
/** Same real-demand bar `offensiveSystemBuckets` itself already gates on, reused below rather
 * than a second threshold. */
const HIGH_DEMAND_THRESHOLD = 0.5;

/**
 * 2026-09-23, user-reported live (Magic/Kobe/Pierce/Barkley starting five, Fit 79 despite four
 * ball-dominant starters): `offensiveSystemBuckets` dedupes by offensive STYLE — two Slashers (or
 * any same-archetype pair) collapse into one bucket, so a five stacked with same-archetype
 * ball-dominant players can under-count entirely and never trip this penalty, the exact opposite
 * of "too many players wanting the same job." Counting real on-ball demand directly alongside the
 * existing bucket-diversity count — taking whichever is larger — catches both failure shapes:
 * too many DIFFERENT systems (the original case) and too many players competing for the SAME one
 * (this one), without weakening the original check for the five it already worked correctly on.
 */
export function offensiveSystemOverloadPenalty(starters: PlayerSpan[], demandByPlayer: number[]): number {
  const distinctSystems = offensiveSystemBuckets(starters, demandByPlayer).length;
  const highDemandStarters = demandByPlayer.filter((d) => d >= HIGH_DEMAND_THRESHOLD).length;
  const count = Math.max(distinctSystems, highDemandStarters);
  if (count < 3) return 0;
  return Math.min(MAX_SYSTEM_OVERLOAD_PENALTY, (count - 2) * PENALTY_PER_EXTRA_SYSTEM);
}

/**
 * 2026-09-05, user's explicit follow-up to the matchup "hunting potential" work (`fit.ts`'s
 * `huntingPotentialFor`, `matchup.ts`'s `mismatchAdjustment`): those measure individual
 * playmaking/self-creation SKILL, already priced into `offenseScore` on their own terms (0.15 +
 * 0.10 weight). The user's own framing for a genuinely separate signal: "czy skład ma realną
 * STRUKTURĘ do wymuszania switchy (odpowiednie archetypy, spacing wymuszający przełączenia)
 * niezależnie od czystego playmakingu/scoringu" — does the ROSTER have real structure to force
 * switches, independent of any one player's rating. This reads the pairing and the shell around
 * it, not a skill number:
 *
 * 1. A real on-ball initiator (`findLeadInitiator`, generalized beyond the PG-only scope anti-
 *    pattern #3 above uses — a wing initiator like Harden/Luka runs just as much real ball-screen
 *    offense as a lead guard).
 * 2. Paired with a frontcourt screener whose own gravity forces an actual decision:
 *    - ROLL gravity: `Roll & Cut Big` / `Versatile Big` / `Post Scorer` credited for real rim
 *      pressure at or above `ROLL_GRAVITY_FLOOR` (switch onto the roller = post mismatch, stay =
 *      open rim). 2026-09-05, user-reported (Drużyna 3, Curry + Kareem read mismatchStructure 0):
 *      a `Post Scorer` who genuinely finishes at the rim IS a screen threat — Kareem catching a
 *      roll and skyhooking forces exactly the switch/drop decision this measures, even though his
 *      archetype tag is "back-to-the-basket scorer" not "roll man." The `rimPressureForFit >=
 *      floor` gate does the real work: a finesse/face-up post scorer (or a low-volume Roll & Cut
 *      Big like pre-shot-clock Bill Russell) that never actually threatens the rim reads below the
 *      floor and earns nothing here regardless of tag.
 *    - POP gravity: `Stretch Big` / `Versatile Big` / any plus-shooter big credited for real
 *      spacing (switch = mismatch on the perimeter, drop = open three).
 * 3. Scaled by the OTHER two starters' real spacing — a forced switch or a help rotation only
 *    gets punished if the floor around the action is actually spaced; a crowded floor absorbs it
 *    for free regardless of how good the two-man game is. (This is where a Curry + Kareem pairing
 *    lands moderate rather than elite — the action is real, the floor around it is cramped.)
 *
 * 2026-09-30, engine calibration session 4 (the user: "czasem mam wrażenie jakby był losowy"): this
 * used to be hard-gated — no qualifying initiator, or no big over a roll floor with the right tag,
 * and the whole component read 0 (Harden + Gasol + Kareem did), one tag away from 80. It is now
 * continuous: the best ball-screen runner on the floor leads, scaled by how real an initiator he
 * is; every frontcourt starter is a screener, credited for roll gravity (full for a roll/post
 * archetype, part for any other big) or pop gravity (his real spacing value), whichever is larger.
 */
const SURROUNDING_SPACING_WEIGHT = 0.4;
const ROLL_SCREENER_ARCHETYPES: readonly OffensiveArchetype[] = ['Roll & Cut Big', 'Versatile Big', 'Post Scorer'];
const OFF_ARCHETYPE_ROLL_SHARE = 0.6;
const UNTAGGED_POP_SHARE = 0.85;
/** A wing or guard screening in a five with no big in that spot — a real action, a lesser one. */
const NON_BIG_SCREENER_SHARE = 0.7;
const INITIATOR_ARCHETYPE_FACTOR: Partial<Record<OffensiveArchetype, number>> = {
  'Primary Ball Handler': 1,
  'Secondary Ball Handler': 0.9,
  'Shot Creator': 0.85,
  'Versatile Big': 0.75,
};
const OTHER_INITIATOR_FACTOR = 0.6;
const INITIATOR_QUALITY_FLOOR = 0.4;
const INITIATOR_QUALITY_FULL = 90;
/** A lead who can't shoot lets his man go under the screen (Ben Simmons): the action loses its
 * first threat. Full credit from `LEAD_SHOOTING_FULL` spacing value up. */
const LEAD_SHOOTING_FLOOR = 0.75;
const LEAD_SHOOTING_FULL = 60;

function initiatorRating(player: PlayerSpan): number {
  return (INITIATOR_ARCHETYPE_FACTOR[player.offensiveArchetype] ?? OTHER_INITIATOR_FACTOR) * (playmakingScoreForPlayer(player) ?? 40);
}

function screenerGravity(player: PlayerSpan, slot: Position): number {
  const roll = rimPressureForFit(player) * (ROLL_SCREENER_ARCHETYPES.includes(player.offensiveArchetype) ? 1 : OFF_ARCHETYPE_ROLL_SHARE);
  const popTagged = player.offensiveArchetype === 'Stretch Big' || player.offensiveArchetype === 'Versatile Big' || isPlusShooter(player);
  const pop = teamSpacingValue(player) * (popTagged ? 1 : UNTAGGED_POP_SHARE);
  return Math.max(roll, pop) * (slot === 'PF' || slot === 'C' ? 1 : NON_BIG_SCREENER_SHARE);
}

export function mismatchStructureScore(
  starters: PlayerSpan[],
  slots: Position[],
  _demandByPlayer: number[],
): number {
  if (starters.length < 5) return 0;
  const ratings = starters.map(initiatorRating);
  const leadIndex = ratings.indexOf(Math.max(...ratings));
  const hasBig = slots.some((slot, index) => index !== leadIndex && (slot === 'PF' || slot === 'C'));
  let bestGravity = 0;
  let screenerIndex = -1;
  starters.forEach((player, index) => {
    if (index === leadIndex) return;
    if (hasBig && slots[index] !== 'PF' && slots[index] !== 'C') return;
    const gravity = screenerGravity(player, slots[index]);
    if (gravity > bestGravity) {
      bestGravity = gravity;
      screenerIndex = index;
    }
  });
  if (screenerIndex < 0) return 0;
  const spacing = starters.map(teamSpacingValue);
  const surroundingValues = spacing.filter((_, index) => index !== leadIndex && index !== screenerIndex);
  const surroundingSpacing = surroundingValues.reduce((sum, value) => sum + value, 0) / surroundingValues.length;
  const structure = bestGravity * (1 - SURROUNDING_SPACING_WEIGHT) + surroundingSpacing * SURROUNDING_SPACING_WEIGHT;
  // 2026-09-30, engine calibration session 1 (the user: Nash + Malone and Stockton + Garnett are
  // the pick-and-roll everyone builds around, yet read like any initiator with any screener): the
  // pairing is only as dangerous as the man running it — scaled by the lead's own rating.
  const initiatorQuality = INITIATOR_QUALITY_FLOOR + (1 - INITIATOR_QUALITY_FLOOR) * Math.min(1, ratings[leadIndex] / INITIATOR_QUALITY_FULL);
  const leadShooting = LEAD_SHOOTING_FLOOR + (1 - LEAD_SHOOTING_FLOOR) * Math.min(1, spacing[leadIndex] / LEAD_SHOOTING_FULL);
  return Math.round(Math.min(100, structure) * initiatorQuality * leadShooting);
}
