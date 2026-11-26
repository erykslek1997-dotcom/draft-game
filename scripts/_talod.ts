// 2026-11-25: TAL today vs TAL from O-TAL and D-TAL (TAL_OD), for the user's review.
import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
const names = ['Michael Jordan','LeBron James','Nikola Jokic','Stephen Curry','Kevin Garnett','Tim Duncan','Hakeem Olajuwon','Bill Russell','Magic Johnson','James Harden','Trae Young','Tyrese Haliburton','Reggie Miller','Steve Nash','Ben Wallace','Rudy Gobert','Dennis Rodman','Draymond Green','Bruce Bowen','Tony Allen','Alex Caruso','Shane Battier','OG Anunoby','Luc Mbah a Moute','Robert Horry','Kyle Korver','JJ Redick','Carmelo Anthony','Amar\'e Stoudemire'];
for (const n of names) {
  const w = draftPool.filter((p) => p.playerName === n).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
  if (w) console.log(`${n}|${w.spanLabel}|${Math.round(effectiveTalent(w))}|${computeOffensiveTalent(w)}|${computeDefensiveTalent(w)}`);
}
