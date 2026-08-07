/**
 * Checks computeTalent's peak-only ranking against Ben Taylor's own final "Greatest Peaks"
 * top-10 countdown (thinkingbasketball.net video series) - unlike the career-spanning
 * Backpicks GOAT-40 list, this is peak-for-peak, the same thing computeTalent measures, so
 * it's the cleanest comparison available without the career-vs-peak confound.
 */
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';

const TAYLOR_TOP10: string[] = [
  'Michael Jordan', 'LeBron James', "Shaquille O'Neal", 'Hakeem Olajuwon', 'Larry Bird',
  'Kareem Abdul-Jabbar', 'Stephen Curry', 'Kevin Garnett', 'Tim Duncan', 'Magic Johnson',
];

const peakByName = new Map<string, number>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const t = computeTalent(p);
  const existing = peakByName.get(key);
  if (existing === undefined || t > existing) peakByName.set(key, t);
}

const rows = TAYLOR_TOP10.map((name, i) => ({ name, taylorRank: i + 1, talent: peakByName.get(normalizePlayerName(name))! }));
const ourRanked = [...rows].sort((a, b) => b.talent - a.talent);
console.log('OurRank | TaylorRank | Talent | Name');
ourRanked.forEach((r, i) => console.log(`${i + 1}`.padStart(7), '|', `${r.taylorRank}`.padStart(10), '|', `${r.talent}`.padStart(6), '|', r.name));

function spearman(a: number[], b: number[]): number {
  const n = a.length;
  const d2 = a.reduce((sum, ai, i) => sum + (ai - b[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}
const ourRanks = ourRanked.map((_, i) => i + 1);
const taylorRanksReordered = ourRanked.map((r) => r.taylorRank);
console.log(`\nSpearman (peak-for-peak, n=10): ${spearman(ourRanks, taylorRanksReordered).toFixed(3)}`);
