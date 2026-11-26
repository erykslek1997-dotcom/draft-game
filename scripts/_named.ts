// 2026-11-26: the named ceilings / peak targets (grades.ts) — each player's best displayed window and its O/D.
import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
const names = ['Oscar Robertson','Damian Lillard','Anthony Edwards','Gilbert Arenas','DeMarcus Cousins','Chris Mullin','Joel Embiid','Donovan Mitchell','Ray Allen','Kevin Johnson','Greg Ostertag','Shawn Bradley','Caldwell Jones','Mark Eaton','Michael Cooper','Raja Bell','Robert Horry','Tiago Splitter','Tony Allen','Hassan Whiteside','Bob Gross','OG Anunoby','Pau Gasol','Marc Gasol','Chris Bosh'];
for (const n of names) {
  const w = draftPool.filter((p) => p.playerName === n).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
  if (w) console.log(`${n}|${w.spanLabel}|${Math.round(effectiveTalent(w))}|${computeOffensiveTalent(w)}|${computeDefensiveTalent(w)}`);
}
