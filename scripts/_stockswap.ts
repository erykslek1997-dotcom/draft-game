// 2026-11-26 (the user: "Stocktona nie rozumiem"): the best five with Stockton swapped for other guards —
// every Overall part side by side.
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { scoreTeam, ballLoadAdjustment, creatorAdjustment, ballHandlerAdjustment, offenseScoreBreakdown } from '../src/engine/scoring';
import { liftAdjustment } from '../src/engine/teammateLift';
import { heliocentricAdjustment } from '../src/engine/heliocentric';
import { reviewAdjustment, reviewRuleHits } from '../src/engine/reviewRules';
import type { Team, PlayerSpan } from '../src/engine/types';
const bestOf = (n: string) => draftPool.filter((p) => p.playerName === n).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
const w = (n: string, s: string) => draftPool.find((p) => p.playerName === n && p.spanLabel === s)!;
const bench = ['Jamal Murray', 'Mikal Bridges', 'Robert Covington', 'Tree Rollins'].map((n) => draftPool.find((p) => p.playerName === n)!);
const core = [w('Kawhi Leonard', '2015-17'), w('Larry Bird', '1985-87'), w('Kevin Garnett', '2002-04'), w('Kareem Abdul-Jabbar', '1971-73')];
for (const g of [w('John Stockton', '1990-92'), w('Stephen Curry', '2014-16'), w('Magic Johnson', '1989-91'), w('Chris Paul', '2015-17'), bestOf('Michael Jordan'), w('LeBron James', '2012-14'), w('Steve Nash', '2005-07'), bestOf('Jerry West')]) {
  const roster = [g, ...core, ...bench];
  const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const b = scoreTeam(t); const st = primaryStarters(t).map((a) => a.player);
  const hits = Object.entries(reviewRuleHits(st)).filter(([, v]) => v).map(([k, v]) => `${k}${v}`).join(',');
  console.log(`${(g.playerName + ' ' + g.spanLabel).padEnd(26)} ovr ${b.overallExact.toFixed(2)} TAL ${b.talentScore} bench ${b.benchDepthScore} O ${b.offenseScore} D ${b.defenseScore} fit ${b.fitScore} spc ${b.spacingScore} | gTAL ${Math.round(effectiveTalent(g))} | load ${ballLoadAdjustment(t).toFixed(1)} hand ${ballHandlerAdjustment(t).toFixed(1)} helio ${heliocentricAdjustment(t).toFixed(1)} lift ${liftAdjustment(t).toFixed(1)} creator ${creatorAdjustment(t).toFixed(1)} review ${reviewAdjustment(st).toFixed(0)} [${hits}]`);
}
