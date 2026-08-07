/**
 * Checks computeTalent's peak-talent ranking against Ben Taylor's WOWYR ("With Or Without You,
 * Regressed") — a game-level plus-minus reconstruction that works retroactively back to the
 * 1950s using final-score with/without-you splits (thinkingbasketball.net/metrics/wowyr/, raw
 * data in src/data/raw/wowyrPrimeCareer.json). Unlike RAPM/DARKO, which only exist from 1997-98
 * onward, this is real quantitative plus-minus-style coverage for the pre-tracking era — the
 * closest thing available to ground truth for Magic/Bird/Kareem/Russell.
 *
 * Conclusion from the first run of this script (kept here since it's the reason no correction
 * mechanism was built off this data): overall Spearman correlation is weak (~0.36-0.42, vs.
 * RAPM's much stronger post-correction numbers and the Taylor top-10 list's 0.79), and — the
 * key diagnostic — the already-DARKO/RAPM-validated 1997+ cohort correlates about as weakly
 * (~0.37) as the pre-1997 cohort (~0.42). If our formula were specifically wrong pre-1997, the
 * modern cohort should correlate much better than the historical one; it doesn't. That points to
 * WOWYR itself being a noisier signal (single-analyst regression on final scores only, with real
 * acknowledged variability - see its own "Variability" column and Part IV's discussion of
 * weaknesses) rather than a real gap in computeTalent. Treated as a reference/validation
 * checkpoint only, same as the awards data - not fed into computeTalent or any correction bonus.
 */
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import primeCareerData from '../src/data/raw/wowyrPrimeCareer.json';

function fuzzyKey(name: string): string {
  return normalizePlayerName(name)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// WOWYR's source keys are inconsistent: usually "First.Last", but old-timers with common
// surnames are stored surname-first ("Robertson..Oscar." = Oscar Robertson) or as a bare
// surname only ("Chamberlain", "Havlicek"). Try direct match, then word-order-reversed, then
// surname-only (only if unique in our pool) before giving up.
const realNamesByFuzzy = new Map<string, string>();
const surnameOnlyIndex = new Map<string, string[]>();
for (const p of players) {
  const fk = fuzzyKey(p.playerName);
  realNamesByFuzzy.set(fk, p.playerName);
  const parts = p.playerName.split(' ');
  const surname = fuzzyKey(parts[parts.length - 1]);
  const arr = surnameOnlyIndex.get(surname) ?? [];
  if (!arr.includes(p.playerName)) arr.push(p.playerName);
  surnameOnlyIndex.set(surname, arr);
}

interface WowyrRow {
  key: string;
  primeWowyr: number;
  primeBegin: number;
}
const rows: WowyrRow[] = (primeCareerData.rows as string[][])
  .filter((r) => !r[0].startsWith('np')) // "np"-prefixed rows are a leftover duplicate with 0 career GP
  .map((r) => ({ key: r[0], primeWowyr: parseFloat(r[1]), primeBegin: parseInt(r[5], 10) }));

function matchRealName(key: string): string | null {
  const fk = fuzzyKey(key.replace(/\./g, ' '));
  const direct = realNamesByFuzzy.get(fk);
  if (direct) return direct;
  const words = fk.split(' ').filter(Boolean);
  if (words.length === 2) {
    const rev = realNamesByFuzzy.get(`${words[1]} ${words[0]}`);
    if (rev) return rev;
  }
  const bySurname = surnameOnlyIndex.get(words[words.length - 1]);
  if (bySurname && bySurname.length === 1) return bySurname[0];
  return null;
}

const peakTalentByName = new Map<string, number>();
for (const p of players) {
  const t = computeTalent(p);
  if (!peakTalentByName.has(p.playerName) || t > peakTalentByName.get(p.playerName)!) peakTalentByName.set(p.playerName, t);
}

interface Paired {
  name: string;
  talent: number;
  primeWowyr: number;
  primeBegin: number;
}
const paired: Paired[] = [];
let unmatchedCount = 0;
for (const row of rows) {
  const realName = matchRealName(row.key);
  if (!realName) {
    unmatchedCount++;
    continue;
  }
  const talent = peakTalentByName.get(realName);
  if (talent === undefined) continue;
  paired.push({ name: realName, talent, primeWowyr: row.primeWowyr, primeBegin: row.primeBegin });
}
console.log(`WOWYR rows: ${rows.length}, matched to a real name: ${rows.length - unmatchedCount}, paired with our talent: ${paired.length}`);

function spearman(a: number[], b: number[]): number {
  const n = a.length;
  const d2 = a.reduce((sum, ai, i) => sum + (ai - b[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}
function rankOf(values: number[]): number[] {
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const ranks = new Array(values.length);
  sorted.forEach((item, rank) => (ranks[item.i] = rank + 1));
  return ranks;
}
function report(label: string, data: Paired[]) {
  if (data.length < 5) return;
  const rho = spearman(rankOf(data.map((d) => d.talent)), rankOf(data.map((d) => d.primeWowyr)));
  console.log(`${label} (n=${data.length}): Spearman = ${rho.toFixed(3)}`);
}

const MEANINGFUL = 40;
const meaningful = paired.filter((p) => p.talent >= MEANINGFUL);
report(`ALL matched, talent >= ${MEANINGFUL}`, meaningful);
report(`PRE-1997 primes, talent >= ${MEANINGFUL}`, meaningful.filter((p) => p.primeBegin > 0 && p.primeBegin < 1997));
report(`1997+ primes, talent >= ${MEANINGFUL} (sanity check: should correlate well if the metric were reliable)`, meaningful.filter((p) => p.primeBegin >= 1997));
