import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { computeOffensiveTalent } from '../src/engine/talent';
const pool = draftPool.filter((p) => Number(p.spanLabel.slice(0, 4)) >= 2010);
const og = pool.find((p) => p.playerName === 'OG Anunoby' && p.spanLabel === '2021-23')!;
const show = (p: typeof og) => console.log(`${(p.playerName + ' ' + p.spanLabel).padEnd(30)} O ${computeOffensiveTalent(p)}  ppg ${p.box.ppg.toFixed(1)} apg ${p.box.apg.toFixed(1)} TS ${(p.box.tsPct * 100).toFixed(1)} 3PA ${p.box.threePA.toFixed(1)} 3P% ${(p.box.threePct * 100).toFixed(1)}`);
show(og);
console.log('-- same O-TAL (49-51), 2010+, sorted by ppg:');
pool.filter((p) => Math.abs(computeOffensiveTalent(p) - 50) <= 1).sort((a, b) => a.box.ppg - b.box.ppg).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 12)) === 0).forEach(show);
