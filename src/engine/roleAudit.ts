import type { DefensiveRole, OffensiveArchetype, PlayerSpan } from '../data/schema';
import { per36 } from './minutesPerGame';
import { computeDefensiveTalent } from './defensiveTalent';
import { computeSpacing } from './spacing';
import { getBodyWeightLbs, getHeightInches } from '../data/heightLookup';
import { athleticismScoreForSpan } from './athleticismLookup';

/**
 * 2026-10-02, user-approved role audit ("trzeba zrobić większy audyt przypisanych ról"). Every
 * defensive role and offensive archetype is checked against per-36 numbers:
 *
 * - the CURRENT label stays when the numbers do not contradict it (its gate, checked with slack,
 *   so a player on a threshold does not flip between neighbouring windows);
 * - otherwise the first label whose strict gate passes takes over;
 * - `Helper` / `Low Activity` are fallbacks: a specific defensive role passing its strict gate
 *   replaces them.
 *
 * Pre-1973 defense keeps its label (no steals/blocks). The result is baked into
 * `src/data/roleAudit.json` by `scripts/buildRoleAudit.ts` and applied at load time; manual
 * overrides are excluded there.
 */

const startYear = (s: PlayerSpan) => Number.parseInt(s.spanLabel.slice(0, 4), 10);
const isBig = (s: PlayerSpan) => s.primaryPosition === 'PF' || s.primaryPosition === 'C';
const isGuard = (s: PlayerSpan) => s.primaryPosition === 'PG' || s.primaryPosition === 'SG';

export interface RoleAuditStats {
  blk: number; stl: number; reb: number; ast: number; fga: number; pts: number; tpa: number; tp: number;
  dtal: number; height: number; weight: number; athleticism: number | null; spacing: number;
  /** Off Screen / Movement Shooter the play-by-play-backed shadow role fit supports, if any. */
  measuredShooter?: OffensiveArchetype;
}

export function roleAuditStats(s: PlayerSpan, measuredShooter?: OffensiveArchetype): RoleAuditStats {
  return {
    measuredShooter,
    blk: per36(s.box.bpg, s), stl: per36(s.box.spg, s), reb: per36(s.box.rpg, s),
    ast: per36(s.box.apg, s), fga: per36(s.fga ?? 0, s), pts: per36(s.box.ppg, s),
    tpa: per36(s.box.threePA ?? 0, s), tp: s.box.threePct ?? 0,
    dtal: computeDefensiveTalent(s), height: getHeightInches(s.playerName) ?? 0, weight: getBodyWeightLbs(s.playerName) ?? 0,
    athleticism: athleticismScoreForSpan(s), spacing: computeSpacing(s),
  };
}

/** `k` = 0 strict gates, 1 the slack used to keep the current label. */
function defenseCandidates(s: PlayerSpan, x: RoleAuditStats, k: number): DefensiveRole[] {
  const d = x.dtal + 4 * k, stl = x.stl + 0.15 * k, blk = x.blk + 0.15 * k;
  const out: DefensiveRole[] = [];
  if (isBig(s)) {
    if (blk >= 1.8 && d >= 70) out.push('Anchor Big');
    if (blk >= 1.2 && d >= 60 && (x.athleticism === null || x.athleticism >= 50 || stl >= 0.9)) out.push('Mobile Big');
    if (d >= 70 && stl >= 1.2 && blk >= 0.8) out.push('Switch Big');
    if (d >= 50 && x.weight >= 235 - 10 * k && blk < 1.8 + 0.3 * k) out.push('Post Defender');
    if (d >= 62 && x.height > 0 && x.height <= 80 + 3 * k && stl >= 1.1 - 0.25 * k) out.push('Wing Stopper');
    if (d >= 50 && stl >= 1.4 && s.primaryPosition === 'PF') out.push('Chaser');
    if (out.length === 0 || k > 0) out.push(d >= 45 || x.reb >= 8 ? 'Helper' : 'Low Activity');
    return out;
  }
  const wingStopper = d >= 62 && (x.height === 0 || x.height >= 77);
  const pointOfAttack = isGuard(s) && ((d >= 62 && stl >= 1.3) || d >= 75);
  const chaser = stl >= 1.4 && d >= 50;
  if (isGuard(s)) {
    if (pointOfAttack) out.push('Point of Attack');
    if (wingStopper) out.push('Wing Stopper');
  } else if (wingStopper) out.push('Wing Stopper');
  if (chaser) out.push('Chaser');
  if (out.length === 0 || k > 0) out.push(d >= 42 ? 'Helper' : 'Low Activity');
  if (k > 0 && d < 50) out.push('Low Activity');
  return out;
}

