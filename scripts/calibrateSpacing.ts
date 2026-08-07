import { players } from '../src/data/players';
import { spacingBreakdown, computeSpacing, type SpacingTier } from '../src/engine/spacing';
import { threeVolumeEraScale, MODERN_THREE_VOLUME_BASELINE, MAX_THREE_VOLUME_SCALE } from '../src/engine/era';
import { POSITIONS } from '../src/data/schema';

/** Distribution + spot-check run behind spacing.ts's ladder thresholds.
 * Run: npx tsx scripts/calibrateSpacing.ts */

const TIERS: SpacingTier[] = [
  'Non-shooter',
  'Bad shooter',
  'Average shooter',
  'Good shooter',
  'Great shooter',
  'Walking gravity',
];

console.log(`Modern volume baseline: ${MODERN_THREE_VOLUME_BASELINE.toFixed(2)} 3PA/game`);
console.log(`Max era scale: ${MAX_THREE_VOLUME_SCALE}x\n`);

console.log('Era scale by sample span:');
for (const label of ['1980-82', '1985-87', '1988-90', '1993-95', '1998-00', '2004-06', '2010-12', '2015-17', '2020-22', '2024-26']) {
  console.log(`  ${label}  ${threeVolumeEraScale(label).toFixed(2)}x`);
}

const overall = new Map<SpacingTier, number>();
const byPosition = new Map<string, Map<SpacingTier, number>>();
for (const p of POSITIONS) byPosition.set(p, new Map());

for (const span of players) {
  const { tier } = spacingBreakdown(span);
  overall.set(tier, (overall.get(tier) ?? 0) + 1);
  const posMap = byPosition.get(span.primaryPosition)!;
  posMap.set(tier, (posMap.get(tier) ?? 0) + 1);
}

console.log(`\n--- Overall distribution (${players.length} spans) ---`);
for (const tier of TIERS) {
  const count = overall.get(tier) ?? 0;
  console.log(`  ${tier.padEnd(17)} ${String(count).padStart(6)}  ${((count / players.length) * 100).toFixed(1).padStart(5)}%`);
}

console.log('\n--- By position (% of that position) ---');
console.log(`  ${'Tier'.padEnd(17)}${POSITIONS.map((p) => p.padStart(8)).join('')}`);
for (const tier of TIERS) {
  const cells = POSITIONS.map((pos) => {
    const posMap = byPosition.get(pos)!;
    const total = [...posMap.values()].reduce((a, b) => a + b, 0);
    const count = posMap.get(tier) ?? 0;
    return `${((count / total) * 100).toFixed(1)}%`.padStart(8);
  });
  console.log(`  ${tier.padEnd(17)}${cells.join('')}`);
}
console.log(
  `  ${'(total spans)'.padEnd(17)}${POSITIONS.map((pos) => String([...byPosition.get(pos)!.values()].reduce((a, b) => a + b, 0)).padStart(8)).join('')}`,
);

const SPOT_CHECKS = [
  'Stephen Curry',
  'Klay Thompson',
  'Ray Allen',
  'Reggie Miller',
  'Larry Bird',
  'Dale Ellis',
  'Steve Kerr',
  'Mark Price',
  'Kyle Korver',
  'Duncan Robinson',
  'Damian Lillard',
  'Dirk Nowitzki',
  'Steve Nash',
  'Nikola Jokic',
  'Joel Embiid',
  'LeBron James',
  'Michael Jordan',
  'Kawhi Leonard',
  'Draymond Green',
  'Russell Westbrook',
  'Giannis Antetokounmpo',
  'Shaquille O\'Neal',
  'Tim Duncan',
  'Ben Simmons',
];

console.log('\n--- Peak span per player (highest SPACING) ---');
console.log(`  ${'Player'.padEnd(23)}${'Pos'.padStart(4)}${'Span'.padStart(10)}${'3P%'.padStart(7)}${'raw'.padStart(6)}${'scale'.padStart(7)}${'adj'.padStart(6)}${'acc'.padStart(5)}${'vol'.padStart(5)}${'SPC'.padStart(5)}  Tier`);
for (const name of SPOT_CHECKS) {
  const spans = players.filter((p) => p.playerName.normalize('NFKD').replace(/[̀-ͯ]/g, '') === name);
  if (spans.length === 0) {
    console.log(`  ${name.padEnd(23)} (not found)`);
    continue;
  }
  const best = spans.reduce((a, b) => (computeSpacing(b) > computeSpacing(a) ? b : a));
  const b = spacingBreakdown(best);
  console.log(
    `  ${name.padEnd(23)}${best.primaryPosition.padStart(4)}${best.spanLabel.padStart(10)}` +
      `${(best.box.threePct * 100).toFixed(1).padStart(7)}${best.box.threePA.toFixed(1).padStart(6)}` +
      `${threeVolumeEraScale(best.spanLabel).toFixed(2).padStart(6)}x${b.scaledThreePA.toFixed(1).padStart(6)}` +
      `${String(b.accuracyPoints).padStart(5)}${String(b.volumePoints).padStart(5)}${String(computeSpacing(best)).padStart(5)}  ${b.tier}`,
  );
}

const ranked = [...players].sort((a, b) => computeSpacing(b) - computeSpacing(a));
console.log('\n--- Top 25 spans by SPACING ---');
for (const span of ranked.slice(0, 25)) {
  const b = spacingBreakdown(span);
  console.log(
    `  ${span.playerName.padEnd(23)}${span.primaryPosition.padStart(4)}${span.spanLabel.padStart(10)}` +
      `${(span.box.threePct * 100).toFixed(1).padStart(7)}${span.box.threePA.toFixed(1).padStart(6)}` +
      `${b.scaledThreePA.toFixed(1).padStart(7)}${String(computeSpacing(span)).padStart(5)}  ${b.tier}`,
  );
}
