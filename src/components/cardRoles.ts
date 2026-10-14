import type { DefensiveRole, OffensiveArchetype, PlayerSpan } from '../data/schema';
import { per36 } from '../engine/minutesPerGame';

/**
 * 2026-10-07, the UI simplification (the user: "dużo graczy ma podobny TAL"): the draft card shows
 * what kind of player a stretch is instead of a TAL that reads 97-99 across the whole top of the
 * board. Style only — the audited offensive archetype and defensive role the engine already uses —
 * never a quality grade (those stay behind a scouting report).
 */
const OFFENSE_LABEL: Record<OffensiveArchetype, string> = {
  'Primary Ball Handler': 'Floor general',
  'Secondary Ball Handler': 'Playmaker',
  'Shot Creator': 'Shot creator',
  Slasher: 'Slasher',
  'Athletic Finisher': 'Finisher',
  'Off Screen Shooter': 'Off-screen shooter',
  'Movement Shooter': 'Movement shooter',
  'Stationary Shooter': 'Spot-up shooter',
  'Versatile Big': 'Playmaking big',
  'Post Scorer': 'Post scorer',
  'Stretch Big': 'Stretch big',
  'Roll & Cut Big': 'Roll man',
};

/** `Helper` / `Low Activity` are fallbacks, not a style worth a line on the card. */
const DEFENSE_LABEL: Partial<Record<DefensiveRole, string>> = {
  'Point of Attack': 'On-ball defender',
  Chaser: 'Ball hawk',
  'Wing Stopper': 'Wing stopper',
  'Anchor Big': 'Rim protector',
  'Mobile Big': 'Shot blocker',
  'Switch Big': 'Switchable big',
  'Post Defender': 'Post defender',
};

/** Rebounds per 36 that earn a "Rebounder" line when no defensive role does. */
const REBOUNDER_PER_36 = 11;
/** 2026-10-08 role audit (the user: "wszystko git"): two engine roles read too wide on a card.
 * A Mobile Big is a "Shot blocker" only with real block numbers (Dirk, Pau and Webber read wrong),
 * otherwise a "Mobile defender"; a Versatile Big is a "Playmaking big" only when he really passes
 * (the engine's 3.5 assists per 36 took in Malone, Carmelo, Siakam), otherwise a "Versatile big". */
const SHOT_BLOCKER_BLK_PER_36 = 1.8;
const PLAYMAKING_BIG_AST_PER_36 = 5;

/** Up to two style labels, offense first. */
export function cardRoles(span: PlayerSpan): string[] {
  let offense = OFFENSE_LABEL[span.offensiveArchetype];
  if (span.offensiveArchetype === 'Versatile Big' && per36(span.box.apg, span) < PLAYMAKING_BIG_AST_PER_36) offense = 'Versatile big';
  const roles = [offense];
  let defense = DEFENSE_LABEL[span.defensiveRole];
  if (span.defensiveRole === 'Mobile Big' && per36(span.box.bpg, span) < SHOT_BLOCKER_BLK_PER_36) defense = 'Mobile defender';
  if (defense) roles.push(defense);
  else if (per36(span.box.rpg, span) >= REBOUNDER_PER_36) roles.push('Rebounder');
  return roles;
}

/**
 * 2026-10-08 (the user: "po 1-2 rundach na boardzie zostają gracze na których nam nie zależy, i
 * trzeba długo szukać"): role filters for the draft board, built on the same style labels the cards
 * show — they find a kind of player, they don't judge fit.
 */
export const ROLE_FILTERS: Record<string, readonly string[]> = {
  Shooter: ['Spot-up shooter', 'Movement shooter', 'Off-screen shooter', 'Stretch big'],
  Creator: ['Shot creator', 'Slasher'],
  Playmaker: ['Floor general', 'Playmaker', 'Playmaking big'],
  'Rim protector': ['Rim protector', 'Shot blocker'],
  'Perimeter D': ['On-ball defender', 'Wing stopper', 'Ball hawk'],
  'Big man': ['Post scorer', 'Roll man', 'Rebounder', 'Versatile big', 'Post defender', 'Mobile defender', 'Switchable big'],
};

export function matchesRoleFilter(span: PlayerSpan, filter: string | null): boolean {
  if (!filter) return true;
  const wanted = ROLE_FILTERS[filter];
  return cardRoles(span).some((role) => wanted.includes(role));
}
