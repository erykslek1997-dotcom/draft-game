// 2026-11-25 (Wednesday item 2): the same five with a different second star — Overall against his TAL.
import { draftPool } from '../src/data/draftPool'; import { scoreTeam, ballHandlerAdjustment, ballLoadAdjustment } from '../src/engine/scoring'; import { autoAssignRotation } from '../src/engine/rotation'; import { effectiveTalent } from '../src/engine/grades'; import { heliocentricAdjustment } from '../src/engine/heliocentric';
const f = (n: string) => { const m = n.match(/^(.*) (\d{4}-\d{2})$/)!; const s = draftPool.find((p) => p.playerName === m[1] && p.spanLabel === m[2]); if (!s) throw new Error(n); return s; };
const lead = f(process.env.LEAD ?? 'Stephen Curry 2015-17');
const rest = ['Shane Battier 2006-08', 'Al Horford 2016-18', 'Rudy Gobert 2018-20', 'Danny Green 2013-15', 'Boris Diaw 2013-15', 'Andre Iguodala 2014-16', 'Mario Chalmers 2011-13'].map(f);
for (const n of ['Russell Westbrook 2015-17', 'James Harden 2017-19', 'Oscar Robertson 1962-64', 'Kawhi Leonard 2015-17', 'Dwyane Wade 2008-10', 'Klay Thompson 2014-16', 'Kevin Durant 2012-14', 'Allen Iverson 2000-02']) {
  const s2 = draftPool.find((p) => p.playerName === n.slice(0, -8) && p.spanLabel === n.slice(-7)); if (!s2) { console.log('miss', n); continue; }
  const roster = [lead, s2, ...rest]; const t: any = { id: n, name: n, draftSlot: 1, isHuman: true, roster, rotation: autoAssignRotation(roster) }; const b: any = scoreTeam(t);
  console.log(n.padEnd(28), 'TAL', Math.round(effectiveTalent(s2)), 'ovr', b.overallExact.toFixed(1), 'O', b.offenseScore, 'fit', Math.round(b.fitScore), 'ballH', ballHandlerAdjustment(t).toFixed(1), 'load', ballLoadAdjustment(t).toFixed(1), 'helio', heliocentricAdjustment(t).toFixed(1));
}
