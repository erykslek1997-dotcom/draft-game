import { players } from '../src/data/players';
import { pickForAi } from '../src/engine/aiDrafter';
import { computeTalent } from '../src/engine/talent';
import { draftPool } from '../src/data/draftPool';

/**
 * Standing check for the 2026-07-30 offense-heavy defense-need fix: a team with Doncic + Durant
 * (usageWeight already >=2, the OFFENSE_HEAVY_USAGE_THRESHOLD) drafted Brent Barry — a shooter,
 * not a real defender — at SG instead of a genuinely defensive-minded option, per the user's
 * direct report. Deterministic (replays pickForAi's own top-5 pool via repeated sampling) rather
 * than a single random draw, since pickForAi ends in a weighted lottery by design.
 */
const pick = (name: string, span?: string) => {
  const spans = players.filter((p) => p.playerName === name && (!span || p.spanLabel === span));
  if (!spans.length) throw new Error('missing ' + name + (span ? ' ' + span : ''));
  return spans.reduce((a, b) => (computeTalent(b) > computeTalent(a) ? b : a));
};

const doncic = pick('Luka Doncic', '2019-21');
const durant = pick('Kevin Durant', '2009-11');
const garnett = pick('Kevin Garnett', '2002-04');
const howard = pick('Dwight Howard');
const roster = [doncic, durant, garnett, howard];
const currentFgas = roster.map((p) => p.fga);
const available = draftPool.filter((p) => !roster.some((r) => r.id === p.id));

const N = 400;
const tally = new Map<string, number>();
for (let i = 0; i < N; i++) {
  const chosen = pickForAi(roster, currentFgas, available);
  tally.set(chosen.playerName, (tally.get(chosen.playerName) ?? 0) + 1);
}
const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
console.log(`=== pickForAi picks, ${N} runs (Doncic+Durant+Garnett+Howard rostered, SG only empty slot) ===`);
for (const [name, count] of sorted) {
  console.log(`  ${name.padEnd(22)} ${count} (${((count / N) * 100).toFixed(1)}%)`);
}

// The specific claim: genuine defenders should collectively outweigh non-defensive shooters
// (Brent Barry included) now that the roster is offense-heavy — not that Barry can never win the
// lottery (he does carry a real, if modest, defensive tag himself), just that he shouldn't
// dominate the distribution the way a purely-offensive candidate would.
const RIM_PROTECTOR_NAMES = new Set(['Rudy Gobert', 'Dikembe Mutombo', 'Bam Adebayo']);
const PERIMETER_DEFENDER_NAMES = new Set(['John Stockton', 'Jason Kidd', 'Gary Payton', 'Bruce Bowen', 'Tony Allen']);
let defenderShare = 0;
for (const [name, count] of tally) {
  if (RIM_PROTECTOR_NAMES.has(name) || PERIMETER_DEFENDER_NAMES.has(name)) defenderShare += count;
}
console.log(`\nreal defenders' combined share: ${((defenderShare / N) * 100).toFixed(1)}%`);
console.log(defenderShare / N >= 0.5 ? 'PASS — defenders dominate the offense-heavy pick' : 'FAIL — defenders do not dominate');
