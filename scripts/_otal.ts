import { draftPool } from '../src/data/draftPool';
import { computeOffensiveTalent, talentTermsForDiagnosis } from '../src/engine/talent';
import { effectiveTalent } from '../src/engine/grades';
const L: [string,string][] = [['Stephen Curry','2014-16'],['John Stockton','1990-92'],['Magic Johnson','1989-91'],['Chris Paul','2015-17'],['Steve Nash','2005-07'],['LeBron James','2012-14'],['Nikola Jokic','2023-25']];
for (const [n,s] of L) { const p = draftPool.find(x=>x.playerName===n&&x.spanLabel===s)!; const t = talentTermsForDiagnosis(p);
 console.log(n.padEnd(15), 'OTAL', computeOffensiveTalent(p).toFixed(1), 'TAL', effectiveTalent(p).toFixed(1), JSON.stringify(Object.fromEntries(Object.entries(t).map(([k,v])=>[k,+v.toFixed(1)])))); }
