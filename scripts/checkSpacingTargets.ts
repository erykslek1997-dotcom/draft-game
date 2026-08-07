import { players } from '../src/data/players';
import { spacingBreakdown, computeSpacing, type SpacingTier } from '../src/engine/spacing';

/** Regression check for the 2026-07-30 SPACING feedback batch, run through the real engine. */
const TARGETS: [string, SpacingTier[]][] = [
  ['Damian Lillard', ['Walking gravity']], ['James Harden', ['Walking gravity']],
  ['Luka Doncic', ['Walking gravity']], ['Anthony Edwards', ['Walking gravity']],
  ['Tyrese Haliburton', ['Great shooter']], ['Jalen Brunson', ['Great shooter']],
  ['Tracy McGrady', ['Great shooter']], ['Kawhi Leonard', ['Great shooter']],
  ['Cade Cunningham', ['Good shooter', 'Great shooter']],
  ['Lauri Markkanen', ['Walking gravity']],
  ['Nikola Jokic', ['Walking gravity']], ['Dirk Nowitzki', ['Walking gravity']],
  ['Kevin Durant', ['Walking gravity']], ['Larry Bird', ['Walking gravity']],
  ['Victor Wembanyama', ['Walking gravity']], ['Karl-Anthony Towns', ['Walking gravity']],
  ['Stephen Curry', ['Shooting anomaly']],
  ['Terry Porter', ['Great shooter']],
  ['Mark Price', ['Walking gravity']], ['Reggie Miller', ['Walking gravity']],
  ['Klay Thompson', ['Walking gravity']],
  ['Russell Westbrook', ['Non-shooter', 'Bad shooter', 'Average shooter']],
  ['Ben Simmons', ['Non-shooter']], ['Rudy Gobert', ['Non-shooter']],
  ['Shaquille O\'Neal', ['Non-shooter']],
  ['Giannis Antetokounmpo', ['Non-shooter', 'Bad shooter', 'Average shooter']],
];
let misses = 0;
for (const [name, want] of TARGETS) {
  const spans = players.filter((p) => p.playerName === name);
  if (!spans.length) { console.log(name.padEnd(24), 'NOT IN DATASET'); misses++; continue; }
  let best = spans[0];
  for (const s of spans) if (spacingBreakdown(s).points > spacingBreakdown(best).points) best = s;
  const b = spacingBreakdown(best);
  const ok = want.includes(b.tier);
  if (!ok) misses++;
  console.log([name.padEnd(24), best.primaryPosition, best.spanLabel,
    `raw3PA=${best.box.threePA.toFixed(1)}`, `pts=${b.points.toFixed(1)}`, `SPC=${String(computeSpacing(best)).padStart(3)}`,
    b.tier.padEnd(17), ok ? 'ok' : `MISS (want ${want.join('|')})`].join(' '));
}
console.log('\nout of band:', misses, 'of', TARGETS.length);

// Curry's per-span arc: the anomaly tag must not retroactively apply to his rookie years.
console.log('\nCurry spans:', players.filter((p) => p.playerName === 'Stephen Curry')
  .map((s) => `${s.spanLabel}=${spacingBreakdown(s).tier}`).join(' | '));
