import { ERA_MASK } from './eraMask';
import skillsMaskedData from '../data/skillsMasked.json';
/**
 * 2026-11-18 (the user: archetypes rebuilt for this engine from the data): skills 0-100 for windows
 * from 1996-97 on (`scripts/buildSkills.ts` → `skills.json`, era percentiles). Engine rules move from a
 * label to a skill one use at a time, each behind its knob and measured.
 */
import type { PlayerSpan } from '../data/schema';
import { RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES } from '../data/schema';
import skillsData from '../data/skills.json';
import skillsPreData from '../data/skillsPre.json';
import { envVar } from './env';

const SKILLS = skillsData as Record<string, Record<string, number>>;
/** 2026-11-18: windows before 1996-97 (`scripts/buildSkillsPre.ts`: models on box + advanced fitted on
 * 1997+, a bridge through the player's own 1997+ windows, ranked within the era; hold-out r 0.84-0.98,
 * three-based skills left out before 1979-80, help without the advanced numbers left out).
 * On (2026-11-18, all from data): judges unchanged, AI rosters' spread 2.84 → 2.96. `SKILL_PRE=0` =
 * no skills before 1996-97 (every rule keeps its label there). */
const SKILL_PRE = envVar('SKILL_PRE') !== '0';
const PRE = skillsPreData as Record<string, Record<string, number>>;
const MASKED = skillsMaskedData as Record<string, Record<string, number>>;
export type Skill = 'selfCreation' | 'handling' | 'rimPressure' | 'post' | 'roll' | 'spotUp' | 'pullUp3' | 'stretch' | 'offBall' | 'offGlass' | 'rimProtect' | 'pointOfAttack' | 'activity' | 'help' | 'defGlass';
/** A window's skill (0-100), or null before 1996-97 / without the data. */
export function skill(span: { id: string }, key: Skill): number | null {
  if (ERA_MASK && MASKED[span.id]) return MASKED[span.id][key] ?? null;
  return SKILLS[span.id]?.[key] ?? (SKILL_PRE ? PRE[span.id]?.[key] ?? null : null);
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

/**
 * 2026-11-18 (measuring): the role part of a player's switchability in Fit (40% of it, from a role-tag
 * table: Point of Attack 100 … Low Activity 20). No data says who switched onto whom, so the stand-in
 * for 1997+ windows is 0.6 point of attack + 0.4 help, set to the table's mean (53.6) and spread (32.3)
 * over those windows, 0-100. On (the user, 2026-11-18): engine judges unchanged, the game's defense vs
 * real DRtg 0.7786 → 0.7796, real fives' defense in the sim 0.557 → 0.562. `SKILL_SWITCH=0` = the table.
 */
const SKILL_SWITCH = envVar('SKILL_SWITCH') !== '0';
export function switchRoleScore(span: { id: string }): number | null {
  if (!SKILL_SWITCH) return null;
  const poa = skill(span, 'pointOfAttack'), help = skill(span, 'help');
  if (poa === null || help === null) return null;
  return Math.max(0, Math.min(100, 53.61 + ((0.6 * poa + 0.4 * help - 49.64) * 32.27) / 22.44));
}

/**
 * 2026-11-18 (measuring): "Low Activity" — a defender a team hides. For 1997+ windows: activity and
 * help averaged below 44.5, the threshold that keeps the label share (41.8%). Takes in Kobe 2004-13,
 * Iverson, McGrady, Westbrook 2016-18; lets out the near-misses Curry, Booker, Lillard (45-55).
 * Before 1996-97, the label. On (the user, 2026-11-18): judges unchanged (D-TAL 0.824 → 0.825).
 * `SKILL_LOWACT=0` = the label.
 */
const SKILL_LOWACT = envVar('SKILL_LOWACT') !== '0';
export function isLowActivity(span: { id: string; defensiveRole: string }): boolean {
  const act = SKILL_LOWACT ? skill(span, 'activity') : null, help = SKILL_LOWACT ? skill(span, 'help') : null;
  if (act === null || help === null) return span.defensiveRole === 'Low Activity';
  return 0.5 * act + 0.5 * help < 44.5;
}

/**
 * 2026-11-18 (the user: "self creation a creation to dwie różne rzeczy"): the old creator tags mixed
 * making your own shot (Shot Creator, Slasher) with making the offense for others (Primary / Secondary
 * Ball Handler). Two weights from 1997+ skills, each at the label shares:
 *  - selfCreatorLevel  1 / 0.85 / 0.8 / 0.55 / 0 at self-creation ≥ 95 / 89 / 85 / 76 (the shares of
 *    Shot Creator / Primary BH / Slasher / Secondary BH / the rest)
 *  - isPlaymaker       handling ≥ 86 (the share of Primary + Secondary BH, 13.9%); primary ≥ 95 (5.0%)
 * On, smooth (the user, 2026-11-18: "jak wszystko z danych to wszystko"): judges unchanged.
 * `SKILL_CREATE=1` the threshold variant, `=0` the labels; null / the label before 1996-97.
 */
const SKILL_CREATE = envVar('SKILL_CREATE') !== '0';
/** `SKILL_CREATE=2`: the smooth variant — handling relieves the shot-first cost gradually and a bench
 * creator needs handling ≥ 80 (Kobe, McGrady count as part playmakers). */
const CREATE_SMOOTH = envVar('SKILL_CREATE') !== '1';
const SELF_LEVELS: [number, number][] = [[95, 1], [89, 0.85], [85, 0.8], [76, 0.55]];
export function selfCreatorLevel(span: { id: string }): number | null {
  const v = SKILL_CREATE ? skill(span, 'selfCreation') : null;
  if (v === null) return null;
  return SELF_LEVELS.find(([t]) => v >= t)?.[1] ?? 0;
}
export function isPlaymaker(span: { id: string; offensiveArchetype: string }, primary = false): boolean {
  const v = SKILL_CREATE ? skill(span, 'handling') : null;
  if (v === null) return primary ? span.offensiveArchetype === 'Primary Ball Handler' : span.offensiveArchetype === 'Primary Ball Handler' || span.offensiveArchetype === 'Secondary Ball Handler';
  return v >= (primary ? 95 : 86);
}
/** Shot first: makes his own shot (level ≥ 0.8) and is not a playmaker — the old Shot Creator / Slasher. */
export function isShotFirst(span: { id: string; offensiveArchetype: string }): boolean {
  const lvl = selfCreatorLevel(span);
  if (lvl === null) return span.offensiveArchetype === 'Shot Creator' || span.offensiveArchetype === 'Slasher';
  return CREATE_SMOOTH ? lvl >= 0.8 : lvl >= 0.8 && !isPlaymaker(span);
}
/** Smooth variant: the share of a shot-first scorer's cost his passing takes away — 0 at handling 70, all at 95. */
export function playmakingRelief(span: { id: string }): number {
  const h = CREATE_SMOOTH ? skill(span, 'handling') : null;
  return h === null ? 0 : Math.max(0, Math.min(1, (h - 70) / 25));
}
/** A creator of either kind (the old Primary BH / Secondary BH / Shot Creator set). */
export function isCreator(span: { id: string; offensiveArchetype: string }): boolean {
  const lvl = selfCreatorLevel(span);
  if (lvl === null) return ['Primary Ball Handler', 'Secondary Ball Handler', 'Shot Creator'].includes(span.offensiveArchetype);
  if (CREATE_SMOOTH) return lvl >= 0.85 || (skill(span, 'handling') ?? 0) >= 80;
  return lvl >= 0.85 || isPlaymaker(span);
}

/**
 * 2026-11-18 (measured: spacing's self-creation credit from self-creation as a whole gave non-shooting
 * high-usage bigs a shooter's credit — Antoine Walker 33 → 76, Embiid, Randle at 30-33% from three):
 * the level spacing reads comes from threes made off his own dribble instead, at the label shares
 * (94 / 89 / 85 / 76 → 1 / 0.85 / 0.8 / 0.55). On: raw offense vs real ORtg 0.7674 against the
 * labels' 0.7678 (odd seasons 0.7776 / 0.7775); a 27-setting search of the credit's constants found
 * nothing that held out of sample. `SKILL_PULLUP=0` = the label.
 */
const SKILL_PULLUP = envVar('SKILL_PULLUP') !== '0';
const PULLUP_LEVELS: [number, number][] = [[94, 1], [89, 0.85], [85, 0.8], [76, 0.55]];
export function pullUpLevel(span: { id: string }): number | null {
  const v = SKILL_PULLUP ? skill(span, 'pullUp3') : null;
  if (v === null) return null;
  return PULLUP_LEVELS.find(([t]) => v >= t)?.[1] ?? 0;
}

/**
 * 2026-11-18 (measuring): a spacer for O-POR's spacing bonus (was: the Stationary / Movement / Off
 * Screen Shooter, Stretch / Versatile Big tags). For 1997+ windows, stretch ≥ 67 — the label share
 * (32.1%). Adds Curry 2020-22, Harden, Doncic, Edwards; drops Giannis, LeBron 2021-23, Embiid 2021-23.
 * On (2026-11-18, all from data): judges unchanged (raw offense 0.7672 vs 0.7674). `SKILL_SPACER=0` =
 * the label; before 1996-97, the label.
 */
const SKILL_SPACER = envVar('SKILL_SPACER') !== '0';
export function isSpacer(span: { id: string; offensiveArchetype: string }, labels: readonly string[]): boolean {
  const v = SKILL_SPACER ? skill(span, 'stretch') : null;
  return v === null ? labels.includes(span.offensiveArchetype) : v >= 67;
}

/**
 * 2026-11-18 (the user's review, principle 9 "limit piłki"; labels → data): how much of the ball a
 * player takes, on the scale `HIGH_USAGE_ARCHETYPE_WEIGHT` used (Shot Creator / Slasher 1, Primary
 * Ball Handler 0.5, Secondary 0.25). From his real USG% (NBA tracking 1996-97 on, else
 * Basketball-Reference, 1977-78 on) times how much of it he makes himself (1 − assisted FG%, else
 * the selfCreation skill), the demand `fit.ts` already reads for 1996-97 on, ÷ 0.571 — the mean
 * demand of the spans labelled Shot Creator, so a typical one still reads 1. Post scorers, which
 * the label left at 0, read 0.59 on average. `SKILL_USAGE=1` turns it on; else (or without USG%)
 * the label weight.
 */
import { usageForSpan } from './usageLookup';
import leaguePtsData from '../data/leaguePointsPerGame.json';
import { estimatedMinutesPerGame } from './minutesPerGame';
import { spanEndYears } from './era';
import { realSpan } from './realAdvancedLookup';
import { HIGH_USAGE_ARCHETYPE_WEIGHT } from '../data/schema';
const SKILL_USAGE = envVar('SKILL_USAGE') === '1';
const SHOT_CREATOR_MEAN_DEMAND = 0.571;
/**
 * 2026-11-26 (the user's center brief: Kareem 1971-73 read as a low-usage screening big — no USG% before
 * 1977-78, so every rule took the 0.3 default and he got the elite-shooter-cover credit and none of the
 * paint / three-ball costs): `USG_EST=1` estimates USG% where it is missing from points a 36 minutes over
 * the league's points a game, plus assists a 36 (scripts/_usgfit.ts: 8,029 windows, fit on 1997+, hold-out
 * r 0.89 on 1978-96).
 */
const USG_EST = envVar('USG_EST') !== '0';
const LEAGUE_PTS = leaguePtsData as Record<string, number>;
function estimatedUsage(span: PlayerSpan): number {
  const ys = spanEndYears(span.spanLabel);
  const lg = LEAGUE_PTS[String(ys[Math.floor(ys.length / 2)])];
  const mpg = estimatedMinutesPerGame(span);
  if (!lg || !mpg || mpg < 10) return NaN;
  return 0.0301 + (1.027 * (span.box.ppg * 36) / mpg) / lg + (0.0023 * span.box.apg * 36) / mpg;
}
export function dataUsageDemand(span: PlayerSpan): number | null {
  const u = usageForSpan(span);
  let usg = u?.usgPct ?? ((realSpan(span) as { usg?: number } | null)?.usg ?? NaN) / 100;
  if (!Number.isFinite(usg) && USG_EST) usg = estimatedUsage(span);
  if (!Number.isFinite(usg)) return null;
  const self = u ? 1 - u.assistedFgPct : (skill(span, 'selfCreation') ?? 50) / 100;
  return Math.min(1.3, Math.max(0, (usg - 0.14) / 0.2)) * (0.5 + 0.5 * self);
}
export function usageWeight(span: PlayerSpan): number {
  const d = SKILL_USAGE ? dataUsageDemand(span) : null;
  return d !== null ? Math.min(1.5, d / SHOT_CREATOR_MEAN_DEMAND) : HIGH_USAGE_ARCHETYPE_WEIGHT[span.offensiveArchetype] ?? 0;
}
/** A bench scorer who goes and gets his own shot: the selfCreation skill (level ≥ 0.85), else the label. */
export function isSelfCreatorFull(span: PlayerSpan): boolean {
  const lvl = SKILL_USAGE ? selfCreatorLevel(span) : null;
  return lvl !== null ? lvl >= 0.85 : (HIGH_USAGE_ARCHETYPE_WEIGHT[span.offensiveArchetype] ?? 0) >= 1;
}
