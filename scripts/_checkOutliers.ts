import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';
import { darkoDefenseBonus } from '../src/engine/darkoCorrection';
import { blendedDefenseForSpan } from '../src/engine/blendedDefenseLookup';
import { buildDarkoYearMap, avgDarkoFieldForSpan } from '../src/engine/darkoLookup';
import { buildRaptorYearMap, avgRaptorDefenseForSpan } from '../src/engine/raptorLookup';

const ddpmMap = buildDarkoYearMap('ddpm');
const raptorMap = buildRaptorYearMap();

for (const name of ['John Stockton', 'Kyle Lowry']) {
  const spans = players.filter((p) => p.playerName === name);
  const best = spans.map((s) => ({ s, tal: computeTalent(s) })).sort((a, b) => b.tal - a.tal)[0];
  const s = best.s;
  console.log(`\n${name} — ${s.spanLabel} — TAL ${best.tal}`);
  console.log('  DARKO ddpm:', avgDarkoFieldForSpan(s, ddpmMap)?.toFixed(2) ?? 'no coverage');
  console.log('  RAPTOR defense:', avgRaptorDefenseForSpan(s, raptorMap)?.toFixed(2) ?? 'no coverage');
  console.log('  blended:', blendedDefenseForSpan(s)?.toFixed(2));
  console.log('  darkoDefenseBonus:', darkoDefenseBonus(s).toFixed(2));
}
