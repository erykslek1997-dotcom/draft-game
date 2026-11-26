import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
for (const n of ['Ben Wallace','Dikembe Mutombo','Rudy Gobert','Dennis Rodman','Bruce Bowen','Shane Battier','Tony Allen','Alex Caruso','Luc Mbah a Moute','Draymond Green','Marcus Smart','Jrue Holiday','Tyrese Haliburton','Trae Young']) {
  const w = draftPool.filter((p) => p.playerName === n).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
  if (w) console.log(`${n} ${w.spanLabel} TAL ${effectiveTalent(w)} O ${computeOffensiveTalent(w)} D ${computeDefensiveTalent(w)}`);
}
