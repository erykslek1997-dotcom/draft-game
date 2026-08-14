import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';
import { buildEvidenceReport } from '../src/engine/evidenceReport';

/** Manual sanity check for G_BLACK_BOX — spot-checks named spans with known, well-understood
 * TAL stories (real hidden value, real defensive corroboration gaps, playoff drops, small
 * samples) and confirms the generated report actually surfaces the right signal. */

const CASES: [string, string | null][] = [
  ['Shaquille O\'Neal', null],
  ['Anthony Davis', null],
  ['Shane Battier', null],
  ['OG Anunoby', null],
  ['Joel Embiid', '2023-25'],
  ['John Stockton', null],
  ['James Harden', null],
  ['Wilt Chamberlain', null],
  ['Stephen Curry', null],
  ['Michael Jordan', null],
];

for (const [name, spanLabel] of CASES) {
  const spans = players.filter((p) => p.playerName === name && (spanLabel === null || p.spanLabel === spanLabel));
  if (spans.length === 0) { console.log(name, 'NOT FOUND'); continue; }
  const span = spanLabel ? spans[0] : spans.reduce((a, c) => (computeTalent(c) > computeTalent(a) ? c : a));
  const report = buildEvidenceReport(span);
  console.log(`\n=== ${name} (${span.spanLabel}), TAL=${computeTalent(span)} ===`);
  console.log('Evidence:');
  for (const e of report.evidence) console.log('  +', e.text);
  console.log('Counter-evidence:');
  for (const c of report.counterEvidence) console.log('  -', c.text);
}
