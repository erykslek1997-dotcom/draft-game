/**
 * Validates computeTalent against real RAPM data (src/data/awards/peakRapm.json): matches
 * players by normalized name, compares our peak-talent ranking to the real RAPM ranking, and
 * surfaces the biggest divergences (plus a by-position breakdown) to find where the box-score
 * formula's weights are actually wrong, rather than guessing at further tuning blind.
 */
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import type { Position } from '../src/data/schema';
import rapmData from '../src/data/awards/peakRapm.json';

interface RapmEntry {
  name: string;
  netRank: number;
  offRank: number;
  odRank: number;
  defRank: number;
  peakOD: number;
  peakRapm: number;
  peakOff: number;
  peakDef: number;
}
const rapm = rapmData as RapmEntry[];

// --- Peak talent per player from our full dataset, plus earliest-span year as a career-start
// proxy: RAPM needs lineup-tracking data that only exists from ~1996-97 onward, so a player
// whose real prime predates that gets an artificially truncated "peak" in the RAPM data (it
// can only see whatever tail of their career overlaps the tracking era) — comparing our talent
// against that isn't testing the formula, it's testing a data-coverage gap. ---
const RAPM_ERA_CUTOFF = 1994;

function earliestSpanStartYear(spanLabel: string): number {
  const m = spanLabel.match(/^(\d{4})-/);
  return m ? parseInt(m[1], 10) : Infinity;
}

const peakByName = new Map<string, { talent: number; position: Position }>();
const earliestSpanYearByName = new Map<string, number>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const t = computeTalent(p);
  const existing = peakByName.get(key);
  if (!existing || t > existing.talent) peakByName.set(key, { talent: t, position: p.primaryPosition });

  const startYear = earliestSpanStartYear(p.spanLabel);
  const prevEarliest = earliestSpanYearByName.get(key);
  if (prevEarliest === undefined || startYear < prevEarliest) earliestSpanYearByName.set(key, startYear);
}

// --- Match ---
interface Matched {
  name: string;
  ourTalent: number;
  ourRank: number;
  position: Position;
  rapmNetRank: number;
  peakRapm: number;
}
const rapmByNormName = new Map<string, RapmEntry>();
for (const r of rapm) rapmByNormName.set(normalizePlayerName(r.name), r);

const matchedPairsAll: { name: string; talent: number; position: Position; rapmEntry: RapmEntry }[] = [];
for (const [key, val] of peakByName.entries()) {
  const r = rapmByNormName.get(key);
  if (r) matchedPairsAll.push({ name: key, talent: val.talent, position: val.position, rapmEntry: r });
}

const excludedPreEra = matchedPairsAll.filter(
  (m) => (earliestSpanYearByName.get(m.name) ?? Infinity) < RAPM_ERA_CUTOFF,
).length;
const matchedPairs = matchedPairsAll.filter(
  (m) => (earliestSpanYearByName.get(m.name) ?? Infinity) >= RAPM_ERA_CUTOFF,
);

console.log(`Players in our dataset: ${peakByName.size}`);
console.log(`Players in RAPM dataset: ${rapm.length}`);
console.log(`Matched (all eras): ${matchedPairsAll.length} (${((matchedPairsAll.length / rapm.length) * 100).toFixed(1)}% of RAPM list)`);
console.log(`Excluded as pre-RAPM-era (earliest span before ${RAPM_ERA_CUTOFF}): ${excludedPreEra}`);
console.log(`Matched (modern era only, this analysis): ${matchedPairs.length}`);

// Rank our matched players by talent (descending) to get an "our net rank" among the matched set
const ourRanked = [...matchedPairs].sort((a, b) => b.talent - a.talent);
const matched: Matched[] = ourRanked.map((m, i) => ({
  name: m.name,
  ourTalent: m.talent,
  ourRank: i + 1,
  position: m.position,
  rapmNetRank: m.rapmEntry.netRank,
  peakRapm: m.rapmEntry.peakRapm,
}));

