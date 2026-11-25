import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
for (const [n, w] of [['Dennis Rodman','1989-91'],['Dennis Rodman','1991-93'],['Bill Russell','1961-63'],['Ben Wallace','2002-04'],['Bobby Jones','1976-78'],['Michael Cooper','1985-87'],['Mark Eaton','1984-86'],['Tony Allen','2011-13'],['Alex Caruso','2022-24'],['Luc Mbah a Moute','2016-18'],['Draymond Green','2015-17'],['Rudy Gobert','2016-18']]) {
  const p = draftPool.find((x) => x.playerName === n && x.spanLabel === w);
  if (p) console.log(`${n} ${w}|${Math.round(effectiveTalent(p))}|${computeOffensiveTalent(p)}|${computeDefensiveTalent(p)}`);
}
