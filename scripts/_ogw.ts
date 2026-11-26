import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { computeSpacing } from '../src/engine/spacing';
for (const p of draftPool.filter((x) => x.playerName === (process.argv[2] ?? 'OG Anunoby'))) console.log(`${p.spanLabel}: TAL ${Math.round(effectiveTalent(p))} O ${computeOffensiveTalent(p)} D ${computeDefensiveTalent(p)} SPC ${computeSpacing(p)} price ${p.fga} | ppg ${p.box.ppg.toFixed(1)} TS ${(p.box.tsPct*100).toFixed(1)}`);
