import { players } from '../src/data/players';
import { computeTalent, selfCreationTalentBonus } from '../src/engine/talent';
import { selfCreationIsMeasured, selfCreation3PtIsMeasured } from '../src/engine/selfCreationSimilarity';

/**
 * Standing check for G_ASSIST_EQUALS_CREATION (`selfCreationTalentBonus` in talent.ts, shipped
 * 2026-08-12). Reports the blast radius directly rather than trusting the two aggregate Spearman
 * scripts alone — those can hide a wide, noisy reshuffle behind a stable top-line number.
 */

interface Row {
  span: (typeof players)[number];
  bonus: number;
  tal: number;
  measured: boolean;
}

const rows: Row[] = players.map((span) => ({
  span,
  bonus: selfCreationTalentBonus(span),
  tal: computeTalent(span),
  measured: span.box.threePA >= 2 ? selfCreation3PtIsMeasured(span) : selfCreationIsMeasured(span),
}));

const touched = rows.filter((r) => r.bonus > 0);
const atCap = touched.filter((r) => r.bonus >= 4.99);

console.log(`Spans touched (bonus > 0): ${touched.length} of ${rows.length} (${((touched.length / rows.length) * 100).toFixed(1)}%)`);
console.log(`Spans at/near the +5 cap: ${atCap.length}`);
console.log(`Measured (real, 1997+) vs estimated (k-NN) among touched: ${touched.filter((r) => r.measured).length} / ${touched.filter((r) => !r.measured).length}`);

console.log('\n--- Top 15 by bonus size ---');
for (const r of [...touched].sort((a, b) => b.bonus - a.bonus).slice(0, 15)) {
  console.log(
    r.span.playerName.padEnd(24),
    r.span.spanLabel.padEnd(10),
    r.span.primaryPosition,
    `bonus=${r.bonus.toFixed(2)}`,
    `TAL=${r.tal}`,
    r.measured ? 'measured' : 'estimated',
  );
}

console.log('\n--- Known non-creators: guardrail check (should read 0 or near-0 bonus) ---');
const GUARDRAILS = ['Shaquille O\'Neal', 'Rudy Gobert', 'Ben Simmons', 'Dennis Rodman', 'Bill Russell'];
for (const name of GUARDRAILS) {
  const spans = players.filter((p) => p.playerName === name);
  if (spans.length === 0) continue;
  const best = spans.reduce((a, b) => (selfCreationTalentBonus(b) > selfCreationTalentBonus(a) ? b : a));
  console.log(name.padEnd(24), `bestBonus=${selfCreationTalentBonus(best).toFixed(2)}`, best.spanLabel);
}

console.log('\n--- Known self-creators: sanity check (should read a real positive bonus) ---');
const CREATORS = ['James Harden', 'Kyrie Irving', 'Luka Doncic', 'Kevin Durant', 'Damian Lillard'];
for (const name of CREATORS) {
  const spans = players.filter((p) => p.playerName === name);
  if (spans.length === 0) continue;
  const best = spans.reduce((a, b) => (selfCreationTalentBonus(b) > selfCreationTalentBonus(a) ? b : a));
  console.log(name.padEnd(24), `bestBonus=${selfCreationTalentBonus(best).toFixed(2)}`, best.spanLabel);
}
