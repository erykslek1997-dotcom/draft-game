import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { darkoDefenseBonus } from '../src/engine/darkoCorrection';
import { individualDefenseRate } from '../src/engine/defensiveAccolades';
import { ddpmCoverageForSpan, raptorCoverageForSpan } from '../src/engine/blendedDefenseLookup';

const key = normalizePlayerName('Bob McAdoo');
const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === '1973-75')!;
console.log('darkoDefenseBonus:', darkoDefenseBonus(p));
console.log('individualDefenseRate:', individualDefenseRate(p));
console.log('ddpmCoverage:', ddpmCoverageForSpan(p));
console.log('raptorCoverage:', raptorCoverageForSpan(p));
