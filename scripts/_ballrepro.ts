// 2026-11-26 (the user's calibration brief: two primary ball handlers not penalised, only FGA): the table's
// fives on a shared bench (Murray, Bridges, Covington, Rollins — first spans in draftPool), autoAssignRotation,
// scoreTeam, and every ball-related term.
import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import { scoreTeam, ballHandlerAdjustment, ballLoadAdjustment, offenseScoreBreakdown } from '../src/engine/scoring';
import { heliocentricAdjustment } from '../src/engine/heliocentric';
import { ballShare, ballHandlerCost } from '../src/engine/ballHandling';
import { fitScore } from '../src/engine/fit';
import { computeSpacing } from '../src/engine/spacing';
import type { Team, PlayerSpan } from '../src/engine/types';
const first = (n: string) => draftPool.find((p) => p.playerName === n)!;
const win = (n: string, w: string) => draftPool.find((p) => p.playerName === n && p.spanLabel === w)!;
const bench = ['Jamal Murray', 'Mikal Bridges', 'Robert Covington', 'Tree Rollins'].map(first);
const M = win('Magic Johnson', '1989-91'), S = win('John Stockton', '1990-92'), B = win('Larry Bird', '1985-87'), K = win('Kevin Garnett', '2002-04'), A = win('Kareem Abdul-Jabbar', '1971-73');
const J = draftPool.filter((p) => p.playerName === 'Michael Jordan').sort((a, b) => b.fga - a.fga)[0];
const L = win('LeBron James', '2012-14');
const cases: [string, PlayerSpan[]][] = (process.env.CASES ? JSON.parse(process.env.CASES) : null) ?? [
  ['Magic Stockton Bird KG Kareem', [M, S, B, K, A]],
  ['Stockton->Jordan', [M, J, B, K, A]],
  ['Magic->Jordan', [S, J, B, K, A]],
  ['Stockton->LeBron', [M, L, B, K, A]],
  ['ctrl Stockton+Hornacek+Malone', [S, win('Jeff Hornacek', '1995-97') ?? first('Jeff Hornacek'), first('Bryon Russell'), win('Karl Malone', '1996-98'), first('Greg Ostertag')]],
  ['ctrl Curry+Klay', [win('Stephen Curry', '2015-17'), win('Klay Thompson', '2015-17'), win('Kevin Durant', '2016-18') ?? first('Kevin Durant'), win('Draymond Green', '2015-17'), first('Andrew Bogut')]],
  ['ctrl LeBron+Wade', [first('Mario Chalmers'), win('Dwyane Wade', '2011-13') ?? first('Dwyane Wade'), L, win('Chris Bosh', '2011-13') ?? first('Chris Bosh'), first('Udonis Haslem')]],
];
for (const [name, five] of cases) {
  const roster = [...five, ...bench];
  const team: Team = { id: name, name, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const b = scoreTeam(team), f = fitScore(team);
  const st = primaryStarters(team);
  const fga5 = five.reduce((s, p) => s + p.fga, 0);
  console.log(`${name.padEnd(30)} ovr ${b.overallExact.toFixed(1)} O ${b.offenseScore} fit ${b.fitScore} spc ${b.spacingScore} FGA5 ${fga5.toFixed(1)} | ballH ${ballHandlerAdjustment(team).toFixed(2)} (cost ${ballHandlerCost(st.map((s) => s.player)).toFixed(2)}) load ${ballLoadAdjustment(team).toFixed(2)} helio ${heliocentricAdjustment(team).toFixed(2)} offRaw ${offenseScoreBreakdown(team).raw.toFixed(1)}`);
  console.log('   starters', st.map((s) => `${s.slot} ${s.player.playerName.split(' ').pop()} share ${ballShare(s.player).toFixed(2)} spc ${computeSpacing(s.player)}`).join(' | '));
  console.log('   fit notes:', (f.notes ?? []).slice(0, 3).join(' / '));
}
