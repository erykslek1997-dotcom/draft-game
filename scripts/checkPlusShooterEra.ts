import { players } from '../src/data/players';
import { isPlusShooter } from '../src/engine/shooting';
import { computeSpacing } from '../src/engine/spacing';
import { computePortability } from '../src/engine/portability';
import { spanEndYears } from '../src/engine/era';

/** Confirms the era bias in the old raw-gravity `isPlusShooter` is gone.
 * Run: npx tsx scripts/checkPlusShooterEra.ts */

const DECADES = [1980, 1990, 2000, 2010, 2020];

console.log('Plus-shooter rate by decade (spans whose midpoint falls in that decade)');
console.log(`${'Decade'.padEnd(9)}${'spans'.padStart(8)}${'plus'.padStart(8)}${'rate'.padStart(8)}`);
for (const decade of DECADES) {
  const inDecade = players.filter((p) => {
    const years = spanEndYears(p.spanLabel);
    if (years.length === 0) return false;
    const mid = years[Math.floor(years.length / 2)];
    return mid >= decade && mid < decade + 10;
  });
  const plus = inDecade.filter(isPlusShooter).length;
  console.log(
    `${String(decade + 's').padEnd(9)}${String(inDecade.length).padStart(8)}${String(plus).padStart(8)}` +
      `${((plus / inDecade.length) * 100).toFixed(1).padStart(7)}%`,
  );
}

const CHECKS = ['Larry Bird', 'Reggie Miller', 'Dale Ellis', 'Mark Price', 'Stephen Curry', 'Klay Thompson', 'Kyle Korver'];
console.log('\nPeak span per player — is it recognised as a plus shooter?');
for (const name of CHECKS) {
  const spans = players.filter((p) => p.playerName.normalize('NFKD').replace(/[̀-ͯ]/g, '') === name);
  if (spans.length === 0) continue;
  const best = spans.reduce((a, b) => (computeSpacing(b) > computeSpacing(a) ? b : a));
  console.log(
    `  ${name.padEnd(18)}${best.spanLabel.padStart(9)}  SPC ${String(computeSpacing(best)).padStart(3)}  ` +
      `POR ${String(computePortability(best)).padStart(3)}  plusShooter=${isPlusShooter(best)}`,
  );
}

console.log(`\nTotal plus shooters: ${players.filter(isPlusShooter).length} / ${players.length}`);
