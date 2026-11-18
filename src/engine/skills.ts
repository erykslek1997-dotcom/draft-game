/**
 * 2026-11-18 (the user: archetypes rebuilt for this engine from the data): skills 0-100 for windows
 * from 1996-97 on (`scripts/buildSkills.ts` → `skills.json`, era percentiles). Engine rules move from a
 * label to a skill one use at a time, each behind its knob and measured.
 */
import type { PlayerSpan } from '../data/schema';
import { RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../data/schema';
import skillsData from '../data/skills.json';
import { envVar } from './env';

const SKILLS = skillsData as Record<string, Record<string, number>>;
export type Skill = 'selfCreation' | 'handling' | 'rimPressure' | 'post' | 'roll' | 'spotUp' | 'stretch' | 'offBall' | 'offGlass' | 'rimProtect' | 'pointOfAttack' | 'activity' | 'help' | 'defGlass';
/** A window's skill (0-100), or null before 1996-97 / without the data. */
export function skill(span: { id: string }, key: Skill): number | null {
  return SKILLS[span.id]?.[key] ?? null;
}

/**
 * Rim protector: from 1996-97 on, rim-protection skill ≥ 93 — the threshold that keeps the share the
 * labels gave (7.8% of those windows); it adds shot-blockers the labels missed (McGee, Gafford,
 * Andersen, Kirilenko 2004-06) and drops switch bigs who don't guard the rim (Nenê, Hayes, Adebayo).
 * Before then, the label. On (the user, 2026-11-18): judges unchanged (Defense vs real DRtg 0.8046 both),
 * one rule in one place. `SKILL_RIM=0` = the label everywhere.
 */
const SKILL_RIM = envVar('SKILL_RIM') !== '0';
const RIM_SKILL_THRESHOLD = 93;
export function isRimProtector(span: { id: string; defensiveRole: string }): boolean {
  const v = SKILL_RIM ? skill(span, 'rimProtect') : null;
  return v === null ? RIM_PROTECTOR_ROLES.includes(span.defensiveRole as (typeof RIM_PROTECTOR_ROLES)[number]) : v >= RIM_SKILL_THRESHOLD;
}

/**
 * 2026-11-18 (the user: "dopracujemy defense"): perimeter defender. Point of attack alone (steals,
 * deflections) took in gamblers who hurt their team — Iverson, Monta Ellis, Arenas, Harden — so it is
 * blended with help (defense the team gets beyond his stocks): 0.5 × the lower of the two + 0.25 × each,
 * ≥ 66.75 (the threshold that keeps the label share, 17.1% of 1997+ windows), centers excluded. Drops
 * Iverson, Kobe 2004-07, McGrady, Harden, Westbrook; adds Giannis, Davis, Garnett, Mitchell. Before
 * 1996-97, the label. On (the user, 2026-11-18): Overall vs real SRS 0.8711 → 0.8717, Defense vs DRtg
 * 0.8046 both, AI rosters' weak backups at 10+ minutes 28% → 25%. `SKILL_PERIM=0` = the label.
 */
const SKILL_PERIM = envVar('SKILL_PERIM') !== '0';
const PERIM_SKILL_THRESHOLD = 66.75;
export function isPerimeterDefender(span: { id: string; defensiveRole: string; primaryPosition: string }): boolean {
  const poa = SKILL_PERIM ? skill(span, 'pointOfAttack') : null, help = SKILL_PERIM ? skill(span, 'help') : null;
  if (poa === null || help === null) return PERIMETER_DEFENDER_ROLES.includes(span.defensiveRole as (typeof PERIMETER_DEFENDER_ROLES)[number]);
  if (span.primaryPosition === 'C') return false;
  return 0.5 * Math.min(poa, help) + 0.25 * (poa + help) >= PERIM_SKILL_THRESHOLD;
}
