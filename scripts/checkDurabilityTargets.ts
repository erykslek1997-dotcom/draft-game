/**
 * Standing sanity check for DURABILITY, through the real engine.
 *
 * There are no user-supplied target ratings for this metric yet, so the check is against
 * externally known reputations: famous iron men must rate high and famously injury-hit careers
 * must rate low, and the era normalization must stop the 1950s from sweeping the top.
 */
import { players } from '../src/data/players';
import { computeDurability, durabilityBreakdown } from '../src/engine/durability';
import { spanEndYears } from '../src/engine/era';
import { computeTalent } from '../src/engine/talent';

// NOTE: these are judged PER SPAN, not per career, and the span picked is the player's peak-TAL
// window. So Grant Hill's peak (1995-97) correctly rates Durable — his injuries came after it —
// and Vince Carter's peak (2000-02) correctly rates Fragile despite a 22-season career, because
// that specific window is when his knees cost him games. Career reputation is the wrong yardstick.
const IRON = ['John Stockton', 'Karl Malone', 'A.C. Green', 'Michael Jordan', 'LeBron James',
  'Wilt Chamberlain', 'Bill Russell', 'Jason Kidd'];
const FRAGILE = ['Anthony Davis', 'Joel Embiid', 'Kawhi Leonard', 'Yao Ming',
  'Brandon Roy', 'Bill Walton', 'Kyrie Irving', 'Vince Carter'];
/** Not a durability expectation — this is the `NAME_ALIASES` regression check in
 * availabilityLookup.ts. The source export calls him Metta World Peace, so if the alias ever
 * breaks he reappears in the unrated list below. His peak span rating itself is low for a real
 * reason (the 2004 brawl suspension). */
const ALIAS_CHECK = ['Ron Artest'];

function peak(name: string) {
  const spans = players.filter((p) => p.playerName === name);
  if (!spans.length) return null;
  return spans.reduce((a, b) => (computeTalent(b) > computeTalent(a) ? b : a));
}

function show(label: string, names: string[]) {
  console.log(`\n=== ${label} ===`);
  for (const name of names) {
    const s = peak(name);
    if (!s) {
      console.log(`  ${name.padEnd(24)} NOT IN DATASET`);
      continue;
    }
    const b = durabilityBreakdown(s);
    const av = b.availability === null ? ' n/a' : b.availability.toFixed(1).padStart(5);
    console.log(
      `  ${name.padEnd(24)} ${s.spanLabel.padEnd(9)} avail=${av} (${b.games}/${b.possibleGames} G)` +
      `  eraMedian=${b.eraMedian.toFixed(1).padStart(5)}  DUR=${String(computeDurability(s)).padStart(3)}  ${b.tier}${b.rated ? '' : '  [UNRATED]'}`,
    );
  }
}
show('should rate HIGH (iron men)', IRON);
show('should rate LOW (injury-hit)', FRAGILE);
show('name-alias resolution check (must NOT be unrated)', ALIAS_CHECK);

// era neutrality: the whole point of the within-era percentile
console.log('\n=== era neutrality: mean DUR by decade (must be flat ~50, not sloped) ===');
const byDec = new Map<number, number[]>();
for (const s of players) {
  const years = spanEndYears(s.spanLabel);
  const end = years[years.length - 1] ?? 0;
  const dec = Math.floor(end / 10) * 10;
  const list = byDec.get(dec) ?? [];
  list.push(computeDurability(s));
  byDec.set(dec, list);
}
let worst = 0;
for (const dec of [...byDec.keys()].sort((a, b) => a - b)) {
  const v = byDec.get(dec)!;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  worst = Math.max(worst, Math.abs(mean - 50));
  console.log(`  ${dec}s  n=${String(v.length).padStart(5)}  mean DUR=${mean.toFixed(1)}`);
}
console.log(`largest deviation from 50: ${worst.toFixed(1)} points`);
console.log(worst < 5 ? 'PASS — era bias removed' : 'FAIL — era bias remains');

console.log('\n=== coverage ===');
const unrated = players.filter((s) => !durabilityBreakdown(s).rated);
console.log(`unrated spans: ${unrated.length} of ${players.length}`);
for (const s of unrated.slice(0, 15)) console.log(`  ${s.playerName} ${s.spanLabel}`);

console.log('\n=== distribution of DUR across the whole dataset ===');
const all = players.map(computeDurability).sort((a, b) => a - b);
const q = (p: number) => all[Math.floor(p * (all.length - 1))];
console.log(`min ${all[0]}  p10 ${q(0.1)}  p25 ${q(0.25)}  median ${q(0.5)}  p75 ${q(0.75)}  p90 ${q(0.9)}  max ${all[all.length - 1]}`);
const tiers = new Map<string, number>();
for (const s of players) {
  const t = durabilityBreakdown(s).tier;
  tiers.set(t, (tiers.get(t) ?? 0) + 1);
}
for (const [t, n] of [...tiers.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(12)} ${String(n).padStart(5)} (${((n / players.length) * 100).toFixed(1)}%)`);
}
