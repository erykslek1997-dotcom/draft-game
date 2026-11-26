// 2026-11-26: center calibration — every Overall term for one core with each center.
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { scoreTeam, ballLoadAdjustment, creatorAdjustment, ballHandlerAdjustment, dataCertaintyAdjustment, benchFloorAdjustment, eraAdjustment, benchOffenseAdjustment, benchRoleAdjustment, offenseScoreBreakdown } from '../src/engine/scoring';
import { liftAdjustment } from '../src/engine/teammateLift';
import { chemistryAdjustment } from '../src/engine/chemistry';
import { heliocentricAdjustment } from '../src/engine/heliocentric';
import { reviewAdjustment } from '../src/engine/reviewRules';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import type { Team, PlayerSpan } from '../src/engine/types';
const bestOf = (n: string) => draftPool.filter((p) => p.playerName === n).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
const w = (n: string, s: string) => draftPool.find((p) => p.playerName === n && p.spanLabel === s)!;
const bench = ['Jamal Murray', 'Mikal Bridges', 'Robert Covington', 'Tree Rollins'].map(bestOf);
const coreC = [bestOf('James Harden'), bestOf('Russell Westbrook'), bestOf('Luka Doncic'), bestOf('Dirk Nowitzki')];
for (const c of [w('Kareem Abdul-Jabbar', '1971-73'), w('David Robinson', '1993-95'), w('Nikola Jokic', '2023-25')]) {
  const roster = [...coreC, c, ...bench];
  const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const b = scoreTeam(t);
  const terms = { load: ballLoadAdjustment(t), lift: liftAdjustment(t), creator: creatorAdjustment(t), handler: ballHandlerAdjustment(t), certainty: dataCertaintyAdjustment(t), chem: chemistryAdjustment(t), helio: heliocentricAdjustment(t), benchFloor: benchFloorAdjustment(t), era: eraAdjustment(t), review: reviewAdjustment(primaryStarters(t).map((a) => a.player)), benchOff: benchOffenseAdjustment(t), benchRole: benchRoleAdjustment(t) };
  console.log(`${c.playerName} ${c.spanLabel}: ovr ${b.overallExact.toFixed(2)} TAL ${b.talentScore} bench ${b.benchDepthScore} O ${b.offenseScore} D ${b.defenseScore} fit ${b.fitScore} spc ${b.spacingScore} | cTAL ${Math.round(effectiveTalent(c))} cO ${computeOffensiveTalent(c)} cD ${computeDefensiveTalent(c)} FGA ${c.fga}`);
  console.log('   ', Object.entries(terms).filter(([, v]) => Math.abs(v) > 0.01).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' | '), '| offRaw', offenseScoreBreakdown(t).raw.toFixed(1));
}
import { reviewRuleHits } from '../src/engine/reviewRules';
for (const c of [w('Kareem Abdul-Jabbar', '1971-73'), w('David Robinson', '1993-95')]) {
  const roster = [...coreC, c, ...bench];
  const t: Team = { id: 'y', name: 'y', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const ob = offenseScoreBreakdown(t) as unknown as Record<string, number>;
  console.log(c.playerName, 'review', JSON.stringify(reviewRuleHits(primaryStarters(t).map((a) => a.player))), '| offense', JSON.stringify(Object.fromEntries(Object.entries(ob).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, Math.round(v * 10) / 10]))));
}
