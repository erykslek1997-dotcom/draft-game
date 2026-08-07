// Check exactly how the high-usage/low-playmaking penalty currently treats McAdoo (both flagged
// spans) vs the validated anchor cases (Mullin/Dantley/English caught, Pippen/Kawhi/PG untouched),
// to see whether MAX_USAGE_RATIO_PENALTY (currently 6) is actively clipping McAdoo's own ratio —
// he's the named motivating case for the whole mechanism ("most extreme ratio in the dataset").
import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';

const USAGE_RATIO_REFERENCE = 3.3;
const USAGE_RATIO_SCALE = 1.1;
const MAX_USAGE_RATIO_PENALTY = 6;

const names: { name: string; span?: string }[] = [
  { name: 'Bob McAdoo', span: '1973-75' },
  { name: 'Bob McAdoo', span: '1975-77' },
  { name: 'Chris Mullin', span: '1989-91' },
  { name: 'Adrian Dantley' },
  { name: 'Alex English' },
  { name: 'Scottie Pippen' },
  { name: 'Kawhi Leonard' },
  { name: 'Paul George' },
];

for (const { name, span } of names) {
  const key = normalizePlayerName(name);
  const candidates = players.filter((p) => normalizePlayerName(p.playerName) === key && (!span || p.spanLabel === span));
  for (const p of candidates) {
    const ratio = p.fga / Math.max(p.box.apg, 0.5);
    const excess = ratio - USAGE_RATIO_REFERENCE;
    const rawPenaltyUncapped = excess > 0 ? excess * USAGE_RATIO_SCALE : 0;
    const cappedPenalty = Math.min(MAX_USAGE_RATIO_PENALTY, rawPenaltyUncapped);
    const tal = computeTalent(p);
    console.log(
      `${name.padEnd(18)} ${p.spanLabel.padEnd(8)} FGA=${p.fga.toFixed(1)} APG=${p.box.apg.toFixed(1)} ratio=${ratio.toFixed(2)} excess=${excess.toFixed(2)} uncappedPenalty=${rawPenaltyUncapped.toFixed(2)} cappedPenalty=${cappedPenalty.toFixed(2)} clippedByCap=${rawPenaltyUncapped > MAX_USAGE_RATIO_PENALTY} TAL=${tal}`,
    );
  }
}
