/**
 * 2026-11-18 (the user's draft review, docs/lineup-principles.md): the five-man rules the user reads
 * in an all-time five, read off the skills, each worth `REVIEW_W` overall points (0 = off).
 * Measured first on real NBA units (`measureLineups.ts`, 150+ minutes since 2007-08): every one's
 * direction agrees with the user and none is clear of noise (−0.3 to −0.4 net per 100; the elite
 * shooter +0.65) — real teams rarely build these conflicts, so the weights are set on the user's
 * control lineups (`scripts/controlCases.ts`), small enough to leave the judges alone.
 *
 *  − a crowded paint: two ball-holding rim players without a spot-up shot
 *    (rim pressure ≥ 85, spot-up < 40, usage ≥ 0.45)       principle 8 (Wade + Giannis, Embiid + Duncan)
 *  − three ball-dominant players (usage demand ≥ 0.42)     9
 *  − each off-ball guard / wing without a shot             1a
 *  − a second weak perimeter defender (D-TAL < 40)         3a
 *  − a bench-calibre starter (TAL < 70, or a wing at O < 50) 2a
 *  + an on-ball elite pull-up shooter (pullUp3 ≥ 98, usage ≥ 0.5) — he spaces for everyone, so non-shooting screening bigs (usage < 0.35) beside
 *    him stop costing (6: "Curry swoim rzutem wszystko rozwiązuje")
 */
import type { PlayerSpan } from '../data/schema';
import { envVar } from './env';
import { skill, dataUsageDemand } from './skills';
import { computeDefensiveTalent } from './defensiveTalent';
import { effectiveTalent } from './grades';
import { computeOffensiveTalent } from './talent';
import { teamSpacingValue } from './midrangeGravity';

const W = Number(envVar('REVIEW_W') ?? 0);
const isBig = (p: PlayerSpan) => p.primaryPosition === 'PF' || p.primaryPosition === 'C';
const s = (p: PlayerSpan, k: Parameters<typeof skill>[1], d = 50) => skill(p, k) ?? d;

export function reviewRuleHits(five: PlayerSpan[]): Record<string, number> {
  const use = (p: PlayerSpan) => dataUsageDemand(p) ?? 0.3;
  // The post skill reads a zone, not post-ups (Nash 97, Shaq 9), so the paint is read as rim
  // pressure without a spot-up shot, on a player who holds the ball: Shaq, Embiid, Duncan, Davis,
  // Giannis, Wade.
  const paint = five.filter((p) => s(p, 'rimPressure', 0) >= 85 && s(p, 'spotUp') < 40 && use(p) >= 0.45).length;
  const ball = five.filter((p) => use(p) >= 0.42).length;
  const offBallNoShot = five.filter((p) => !isBig(p) && use(p) < 0.3 && teamSpacingValue(p) < 35).length;
  const weakPerim = five.filter((p) => !isBig(p) && computeDefensiveTalent(p) < 40).length;
  const bench = five.filter((p) => effectiveTalent(p) < 70 || (!isBig(p) && computeOffensiveTalent(p) < 50)).length;
  const eliteShooter = five.some((p) => s(p, 'pullUp3', 0) >= 98 && use(p) >= 0.5);
  const nonShootBigs = five.filter((p) => isBig(p) && teamSpacingValue(p) < 30 && use(p) < 0.35).length;
  return {
    paintCrowd: paint >= 2 ? paint - 1 : 0,
    threeBall: ball >= 3 ? ball - 2 : 0,
    offBallNoShot,
    secondWeakPerim: Math.max(0, weakPerim - 1),
    benchStarter: bench,
    eliteShooterCover: eliteShooter ? Math.min(2, nonShootBigs) : 0,
  };
}

export function reviewAdjustment(five: PlayerSpan[]): number {
  if (W === 0 || five.length < 5) return 0;
  const h = reviewRuleHits(five);
  return W * (h.eliteShooterCover - h.paintCrowd - h.threeBall - h.offBallNoShot - h.secondWeakPerim - h.benchStarter);
}
