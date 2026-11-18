/**
 * 2026-11-18 (the user: archetypes rebuilt for this engine from the data): skills 0-100 for windows
 * from 1996-97 on (`scripts/buildSkills.ts` → `skills.json`, era percentiles). Engine rules move from a
 * label to a skill one use at a time, each behind its knob and measured.
 */
import type { PlayerSpan } from '../data/schema';
import { RIM_PROTECTOR_ROLES } from '../data/schema';
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
