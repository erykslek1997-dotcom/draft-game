import { draftPool } from '../src/data/draftPool';
import { computeTalent } from '../src/engine/talent';

// Calibrated against draftPool specifically, not the full players.ts archive — actual rosters
// are only ever built from the ~300-player pool, so that's the population "a normal cap-legal
// roster" is drawn from, not the much larger (and much more scrub-heavy) full archive.
const talents = draftPool.map((p) => ({ id: p.id, talent: computeTalent(p), fga: p.fga }));
talents.sort((a, b) => b.talent - a.talent);

console.log('--- Top 10 talent ---');
for (const t of talents.slice(0, 10)) console.log(t.id, t.talent);

console.log('--- Bottom 10 talent ---');
for (const t of talents.slice(-10)) console.log(t.id, t.talent);

const totalTalent = talents.reduce((s, t) => s + t.talent, 0);
const totalFga = talents.reduce((s, t) => s + t.fga, 0);
console.log('Average talent:', (totalTalent / talents.length).toFixed(2));
console.log('Average talent-per-FGA (draft pool, FGA-weighted):', (totalTalent / totalFga).toFixed(3));

const min = Math.min(...talents.map((t) => t.talent));
const max = Math.max(...talents.map((t) => t.talent));
console.log('Range:', min, '-', max);
