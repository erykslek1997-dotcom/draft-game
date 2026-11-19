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
 *  − each non-shooting playmaker (playmaking ≥ 85, spacing < 55) beside an on-ball engine
 *    (usage ≥ 0.5, handling ≥ 90) — 2026-11-19, LeBron + Draymond: the passing repeats   10
 *  − no floor general: the PG under 88 playmaking and nobody at 95+ (Kyrie at the point)
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
import { playmakingScoreForPlayer } from './playmakingLookup';

const W = Number(envVar('REVIEW_W') ?? 1);
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
  // A second playmaker who can't shoot, beside an on-ball engine (LeBron + Draymond): his passing
  // repeats what the engine already does, and off the ball he doesn't space.
  const engine = five.find((p) => use(p) >= 0.5 && s(p, 'handling', 0) >= 90);
  const extraPlaymakers = engine ? five.filter((p) => p !== engine && (playmakingScoreForPlayer(p) ?? 0) >= 85 && teamSpacingValue(p) < 55).length : 0;
  // 2026-11-19 (the user, Kyrie / Manu / Kawhi / Davis / Nenê: "brakuje floor generala na PG"):
  // nobody organizes — the point guard is no real playmaker (< 88) and no one else is an elite
  // one (95+, a LeBron / Jokić / Magic who runs it from anywhere).
  // No playmaking score (mostly before the tracking years): assists stand in — 7+ a game reads as a floor general.
  const pm = (p: PlayerSpan) => playmakingScoreForPlayer(p) ?? (p.box.apg >= 7 ? 95 : p.box.apg >= 5 ? 88 : 70);
  const pgs = five.filter((p) => p.primaryPosition === 'PG');
  const noFloorGeneral = (pgs.length === 0 || Math.max(...pgs.map(pm)) < 88) && Math.max(...five.map(pm)) < 95 ? 1 : 0;
  const nonShootBigs = five.filter((p) => isBig(p) && teamSpacingValue(p) < 30 && use(p) < 0.35).length;
  return {
    paintCrowd: paint >= 2 ? paint - 1 : 0,
    threeBall: ball >= 3 ? ball - 2 : 0,
    offBallNoShot,
    secondWeakPerim: Math.max(0, weakPerim - 1),
    benchStarter: bench,
    extraPlaymaker: extraPlaymakers,
    noFloorGeneral,
    eliteShooterCover: eliteShooter ? Math.min(2, nonShootBigs) : 0,
  };
}

export function reviewAdjustment(five: PlayerSpan[]): number {
  if (W === 0 || five.length < 5) return 0;
  const h = reviewRuleHits(five);
  return W * (h.eliteShooterCover - h.paintCrowd - h.threeBall - h.offBallNoShot - h.secondWeakPerim - h.benchStarter - h.extraPlaymaker - h.noFloorGeneral);
}
