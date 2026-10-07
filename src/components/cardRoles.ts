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
const REBOUNDER_PER_36 = 12;

/** Up to two style labels, offense first. */
export function cardRoles(span: PlayerSpan): string[] {
  const roles = [OFFENSE_LABEL[span.offensiveArchetype]];
  const defense = DEFENSE_LABEL[span.defensiveRole];
  if (defense) roles.push(defense);
  else if (per36(span.box.rpg, span) >= REBOUNDER_PER_36) roles.push('Rebounder');
  return roles;
}