// --- Spearman rank correlation between ourRank and rapmNetRank ---
function spearman(a: number[], b: number[]): number {
  const n = a.length;
  const d2 = a.reduce((sum, ai, i) => sum + (ai - b[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}
const ourRanks = matched.map((m) => m.ourRank);
const rapmRanksAmongMatched = [...matched]
  .sort((a, b) => a.rapmNetRank - b.rapmNetRank)
  .map((m, i) => ({ name: m.name, rank: i + 1 }));
const rapmRankMap = new Map(rapmRanksAmongMatched.map((r) => [r.name, r.rank]));
const rapmRanksReordered = matched.map((m) => rapmRankMap.get(m.name)!);
const rho = spearman(ourRanks, rapmRanksReordered);
console.log(`\nSpearman rank correlation (our talent rank vs real RAPM net rank): ${rho.toFixed(3)}`);

// --- Pearson correlation between raw talent score and raw peakRapm rating ---
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  const cov = a.reduce((s, x, i) => s + (x - meanA) * (b[i] - meanB), 0);
  const stdA = Math.sqrt(a.reduce((s, x) => s + (x - meanA) ** 2, 0));
  const stdB = Math.sqrt(b.reduce((s, x) => s + (x - meanB) ** 2, 0));
  return cov / (stdA * stdB);
}
const talents = matched.map((m) => m.ourTalent);
const peakRapms = matched.map((m) => m.peakRapm);
console.log(`Pearson correlation (raw talent score vs raw peak RAPM rating): ${pearson(talents, peakRapms).toFixed(3)}`);

// --- Biggest divergences: our rank vs rapm rank (using rank-among-matched for apples to apples) ---
const withDivergence = matched.map((m) => ({
  ...m,
  rapmRankAmongMatched: rapmRankMap.get(m.name)!,
  divergence: m.ourRank - rapmRankMap.get(m.name)!, // positive = we rank them WORSE than RAPM does
}));

const weOverrate = [...withDivergence].sort((a, b) => b.divergence - a.divergence).slice(0, 15);
const weUnderrate = [...withDivergence].sort((a, b) => a.divergence - b.divergence).slice(0, 15);

console.log('\n=== Players we rank MUCH BETTER than real RAPM does (possible overrating) ===');
for (const m of weOverrate) {
  console.log(`${m.name.padEnd(25)} ourRank=${m.ourRank}  rapmRank=${m.rapmRankAmongMatched}  (diff ${m.divergence})  pos=${m.position}  ourTalent=${m.ourTalent}  peakRapm=${m.peakRapm}`);
}

console.log('\n=== Players we rank MUCH WORSE than real RAPM does (possible underrating) ===');
for (const m of weUnderrate) {
  console.log(`${m.name.padEnd(25)} ourRank=${m.ourRank}  rapmRank=${m.rapmRankAmongMatched}  (diff ${m.divergence})  pos=${m.position}  ourTalent=${m.ourTalent}  peakRapm=${m.peakRapm}`);
}

// --- By-position bias check: average divergence per position ---
console.log('\n=== Average rank divergence by position (positive = we underrate this position relative to RAPM) ===');
const byPos = new Map<Position, number[]>();
for (const m of withDivergence) {
  const arr = byPos.get(m.position) ?? [];
  arr.push(m.divergence);
  byPos.set(m.position, arr);
}
for (const pos of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
  const arr = byPos.get(pos) ?? [];
  if (arr.length === 0) continue;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  console.log(`${pos}: mean divergence = ${mean.toFixed(1)} (n=${arr.length})`);
}

// --- Center-specific breakdown: is the "we underrate centers" signal broad, or concentrated
// in a specific subgroup (e.g. elite defensive anchors whose true team-defense value exceeds
// simple steal/block counting stats)? ---
const centerDivergences = withDivergence.filter((m) => m.position === 'C').sort((a, b) => b.divergence - a.divergence);
console.log('\n=== Centers: biggest "we underrate" (top 10) ===');
for (const m of centerDivergences.slice(0, 10)) {
  console.log(`${m.name.padEnd(25)} ourRank=${m.ourRank}  rapmRank=${m.rapmRankAmongMatched}  ourTalent=${m.ourTalent}  peakRapm=${m.peakRapm}  peakDef=${rapm.find(r => normalizePlayerName(r.name) === m.name)?.peakDef}`);
}
console.log('\n=== Centers: biggest "we overrate" (top 10) ===');
for (const m of centerDivergences.slice(-10).reverse()) {
  console.log(`${m.name.padEnd(25)} ourRank=${m.ourRank}  rapmRank=${m.rapmRankAmongMatched}  ourTalent=${m.ourTalent}  peakRapm=${m.peakRapm}  peakDef=${rapm.find(r => normalizePlayerName(r.name) === m.name)?.peakDef}`);
}

// --- Robust position-bias check: the plain average above is dominated by noise among
// near-replacement-level bench players (huge rank swings from tiny value differences in a
// tightly clustered tail) — restrict to meaningfully-talented players so the signal reflects
// real rotation/starter-caliber value judgments, not bottom-of-the-pool noise. ---
const MEANINGFUL_TALENT_THRESHOLD = 40;
console.log(`\n=== Average rank divergence by position, restricted to talent >= ${MEANINGFUL_TALENT_THRESHOLD} (robust signal) ===`);
const byPosMeaningful = new Map<Position, number[]>();
for (const m of withDivergence) {
  if (m.ourTalent < MEANINGFUL_TALENT_THRESHOLD) continue;
  const arr = byPosMeaningful.get(m.position) ?? [];
  arr.push(m.divergence);
  byPosMeaningful.set(m.position, arr);
}
for (const pos of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
  const arr = byPosMeaningful.get(pos) ?? [];
  if (arr.length === 0) continue;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const sorted = [...arr].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`${pos}: mean divergence = ${mean.toFixed(1)}, median = ${median} (n=${arr.length})`);
}

// --- Within-position correlation: cleaner than rank-divergence for judging a position-
// specific correction, since it's not contaminated by shifts in OTHER positions' scores
// (rank divergence is relative across the whole matched pool, so correcting PF mechanically
// shifts SF's relative rank too, even though SF's own talent didn't change). ---
console.log('\n=== Within-position Pearson correlation (talent vs peakRapm), talent >= 40 only ===');
const byPosForCorr = new Map<Position, { talent: number; rapm: number }[]>();
for (const m of matched) {
  if (m.ourTalent < MEANINGFUL_TALENT_THRESHOLD) continue;
  const arr = byPosForCorr.get(m.position) ?? [];
  arr.push({ talent: m.ourTalent, rapm: m.peakRapm });
  byPosForCorr.set(m.position, arr);
}
for (const pos of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
  const arr = byPosForCorr.get(pos) ?? [];
  if (arr.length < 5) continue;
  const r = pearson(arr.map((x) => x.talent), arr.map((x) => x.rapm));
  console.log(`${pos}: r = ${r.toFixed(3)} (n=${arr.length})`);
}
