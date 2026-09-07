export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export type OffensiveArchetype =
  | 'Primary Ball Handler'
  | 'Secondary Ball Handler'
  | 'Shot Creator'
  | 'Slasher'
  | 'Athletic Finisher'
  | 'Off Screen Shooter'
  | 'Movement Shooter'
  | 'Stationary Shooter'
  | 'Versatile Big'
  | 'Post Scorer'
  | 'Stretch Big'
  | 'Roll & Cut Big';

export type DefensiveRole =
  | 'Point of Attack'
  | 'Chaser'
  | 'Helper'
  | 'Wing Stopper'
  | 'Mobile Big'
  | 'Switch Big'
  | 'Anchor Big'
  | 'Post Defender'
  | 'Low Activity';

export interface BoxLine {
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  fgPct: number;
  threePct: number;
  threePA: number;
  ftPct: number;
  tsPct: number;
}

export interface PlayerSpan {
  id: string;
  playerName: string;
  spanLabel: string;
  primaryPosition: Position;
  secondaryPositions: Position[];
  fga: number;
  box: BoxLine;
  offensiveArchetype: OffensiveArchetype;
  defensiveRole: DefensiveRole;
}

/**
 * Experimental multi-role output. It intentionally does not live on `PlayerSpan`: keeping the
 * profile in a separate object makes the first rollout a true shadow model, so existing TAL,
 * AI, rotation and scoring code cannot start consuming it by accident.
 */
export type RoleFitConfidence = 'high' | 'medium' | 'low';

export interface RoleFitScore<Role extends string> {
  role: Role;
  score: number;
  confidence: RoleFitConfidence;
  evidence: string[];
}

export interface ShadowRoleProfile {
  version: 'role-fit-shadow-v1';
  playerId: string;
  incumbentOffensiveRole: OffensiveArchetype;
  incumbentDefensiveRole: DefensiveRole;
  offensiveFits: RoleFitScore<OffensiveArchetype>[];
  defensiveFits: RoleFitScore<DefensiveRole>[];
  proposedOffensiveRoles: RoleFitScore<OffensiveArchetype>[];
  proposedDefensiveRoles: RoleFitScore<DefensiveRole>[];
  warnings: string[];
}

export const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/**
 * Normalizes a player name for identity comparisons (dedup, exclusion checks) so that
 * e.g. "Nikola Jokić" and "Nikola Jokic" — the same real person, spelled with vs. without
 * diacritics depending on the data source — are recognized as one player. Strips accents
 * and lowercases; not meant for display.
 */
export function normalizePlayerName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * On-ball archetypes that "need the ball," weighted by how much stacking them actually
 * conflicts — per the Thinking Basketball "NBA Skill Sets" scalability framework, pure
 * isolation scoring has low scalability (only one guy can go 1-on-1 at a time), while
 * creation-oriented usage generates offense for teammates too and stacks more comfortably.
 * Shot Creator and Slasher get full weight; Primary Ball Handler (facilitation-heavy) gets
 * half, since two ball-handlers sharing playmaking duties is far less redundant than two
 * pure scorers each wanting their own isolations.
 *
 * 2026-08-05, user-diagnosed gap: `Secondary Ball Handler` (combo guards like Terry Porter —
 * real on-ball usage, just not primary-option volume) was missing from this map entirely,
 * reading as 0 — completely invisible to `aiDrafter.ts`'s redundancy discount no matter how much
 * usage a team already has, while `Primary Ball Handler` (Chris Paul-type) archetypes on
 * comparable or lower raw TAL got discounted in the exact same roster contexts. Confirmed this
 * was the concrete mechanism behind a repeated feedback pattern ("teams draft Porter over a
 * clearly-better-rated CP3"): not a TAL miscalibration (Porter's raw TAL is already lower than
 * CP3's), but Porter being structurally immune to a discount CP3 wasn't. Weighted below Primary
 * (0.25 vs 0.5) — a second combo guard sharing ball-handling duties conflicts even less than two
 * primaries sharing them, but it isn't zero conflict either.
 */
export const HIGH_USAGE_ARCHETYPE_WEIGHT: Partial<Record<OffensiveArchetype, number>> = {
  'Shot Creator': 1,
  Slasher: 1,
  'Primary Ball Handler': 0.5,
  'Secondary Ball Handler': 0.25,
};

/** Archetypes that space the floor for others. */
export const SPACING_ARCHETYPES: OffensiveArchetype[] = [
  'Off Screen Shooter',
  'Movement Shooter',
  'Stationary Shooter',
  'Stretch Big',
  'Versatile Big',
];

/** Defensive roles that anchor a defense at the rim. `Switch Big` is a rim role that ALSO holds
 * up on the perimeter — a switch-everything big (Draymond, Bam, peak AD/KG) is in both this list
 * and `PERIMETER_DEFENDER_ROLES`. */
export const RIM_PROTECTOR_ROLES: DefensiveRole[] = ['Anchor Big', 'Mobile Big', 'Switch Big'];

/** Defensive roles that hold up on the perimeter. */
export const PERIMETER_DEFENDER_ROLES: DefensiveRole[] = [
  'Point of Attack',
  'Wing Stopper',
  'Chaser',
  'Switch Big',
];
