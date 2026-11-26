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
import { ballShare } from './ballHandling';
import { computeDefensiveTalent } from './defensiveTalent';
import { effectiveTalent } from './grades';
import { computeOffensiveTalent } from './talent';
import { teamSpacingValue } from './midrangeGravity';
import { playmakingScoreForPlayer } from './playmakingLookup';

const W = Number(envVar('REVIEW_W') ?? 1);
const REV_DROP = (envVar('REV_DROP') ?? '').split(',').filter(Boolean);
// 2026-11-19 (the user, Curry + Wade + Draymond: "zbyt mocny duet żeby to nie działało"): an elite
// spot-up shooter (Curry) plays off the ball, so he is not a third ball-holder, and beside him a
// second playmaker is the point forward he needs, not a repeat. A co-star scorer (usage 0.5+) is
// never an "extra playmaker".
const REV_STAR = envVar('REV_STAR') !== '0';
// 2026-11-21 (the user: Porter and Pierce shoot threes, they play off the ball): the spot-up level that takes a
// player out of the ball-holder count (90 = only a Curry; 65 = any real catch-and-shoot threat).
const REV_OFFBALL_SPOT = Number(envVar('REV_OFFBALL_SPOT') ?? 80);
// 2026-11-21: the usage that makes a ball-holder for the "three with the ball" rule (J. Williams 0.43).
const REV_BALL_USE = Number(envVar('REV_BALL_USE') ?? 0.5);
const REV_PAINT = envVar('REV_PAINT') ?? 'mid';
const REV_BENCH_3D = envVar('REV_BENCH_3D') !== '0';
const REV_PM_SPC = Number(envVar('REV_PM_SPC') ?? 80);
const REV_PM_ENGINE = Number(envVar('REV_PM_ENGINE') ?? 0.45);
const isBig = (p: PlayerSpan) => p.primaryPosition === 'PF' || p.primaryPosition === 'C';
// 2026-11-26 (the user's center brief: Kareem 1971-73 escaped the paint-crowd rule on the missing spot-up
// skill read as 50): with `REV_SPOT_EST=1` a window without the three-based skill (before 1979-80) reads its
// spot-up from the spacing the engine plays (teamSpacingValue, the same 0-100 scale).
// 2026-11-26 (`REV_BALL_SRC`, 'use' = as before; the user: USG counts a cut finished off a pass): 'share' reads
// how much a player holds the ball — his ball share (USG% and AST%: Stockton, Magic, Jokic hold it by passing),
// 0 at 0.15 and full at 0.25 — and, for a big, his own scoring load as well (a post-up starts with a pass too:
// Shaq, Duncan); graded, the three-ball count is their sum. Off-ball stars stay out.
const REV_BALL_SRC = envVar('REV_BALL_SRC') ?? 'share';
const REV_SPOT_EST = envVar('REV_SPOT_EST') !== '0';
const s = (p: PlayerSpan, k: Parameters<typeof skill>[1], d = 50) => skill(p, k) ?? (REV_SPOT_EST && k === 'spotUp' ? teamSpacingValue(p) : d);

