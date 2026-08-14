/**
 * Checks computeTalent's peak-career ranking against Ben Taylor's "Backpicks GOAT" top-40
 * (thinkingbasketball.net, 2022 podcast-series update - the most recent version, which flips
 * LeBron to #1 over Kareem vs. the original list). This list is explicitly one of the project's
 * stated methodological references, so it's a direct test of whether the formula's *shape*
 * (not just its correlation with RAPM, which only covers the TS-tracking era) matches an
 * expert's whole-history judgment, including pre-1990s players RAPM can't see at all.
 */
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import { BACKPICKS_GOAT_2022 } from '../src/engine/taylorValidatedNames';

const peakByName = new Map<string, number>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const t = computeTalent(p);
  const existing = peakByName.get(key);
  if (existing === undefined || t > existing) peakByName.set(key, t);
}

interface Row { name: string; goatRank: number; talent: number | undefined; }
const rows: Row[] = BACKPICKS_GOAT_2022.map((name, i) => ({
  name,
  goatRank: i + 1,
  talent: peakByName.get(normalizePlayerName(name)),
}));

const matched = rows.filter((r) => r.talent !== undefined) as { name: string; goatRank: number; talent: number }[];
console.log(`Matched ${matched.length} / ${BACKPICKS_GOAT_2022.length} Backpicks GOAT players in our dataset.\n`);

const missing = rows.filter((r) => r.talent === undefined);
if (missing.length) {
  console.log('=== Not found in our dataset (name-matching issue or not curated) ===');
  for (const m of missing) console.log(`#${m.goatRank} ${m.name}`);
  console.log();
}

// Our rank among just this matched set of 40, for an apples-to-apples comparison against goatRank.
const ourRanked = [...matched].sort((a, b) => b.talent - a.talent);
const ourRankByName = new Map(ourRanked.map((r, i) => [r.name, i + 1]));

console.log('=== Full comparison, sorted by our talent rank ===');
console.log('OurRank | GoatRank | Diff | Talent | Name');
for (const r of ourRanked) {
  const ourRank = ourRankByName.get(r.name)!;
  const diff = ourRank - r.goatRank; // positive = we rank them worse than Taylor does
  console.log(`${String(ourRank).padStart(7)} | ${String(r.goatRank).padStart(8)} | ${String(diff).padStart(4)} | ${String(r.talent).padStart(6)} | ${r.name}`);
}

function spearman(a: number[], b: number[]): number {
  const n = a.length;
  const d2 = a.reduce((sum, ai, i) => sum + (ai - b[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}
const ourRanks = ourRanked.map((r) => ourRankByName.get(r.name)!);
const goatRanksReordered = ourRanked.map((r) => r.goatRank);
console.log(`\nSpearman rank correlation (our talent rank vs Backpicks GOAT rank, n=${matched.length}): ${spearman(ourRanks, goatRanksReordered).toFixed(3)}`);

console.log('\n=== Biggest divergences (we rank them much worse than Taylor does) ===');
const withDiff = ourRanked.map((r) => ({ ...r, ourRank: ourRankByName.get(r.name)!, diff: ourRankByName.get(r.name)! - r.goatRank }));
for (const r of [...withDiff].sort((a, b) => b.diff - a.diff).slice(0, 10)) {
  console.log(`${r.name.padEnd(22)} ourRank=${r.ourRank} goatRank=${r.goatRank} diff=${r.diff} talent=${r.talent}`);
}
console.log('\n=== Biggest divergences (we rank them much better than Taylor does) ===');
for (const r of [...withDiff].sort((a, b) => a.diff - b.diff).slice(0, 10)) {
  console.log(`${r.name.padEnd(22)} ourRank=${r.ourRank} goatRank=${r.goatRank} diff=${r.diff} talent=${r.talent}`);
}
