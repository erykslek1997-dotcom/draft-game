import type { OffensiveArchetype, PlayerSpan, Position } from '../data/schema';
import { computeSpacing } from './spacing';
import { computeOffensiveTalent } from './talent';
import { isPlusShooter } from './shooting';
import { playmakingScoreForPlayer } from './playmakingLookup';
import { rimPressureForFit } from './rimPressure';

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
const POST_CENTER_PASSING_EXEMPTION = 70;
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
      .filter(({ player, index }) => demandByPlayer[index] >= 0.5 && isRealInitiator(player))
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
  const spacing = starters.map(computeSpacing);
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
      (playmakingScoreForPlayer(p) ?? 0) < POST_CENTER_PASSING_EXEMPTION,
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
  const systems = new Set<StyleBucket>();
  starters.forEach((p, i) => {
    const bucket = STYLE_BUCKET[p.offensiveArchetype];
    if (!bucket) return;
    const otal = computeOffensiveTalent(p);
    if (otal < SYSTEM_MEMBER_OTAL) return;
    if (demandByPlayer[i] >= 0.5 || otal >= HIGH_USAGE_OTAL) systems.add(bucket);
  });
  if (systems.size >= 3) {
    notes.push(
      `The starting five commits to ${systems.size} different offensive systems at once (${[...systems].map((s) => STYLE_LABEL[s]).join(', ')}) — no single one gets enough reps to become the identity.`,
    );
  }

  return notes;
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
 * 2. Paired with a frontcourt screener whose own gravity forces an actual decision: `Roll & Cut
 *    Big`/`Versatile Big` credited for real rim pressure (switch onto the roller = post
 *    mismatch, stay = open rim), `Stretch Big`/`Versatile Big`/any plus-shooter big credited for
 *    real spacing (switch = mismatch on the perimeter, drop = open three). A `Post Scorer` earns
 *    neither — camping the block is a real job, just not this one (mirrors anti-pattern #3's own
 *    gate, from the other side).
 * 3. Scaled by the OTHER two starters' real spacing — a forced switch or a help rotation only
 *    gets punished if the floor around the action is actually spaced; a crowded floor absorbs it
 *    for free regardless of how good the two-man game is.
 *
 * Hard-gated at 0 when there's no real initiator+screener pair at all — a genuine two-man action
 * either exists or it doesn't, there's no partial credit for "sort of."
 */
const SURROUNDING_SPACING_WEIGHT = 0.4;

export function mismatchStructureScore(
  starters: PlayerSpan[],
  slots: Position[],
  demandByPlayer: number[],
): number {
  if (starters.length < 5) return 0;
  const lead = findLeadInitiator(starters, demandByPlayer);
  if (!lead) return 0;

  const spacing = starters.map(computeSpacing);
  let bestGravity = 0;
  let screenerIndex = -1;
  starters.forEach((player, index) => {
    if (index === lead.index) return;
    if (slots[index] !== 'PF' && slots[index] !== 'C') return;
    let gravity = 0;
    if (player.offensiveArchetype === 'Roll & Cut Big' || player.offensiveArchetype === 'Versatile Big') {
      gravity = Math.max(gravity, rimPressureForFit(player));
    }
    if (player.offensiveArchetype === 'Stretch Big' || player.offensiveArchetype === 'Versatile Big' || isPlusShooter(player)) {
      gravity = Math.max(gravity, spacing[index]);
    }
    if (gravity > bestGravity) {
      bestGravity = gravity;
      screenerIndex = index;
    }
  });
  if (screenerIndex < 0 || bestGravity <= 0) return 0;

  const surroundingValues = spacing.filter((_, index) => index !== lead.index && index !== screenerIndex);
  const surroundingSpacing = surroundingValues.length > 0
    ? surroundingValues.reduce((sum, value) => sum + value, 0) / surroundingValues.length
    : 0;
  return Math.round(bestGravity * (1 - SURROUNDING_SPACING_WEIGHT) + surroundingSpacing * SURROUNDING_SPACING_WEIGHT);
}
