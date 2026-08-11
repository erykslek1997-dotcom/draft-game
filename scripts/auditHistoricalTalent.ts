/**
 * Read-only audit of peak TAL for historically important players.
 *
 * Keeps the model's independent inputs visible next to the final score so an era correction
 * can be judged from whole-source coverage rather than tuned to a player's name.
 */
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import {
  computeDefensiveTalent,
  computeOffensiveTalent,
  computeTalent,
  extremeUsageRatioPenalty,
  rawTalentBlend,
  rawUncappedTalent,
} from '../src/engine/talent';
import { hiddenValueBonus } from '../src/engine/historicalApmCorrection';
import { blendedRealValueForSpan } from '../src/engine/blendedRealValueLookup';
import { bpm2CoverageForSpan, ddpmCoverageForSpan, raptorCoverageForSpan } from '../src/engine/blendedDefenseLookup';
import { buildHistoricalApmYearMap, avgHistoricalApmForSpan } from '../src/engine/historicalApmLookup';
import { buildPipmYearMap, avgPipmForSpan } from '../src/engine/pipmLookup';
import { getPrimeWowyrByPlayerName } from '../src/engine/wowyrLookup';
import { individualDefenseRate } from '../src/engine/defensiveAccolades';
import { portabilityBonus } from '../src/engine/portabilityCorrection';
import { playoffPerformanceBonus } from '../src/engine/playoffPerformanceLookup';
import { computeDefensiveImpact } from '../src/engine/defense';
import { darkoDefenseBonus, darkoDefenseMalus } from '../src/engine/darkoCorrection';
import coefficients from '../src/data/awards/correctionCoefficients.json';

const WATCH = [
  'Bill Russell',
  'Wilt Chamberlain',
  'Jerry West',
  'Oscar Robertson',
  'Elgin Baylor',
  'Bob Pettit',
  'Kareem Abdul-Jabbar',
  'Moses Malone',
  'Larry Bird',
  'Magic Johnson',
  'Hakeem Olajuwon',
  'Michael Jordan',
  'LeBron James',
];

const historicalApm = buildHistoricalApmYearMap();
const pipm = buildPipmYearMap();
const wowyr = new Map(
  [...getPrimeWowyrByPlayerName()].map(([name, value]) => [normalizePlayerName(name), value]),
);

function coverageCount(name: string, label: string, source: Map<string, Map<number, number>>): number {
  const yearMap = source.get(normalizePlayerName(name));
  if (!yearMap) return 0;
  return spanEndYears(label).filter((year) => yearMap.has(year)).length;
}

function numberOrDash(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? '-' : value.toFixed(digits);
}

console.log(
  [
    'player/span'.padEnd(34),
    'TAL'.padStart(3),
    'raw'.padStart(4),
    'O'.padStart(3),
    'D'.padStart(3),
    'blend'.padStart(6),
    'boxD'.padStart(6),
    'D+/-'.padStart(8),
    'BPM-D'.padStart(7),
    'APM'.padStart(7),
    'PIPM'.padStart(7),
    'real'.padStart(6),
    'hid'.padStart(5),
    'wowyr'.padStart(7),
    'allD'.padStart(5),
    'usage-'.padStart(7),
    'por+'.padStart(5),
    'po+'.padStart(5),
  ].join(' '),
);

for (const name of WATCH) {
  const spans = players.filter((span) => normalizePlayerName(span.playerName) === normalizePlayerName(name));
  const peak = spans.sort((a, b) => computeTalent(b) - computeTalent(a))[0];
  if (!peak) continue;

  const bpm = bpm2CoverageForSpan(peak);
  const apm = avgHistoricalApmForSpan(peak, historicalApm);
  const pipmValue = avgPipmForSpan(peak, pipm);
  const blended = blendedRealValueForSpan(peak);
  const ddpm = ddpmCoverageForSpan(peak);
  const raptor = raptorCoverageForSpan(peak);
  const totalCoverage = `${coverageCount(peak.playerName, peak.spanLabel, historicalApm)}/${coverageCount(peak.playerName, peak.spanLabel, pipm)}`;

  console.log(
    [
      `${peak.playerName} ${peak.spanLabel}`.padEnd(34),
      String(computeTalent(peak)).padStart(3),
      String(rawUncappedTalent(peak)).padStart(4),
      String(computeOffensiveTalent(peak)).padStart(3),
      String(computeDefensiveTalent(peak)).padStart(3),
      rawTalentBlend(peak).toFixed(2).padStart(6),
      computeDefensiveImpact(peak).toFixed(2).padStart(6),
      `${darkoDefenseBonus(peak).toFixed(1)}/${darkoDefenseMalus(peak).toFixed(1)}`.padStart(8),
      `${numberOrDash(bpm?.avg)}(${bpm?.count ?? 0})`.padStart(7),
      `${numberOrDash(apm)}(${totalCoverage.split('/')[0]})`.padStart(7),
      `${numberOrDash(pipmValue)}(${totalCoverage.split('/')[1]})`.padStart(7),
      numberOrDash(blended?.value).padStart(6),
      hiddenValueBonus(peak).toFixed(2).padStart(5),
      numberOrDash(wowyr.get(normalizePlayerName(peak.playerName))).padStart(7),
      individualDefenseRate(peak).toFixed(2).padStart(5),
      extremeUsageRatioPenalty(peak).toFixed(2).padStart(7),
      portabilityBonus(peak).toFixed(2).padStart(5),
      playoffPerformanceBonus(peak).toFixed(2).padStart(5),
    ].join(' '),
  );
  if (ddpm || raptor) {
    console.log(`  modern defense sources: DARKO=${numberOrDash(ddpm?.avg)} RAPTOR=${numberOrDash(raptor?.avg)}`);
  }
}

const preStocksResiduals = players
  .filter((span) => spanEndYears(span.spanLabel).every((year) => year < 1974))
  .map((span) => {
    const coverage = bpm2CoverageForSpan(span);
    if (!coverage) return null;
    const expected = coefficients.bpm2Defense.slope * computeDefensiveImpact(span) + coefficients.bpm2Defense.intercept;
    return {
      span,
      uncappedBonus: Math.max(0, (coverage.avg - expected) * 6),
    };
  })
  .filter((row): row is NonNullable<typeof row> => row !== null)
  .sort((a, b) => b.uncappedBonus - a.uncappedBonus);

const sortedPositive = preStocksResiduals
  .map((row) => row.uncappedBonus)
  .filter((value) => value > 0)
  .sort((a, b) => a - b);
const percentile = (p: number) => sortedPositive[Math.floor((sortedPositive.length - 1) * p)] ?? 0;
console.log(
  `\nPre-1974 BPM2 positive defensive bonus before the normal +9 cap: n=${sortedPositive.length}, ` +
    `p50=${percentile(0.5).toFixed(1)}, p90=${percentile(0.9).toFixed(1)}, ` +
    `p95=${percentile(0.95).toFixed(1)}, p99=${percentile(0.99).toFixed(1)}, max=${percentile(1).toFixed(1)}`,
);
for (const row of preStocksResiduals.slice(0, 20)) {
  console.log(
    `${row.span.playerName.padEnd(24)} ${row.span.spanLabel} TAL=${String(computeTalent(row.span)).padStart(2)} ` +
      `boxD=${computeDefensiveImpact(row.span).toFixed(1).padStart(5)} uncappedD+=${row.uncappedBonus.toFixed(1).padStart(5)}`,
  );
}
