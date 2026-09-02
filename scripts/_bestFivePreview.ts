import { dailyPool, dailyTargets, scoreLineup, gradeVsPar, dayKey, talMaxLineup } from '../src/engine/bestFive';
import { effectiveTalent } from '../src/engine/grades';
import { computeSpacing } from '../src/engine/spacing';
import { STARTER_SLOTS } from '../src/engine/positions';
for (const key of [dayKey(), '2026-09-03', '2026-10-15', '2026-12-25', '2027-06-01', '2027-01-08']) {
  const pool = dailyPool(key);
  const t0 = Date.now();
  const tgt = dailyTargets(pool);
  console.log(`\n===== ${key} =====  (solved ${Date.now()-t0}ms)  par ${tgt.par}  optimal ${tgt.optimal}`);
  console.log('  optimal five: ' + STARTER_SLOTS.map(sl => { const s = tgt.optimalFive[sl]; return `${sl} ${s.playerName}(SPC${computeSpacing(s)})`; }).join('  '));
  const naive = talMaxLineup(pool); const ns = scoreLineup(naive);
  console.log('  TAL-max five: ' + STARTER_SLOTS.map(sl => { const s = naive[sl]; return `${sl} ${s.playerName}`; }).join('  '));
  console.log(`  TAL-max composite ${ns.composite} -> ${gradeVsPar(ns.composite, tgt.par, tgt.optimal)}   weakLink ${tgt.optimalFive && scoreLineup(tgt.optimalFive).weakLink}`);
  // a "decent human" pick: swap the worst-SPC starter in TAL-max for the best-SPC option at that slot
  const worst = STARTER_SLOTS.reduce((w, sl) => computeSpacing(naive[sl]) < computeSpacing(naive[w]) ? sl : w, STARTER_SLOTS[0]);
  const bestSpcAtWorst = pool.bySlot[worst].slice().sort((a,b)=>computeSpacing(b)-computeSpacing(a))[0];
  const human = { ...naive, [worst]: bestSpcAtWorst };
  const hs = scoreLineup(human);
  console.log(`  "fix worst spacer" (${worst}: ${naive[worst].playerName}->${bestSpcAtWorst.playerName}): composite ${hs.composite} -> ${gradeVsPar(hs.composite, tgt.par, tgt.optimal)}`);
}
