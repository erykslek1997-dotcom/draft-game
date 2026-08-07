import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { normalizedDefenseForFit } from '../src/engine/talent';
import { darkoDefenseBonus, darkoDefenseMalus } from '../src/engine/darkoCorrection';
import { buildDarkoYearMap, avgDarkoFieldForSpan } from '../src/engine/darkoLookup';
import { hiddenValueBonus } from '../src/engine/historicalApmCorrection';
import { portabilityBonus } from '../src/engine/portabilityCorrection';

const ddpmMap = buildDarkoYearMap('ddpm');
const dpmMap = buildDarkoYearMap('dpm');

const key = normalizePlayerName('Paul Pierce');
const wanted = ['1999-01', '2000-02', '2001-03', '2002-04', '2003-05'];
for (const span of wanted) {
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === span)!;
  console.log(
    `${span}: normalizedDefenseForFit=${normalizedDefenseForFit(p).toFixed(1)} darkoDefenseBonus=${darkoDefenseBonus(p).toFixed(2)} darkoDefenseMalus=${darkoDefenseMalus(p).toFixed(2)} ddpm=${avgDarkoFieldForSpan(p, ddpmMap)} dpm=${avgDarkoFieldForSpan(p, dpmMap)} hiddenValueBonus=${hiddenValueBonus(p).toFixed(2)} portabilityBonus=${portabilityBonus(p).toFixed(2)}`,
  );
}
