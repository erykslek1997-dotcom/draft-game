// Every window of a player in the same five (top-check star core at his position): Overall with and without the lift term.
import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import { liftAdjustment } from '../src/engine/teammateLift';
import { effectiveTalent } from '../src/engine/grades';
import type { Team, PlayerSpan } from '../src/engine/types';
const w = (n: string, s?: string) => draftPool.find((x) => x.playerName === n && (!s || x.spanLabel === s))!;
const STAR: Record<string, PlayerSpan> = { PG: w('Chris Paul','2015-17'), SG: w('Dwyane Wade','2008-10'), SF: w('Kawhi Leonard','2015-17'), PF: w('Kevin Garnett','2002-04'), C: w('David Robinson','1994-96') };
const bench = ['Jamal Murray','Robert Covington','Tree Rollins','Bobby Portis'].map((n) => w(n));
const n = process.argv[2];
for (const p of draftPool.filter((x) => x.playerName === n).sort((a, b) => a.spanLabel.localeCompare(b.spanLabel))) {
  const roster = [p, ...Object.entries(STAR).filter(([k]) => k !== p.primaryPosition).map(([, v]) => v), ...bench];
  const t: Team = { id: 'x', name: 'x', draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) };
  const b = scoreTeam(t), l = liftAdjustment(t);
  const st = b; console.log(p.spanLabel, p.primaryPosition, 'T', st.talentScore, 'F', st.fitScore, 'O', st.offenseScore, 'D', st.defenseScore, 'bench', st.benchDepthScore, 'TAL', Math.round(effectiveTalent(p)), 'ovr', b.overallExact.toFixed(1), 'lift', l.toFixed(1), 'ovr w/o lift', (b.overallExact - l).toFixed(1));
}
