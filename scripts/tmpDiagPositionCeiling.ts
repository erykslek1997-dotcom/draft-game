import { draftPool } from '../src/data/draftPool';
import { computeOffensiveTalent, computeDefensiveTalent, computeTalent } from '../src/engine/talent';

function top(label: string, fn: (s: any) => number, pos?: string) {
  const pool = pos ? draftPool.filter((p) => p.primaryPosition === pos) : draftPool;
  const sorted = [...pool].sort((a, b) => fn(b) - fn(a)).slice(0, 5);
  console.log(`\n${label}${pos ? ' (' + pos + ')' : ''}:`);
  for (const s of sorted) console.log(`  ${s.playerName} ${s.spanLabel}: ${fn(s)}`);
}

for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
  top('O-TAL', computeOffensiveTalent, pos);
}
for (const pos of ['PG', 'SG', 'SF', 'PF', 'C']) {
  top('D-TAL', computeDefensiveTalent, pos);
}

const curry = draftPool.filter((p) => p.playerName === 'Stephen Curry');
console.log('\nCurry spans O-TAL:', curry.map((s) => `${s.spanLabel}: ${computeOffensiveTalent(s)}`));
const hakeem = draftPool.filter((p) => p.playerName.includes('Olajuwon'));
console.log('Hakeem spans D-TAL:', hakeem.map((s) => `${s.spanLabel}: ${computeDefensiveTalent(s)}`));
const garnett = draftPool.filter((p) => p.playerName.includes('Garnett'));
console.log('Garnett spans D-TAL:', garnett.map((s) => `${s.spanLabel}: ${computeDefensiveTalent(s)}`));
const duncan = draftPool.filter((p) => p.playerName.includes('Duncan'));
console.log('Duncan spans D-TAL:', duncan.map((s) => `${s.spanLabel}: ${computeDefensiveTalent(s)}`));