export function reviewRuleHits(five: PlayerSpan[]): Record<string, number> {
  const use = (p: PlayerSpan) => dataUsageDemand(p) ?? 0.3;
  // The post skill reads a zone, not post-ups (Nash 97, Shaq 9), so the paint is read as rim
  // pressure without a spot-up shot, on a player who holds the ball: Shaq, Embiid, Duncan, Davis,
  // Giannis, Wade.
  // 2026-11-21 (REV_PAINT: 1 = as before, 'mid' = a guard / wing with an elite mid-range zone (post 90+:
  // Wade, Westbrook) scores before the paint, 0 = the rule off; the user: Wade beside Shaq won 2006).
  const paint = REV_PAINT === '0' ? 0 : five.filter((p) => s(p, 'rimPressure', 0) >= 85 && s(p, 'spotUp') < 40 && use(p) >= 0.45 && !(REV_PAINT === 'mid' && !isBig(p) && s(p, 'post', 0) >= 90)).length;
  const offBallStar = (p: PlayerSpan) => REV_STAR && s(p, 'spotUp') >= REV_OFFBALL_SPOT;
  const holds = (p: PlayerSpan) => Math.max(Math.min(1, Math.max(0, (ballShare(p) - 0.15) / 0.1)), isBig(p) ? Math.min(1, Math.max(0, (use(p) - 0.4) / 0.2)) : 0);
  const ball = REV_BALL_SRC === 'share'
    ? Math.round(five.filter((p) => !offBallStar(p)).reduce((sum, p) => sum + holds(p), 0) * 10) / 10
    : five.filter((p) => use(p) >= REV_BALL_USE && !offBallStar(p)).length;
  const offBallNoShot = five.filter((p) => !isBig(p) && use(p) < 0.3 && teamSpacingValue(p) < 35).length;
  const weakPerim = five.filter((p) => !isBig(p) && computeDefensiveTalent(p) < 40).length;
  // 2026-11-22 (REV_BENCH_3D, the user: OG Anunoby beside Nash / Oladipo / Giannis / Wemby): a premium 3-and-D
  // wing (D-TAL 80+, spacing 55+) is a starter's job done, not a bench player in the five.
  const threeAndD = (p: PlayerSpan) => REV_BENCH_3D && !isBig(p) && computeDefensiveTalent(p) >= 80 && teamSpacingValue(p) >= 55;
  const bench = five.filter((p) => effectiveTalent(p) < 70 || (!isBig(p) && computeOffensiveTalent(p) < 50 && !threeAndD(p))).length;
  const eliteShooter = five.some((p) => s(p, 'pullUp3', 0) >= 98 && use(p) >= 0.5);
  // A second playmaker who can't shoot, beside an on-ball engine (LeBron + Draymond): his passing
  // repeats what the engine already does, and off the ball he doesn't space.
  const engine = five.find((p) => use(p) >= REV_PM_ENGINE && s(p, 'handling', 0) >= 90);
  // 2026-11-26 (the user: "coś jest źle skoro para Stockton - Magic wygrywa"; without Stockton it is Magic + Paul):
  // `REV_PM_SPC` is the spacing that exempts a second playmaker (55 = as before; Stockton 72 and Paul 82
  // always escaped). `REV_PM_ENGINE` the usage that makes the first one the engine (0.5 as before).
  const extraPlaymakers = engine && !offBallStar(engine) ? five.filter((p) => p !== engine && !(REV_STAR && use(p) >= 0.5) && (playmakingScoreForPlayer(p) ?? 0) >= 85 && teamSpacingValue(p) < REV_PM_SPC).length : 0;
  // 2026-11-19 (the user, Kyrie / Manu / Kawhi / Davis / Nenê: "brakuje floor generala na PG"):
  // nobody organizes — the point guard is no real playmaker (< 88) and no one else is an elite
  // one (95+, a LeBron / Jokić / Magic who runs it from anywhere).
  // The playmaking score reads old floor generals low (Oscar 1962-64: 81 at 10.2 assists), so the
  // higher of it and an assists read (8+ a game = 95, 6+ = 88) counts.
  const pm = (p: PlayerSpan) => Math.max(playmakingScoreForPlayer(p) ?? 0, p.box.apg >= 8 ? 95 : p.box.apg >= 6 ? 88 : 0);
  const pgs = five.filter((p) => p.primaryPosition === 'PG');
  const noFloorGeneral = (pgs.length === 0 || Math.max(...pgs.map(pm)) < 88) && Math.max(...five.map(pm)) < 95 ? 1 : 0;
  const nonShootBigs = five.filter((p) => isBig(p) && teamSpacingValue(p) < 30 && use(p) < 0.35).length;
  return {
    paintCrowd: paint >= 2 ? paint - 1 : 0,
    threeBall: ball > 2 ? Math.round((ball - 2) * 10) / 10 : 0,
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
  // 2026-11-25 (`REV_DROP`, comma list, measurement only): leave out the named rules.
  for (const k of REV_DROP) h[k] = 0;
  // 2026-11-26 (the user approved, top-end plan): eliteShooterCover, secondWeakPerim and noFloorGeneral no longer
  // count — on 600 real team-seasons and the 114-team forecast each one read against the judge beside the rest of
  // Overall (reports/revrules.txt); their hits stay visible.
  return W * (-h.paintCrowd - h.threeBall - h.offBallNoShot - h.benchStarter - h.extraPlaymaker);
}
