// Full-pool scan: which spans are currently clipped by MAX_USAGE_RATIO_PENALTY=6 (i.e. would be
// affected by raising it)? Also requires the defense gate to actually be open (gateFactor>0) for
// the clipping to matter in practice.
import { players } from '../src/data/players';
import { computeTalent, computeDefensiveTalent } from '../src/engine/talent';

const USAGE_RATIO_REFERENCE = 3.3;
const USAGE_RATIO_SCALE = 1.1;
const MAX_USAGE_RATIO_PENALTY = 6;
const HIGH_USAGE_FGA_THRESHOLD = 14;

const clipped: { name: string; span: string; fga: number; apg: number; ratio: number; excess: number; uncapped: number; tal: number }[] = [];

for (const p of players) {
  if (p.fga < HIGH_USAGE_FGA_THRESHOLD) continue;
  const ratio = p.fga / Math.max(p.box.apg, 0.5);
  const excess = ratio - USAGE_RATIO_REFERENCE;
  if (excess <= 0) continue;
  const uncapped = excess * USAGE_RATIO_SCALE;
  if (uncapped > MAX_USAGE_RATIO_PENALTY) {
    clipped.push({ name: p.playerName, span: p.spanLabel, fga: p.fga, apg: p.box.apg, ratio, excess, uncapped, tal: computeTalent(p) });
  }
}

clipped.sort((a, b) => b.uncapped - a.uncapped);
console.log(`${clipped.length} spans currently clipped by the cap (fga>=14, excess penalty > 6):`);
for (const c of clipped) {
  console.log(
    `${c.name.padEnd(22)} ${c.span.padEnd(8)} FGA=${c.fga.toFixed(1)} APG=${c.apg.toFixed(1)} ratio=${c.ratio.toFixed(2)} uncappedPenalty=${c.uncapped.toFixed(2)} TAL=${c.tal}`,
  );
}
