// 2026-11-26 (the user: tune everything the engine reads against real NBA): one feature row per team — every
// ingredient the Overall reads — shared by the real-team dump (_baseline.ts DUMP) and the simulated leagues.
import { scoreTeam, offenseScoreBreakdown, starAdjustment, creatorAdjustment, ballLoadAdjustment, ballHandlerAdjustment } from '../src/engine/scoring';
import { fitScore } from '../src/engine/fit';
import { liftAdjustment } from '../src/engine/teammateLift';
import { reviewAdjustment } from '../src/engine/reviewRules';
import { primaryStarters } from '../src/engine/rotation';
import type { Team } from '../src/engine/types';
export function teamFeatures(t: Team): Record<string, number> {
  const b = scoreTeam(t), o = offenseScoreBreakdown(t), f = fitScore(t).components;
  return {
    ovr: b.overallExact, talent: b.talentScore, bench: b.benchDepthScore, offense: b.offenseScore, defense: b.defenseScore, fit: b.fitScore, spacing: b.spacingScore,
    otal: o.otal, rim: o.rimPressure, playmaking: o.playmaking, selfCreation: o.selfCreation, pnr: o.mismatchStructure,
    switchability: f.switchability, huntResistance: f.huntResistance, defRoles: f.defensiveRoleCoverage, rebounding: f.reboundingBalance, size: f.sizeCoverage, cohesion: f.defensiveCohesion,
    star: starAdjustment(t), creator: creatorAdjustment(t), ballLoad: ballLoadAdjustment(t), handler: ballHandlerAdjustment(t), lift: liftAdjustment(t), review: reviewAdjustment(primaryStarters(t).map((a) => a.player)),
  };
}
