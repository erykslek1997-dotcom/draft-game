import { players } from '../src/data/players';
import { spacingBreakdown, selfCreationRate } from '../src/engine/spacing';
import { buildSelfCreationYearMap, measuredSelfCreationForSpan } from '../src/engine/selfCreationLookup';
import { spanEndYears } from '../src/engine/era';

/** Coverage of the measured self-creation extract by era, and the Kawhi case the swap breaks. */
const three = buildSelfCreationYearMap('unassisted3Pt');

const byDecade = new Map<number, { total: number; covered: number; proxyNonZero: number; proxyNonZeroCovered: number }>();
for (const span of players) {
  const years = spanEndYears(span.spanLabel);
  const dec = Math.floor((years[years.length - 1] ?? 0) / 10) * 10;
  const m = measuredSelfCreationForSpan(span, three);
  const p = selfCreationRate(span);
  const e = byDecade.get(dec) ?? { total: 0, covered: 0, proxyNonZero: 0, proxyNonZeroCovered: 0 };
  e.total++;
  if (m !== null) e.covered++;
  if (p > 0) { e.proxyNonZero++; if (m !== null) e.proxyNonZeroCovered++; }
  byDecade.set(dec, e);
}
console.log('=== measured-rate coverage by span end decade ===');
console.log('decade  spans  covered   cov%   proxy>0  of those covered');
for (const dec of [...byDecade.keys()].sort((a, b) => a - b)) {
  const e = byDecade.get(dec)!;
  console.log(
    String(dec).padStart(6),
    String(e.total).padStart(6),
    String(e.covered).padStart(8),
    `${((e.covered / e.total) * 100).toFixed(1).padStart(6)}%`,
    String(e.proxyNonZero).padStart(9),
    String(e.proxyNonZeroCovered).padStart(16),
  );
}

console.log('\n=== the case a wholesale swap breaks: Kawhi Leonard ===');
for (const span of players.filter((p) => p.playerName === 'Kawhi Leonard')) {
  const m = measuredSelfCreationForSpan(span, three);
  const b = spacingBreakdown(span);
  console.log(
    `  ${span.spanLabel}  ${span.offensiveArchetype.padEnd(22)} 3PA=${span.box.threePA.toFixed(1)} 3P%=${(span.box.threePct * 100).toFixed(1)}`,
    `proxy=${selfCreationRate(span).toFixed(2)} measured=${m === null ? 'none' : m.toFixed(3)}`,
    `acc=${b.accuracyPoints} vol=${b.volumePoints} pts=${b.points.toFixed(2)} ${b.tier}`,
  );
}

console.log('\n=== sanity: does the measured rate agree with the user\'s own tier calls? ===');
const NAMED = ['Damian Lillard', 'James Harden', 'Luka Doncic', 'Anthony Edwards',
  'Tyrese Haliburton', 'Jalen Brunson', 'Tracy McGrady', 'Kawhi Leonard', 'Cade Cunningham',
  'Stephen Curry', 'Klay Thompson', 'Reggie Miller'];
for (const name of NAMED) {
  const spans = players.filter((p) => p.playerName === name);
  if (!spans.length) continue;
  const best = spans.reduce((a, b) => (spacingBreakdown(b).points > spacingBreakdown(a).points ? b : a));
  const m = measuredSelfCreationForSpan(best, three);
  console.log(`  ${name.padEnd(22)} ${best.spanLabel.padEnd(9)} proxy=${selfCreationRate(best).toFixed(2)} measured=${m === null ? 'none' : m.toFixed(3)}  ${spacingBreakdown(best).tier}`);
}
