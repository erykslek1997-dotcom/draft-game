import type { PlayerSpan } from '../data/schema';
import { cutShare, movementShare } from './offBallProfile';
import { primaryStarters } from './rotation';
import { eraBaseline, LEAGUE_PACE_BASELINE } from './era';
import type { Team } from './types';
import { usageForSpan } from './usageLookup';
import { processEnv } from './env';

/**
 * 2026-11-06, the user ("heliocentryczni ofensywni zawodnicy ... najlepsi z piłką i poza nią nie
 * potrafią za bardzo dawać mocnej wartości"): two players who live on the ball cannot both have it.
 * The one with less of it plays off the ball, and his numbers were made on it. The cost is what he
 * cannot turn into off-ball value: spot-up shooting, movement off screens, cutting.
 *
 * Per starter: how heliocentric (`helioLoad`, usage% and the share of his makes he created himself)
 * and what he gives off the ball (`offBallValue`). The ball goes to the one who would lose most
 * without it; every other starter pays load x (1 - off-ball value). Harden + Westbrook (2019-20) 0.87, LeBron + Wade 0.4-0.7,
 * Curry + Durant near 0. Measured on 596 real team-seasons 1980+ (`scripts/_helio.ts`): the 44
 * with a cost missed their Overall by about -7 Overall a unit (a small sample, and real teams adapt,
 * Wade gave up the ball after 2012); half of that, the user: "spróbujmy".
 */
const env = processEnv ?? {};
export const HELIO = {
  usageFrom: 0.24,
  usageFull: 0.32,
  selfFrom: 0.35,
  selfFull: 0.65,
  selfUnknown: 0.6,
  perUnit: Number(env.HELIO_PER ?? 3.5),
  max: 5,
};
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

/** 0..1: how much of his game needs the ball (no real usage data, pre-1997 windows: 0). */
export function helioLoad(span: PlayerSpan): number {
  const u = usageForSpan(span);
  // No usage data (older windows): a read from shots on today's pace, as aiDrafter's `usageOf`,
  // and a lead scorer's self-creation.
  const usg = u?.usgPct ?? 0.1 + 0.009 * span.fga * (LEAGUE_PACE_BASELINE / eraBaseline(span.spanLabel).pace);
  const self = u ? 1 - u.assistedFgPct : HELIO.selfUnknown;
  return clamp((usg - HELIO.usageFrom) / (HELIO.usageFull - HELIO.usageFrom)) * clamp((self - HELIO.selfFrom) / (HELIO.selfFull - HELIO.selfFrom));
}

/** 0..1: what he gives without the ball — the best of catch-and-shoot threat (accuracy, not the
 * volume: Harden's pull-ups made his spacing read elite), movement and cutting. */
export function offBallValue(span: PlayerSpan): number {
  const shooter = clamp((span.box.threePct - 0.33) / 0.07) * clamp(span.box.threePA / 3);
  return clamp(Math.max(shooter, (cutShare(span) ?? 0) * 3, (movementShare(span) ?? 0) * 2.5));
}

export function heliocentricCost(starters: PlayerSpan[]): number {
  // The ball goes to whoever costs the others least without it (a coach's choice).
  const rows = starters.map((s) => ({ h: helioLoad(s), p: offBallValue(s) }));
  const all = rows.reduce((sum, r) => sum + r.h * (1 - r.p), 0);
  return rows.length < 2 ? 0 : Math.min(...rows.map((r) => all - r.h * (1 - r.p)));
}

/** Overall points (<= 0). */
export function heliocentricAdjustment(team: Team): number {
  const five = primaryStarters(team).map((s) => s.player).filter(Boolean) as PlayerSpan[];
  return -Math.min(HELIO.max, heliocentricCost(five) * HELIO.perUnit);
}