function offenseCandidates(s: PlayerSpan, x: RoleAuditStats, k: number): OffensiveArchetype[] {
  const ast = x.ast + 0.75 * k, fga = x.fga + k, pts = x.pts + 1.5 * k, tpa = x.tpa + 0.5 * k, tp = x.tp + 0.02 * k;
  const out: OffensiveArchetype[] = [];
  if (isBig(s)) {
    // A high-volume four who takes threes but cannot make them (Giannis) attacks the rim off the
    // dribble: Slasher, not Shot Creator. A four who never shoots threes (Karl Malone) is a post
    // player and falls through to the big archetypes below.
    const poorShooter = startYear(s) >= 1980 && x.tp < 0.32;
    if (s.primaryPosition === 'PF' && fga >= 15 && x.tpa >= 1.5 && x.tpa < 5 + k && poorShooter) out.push('Slasher');
    if (s.primaryPosition === 'PF' && fga >= 17 && pts >= 22 && (tpa >= 2 || k > 0) && !poorShooter) out.push('Shot Creator');
    if (ast >= 3.5) out.push('Versatile Big');
    if ((tpa >= 3 && tp >= 0.34) || (k > 0 && x.tpa >= 1.5 && x.tp >= 0.36)) out.push('Stretch Big');
    if (fga >= 12 && x.tpa < 1.5 + 0.5 * k) out.push('Post Scorer');
    if (x.fga < 12 + k && x.tpa < 1.5 + 0.5 * k) out.push('Roll & Cut Big');
    if (k > 0 && s.primaryPosition === 'PF' && fga >= 13 && x.tpa < 3 + 1.5 * k) out.push('Slasher');
    // A big who handles keeps a big archetype; handling only shows as an extra label.
    if (ast >= 7 && fga >= 12) out.push('Primary Ball Handler');
    else if (ast >= 5) out.push('Secondary Ball Handler');
    if (out.length === 0) out.push(x.fga >= 12 ? 'Post Scorer' : 'Roll & Cut Big');
    return out;
  }
  const curatedShooter = s.offensiveArchetype === 'Movement Shooter' || s.offensiveArchetype === 'Off Screen Shooter';
  if (ast >= 7 && fga >= 12) out.push('Primary Ball Handler');
  if (fga >= 17 && pts >= 22) out.push('Shot Creator');
  if (ast >= 4.5 && !out.includes('Primary Ball Handler')) out.push('Secondary Ball Handler');
  if (curatedShooter && tpa >= 3) out.push(s.offensiveArchetype);
  else if (x.measuredShooter && tpa >= 3) out.push(x.measuredShooter);
  if (fga >= 13 && x.tpa < 3 + k) out.push('Slasher');
  if (tpa >= 5 && tp >= 0.36 && x.ast < 4.5 + 0.5 * k) out.push('Stationary Shooter');
  if (out.length === 0 || k > 0) out.push(x.spacing >= 60 - 5 * k ? 'Stationary Shooter' : 'Athletic Finisher');
  if (k > 0) out.push('Athletic Finisher');
  return out;
}

function keepOrReplace<Role extends string>(current: Role, strict: Role[], loose: Role[]): Role[] {
  const main = loose.includes(current) ? current : strict[0];
  return [main, ...strict.filter((role) => role !== main)];
}

/** Audited defensive roles, strongest first; the first entry is the primary label. */
export function auditedDefensiveRoles(s: PlayerSpan, x: RoleAuditStats = roleAuditStats(s)): DefensiveRole[] {
  if (startYear(s) < 1973) return [s.defensiveRole];
  const strict = defenseCandidates(s, x, 0);
  const fallback = s.defensiveRole === 'Helper' || s.defensiveRole === 'Low Activity';
  if (fallback && strict[0] !== 'Helper' && strict[0] !== 'Low Activity') return strict;
  return keepOrReplace(s.defensiveRole, strict, defenseCandidates(s, x, 1));
}

/** Audited offensive archetypes, strongest first; the first entry is the primary label. */
export function auditedOffensiveArchetypes(s: PlayerSpan, x: RoleAuditStats = roleAuditStats(s)): OffensiveArchetype[] {
  return keepOrReplace(s.offensiveArchetype, offenseCandidates(s, x, 0), offenseCandidates(s, x, 1));
}
