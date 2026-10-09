/**
 * Writes src/data/offBallProfile.json — for every draft-pool span, the share of his own plays that
 * came running off screens and hand-offs (OffScreen + Handoff possessions over all his play-type
 * possessions), x1000, and where the number comes from:
 *
 * - 'nba': the NBA.com play types (`src/data/raw/nbaStats/playtypes_player_offense.csv`, 2015-16
 *   on), the span's own seasons, possession-weighted.
 * - 'model': no play types (before 2015, or too few possessions). A ridge fit of the box score on
 *   the spans that have them; checked blind on 53 shooters it called "moves a lot" right 47 times
 *   (my own labels: 44). Its raw output is compressed and drifts with the era's three-point volume,
 *   so it is used as a rank: within the span's decade, among perimeter shooters, mapped onto the
 *   same rank of the real 2015+ distribution.
 * - 'blend': no play types for this span, but the player has them in other years (Klay's first
 *   seasons): half his own measured career share, half the model — a player's style travels.
 * - 'list': the user-validated historical movement shooters (`historicalMovementShooters.ts`),
 *   held at least at `LIST_FLOOR`.
 *
 * 2026-10-09, the user: shooter labels from real movement data, even though the label feeds TAL.
 * Run: npx tsx scripts/buildOffBallProfile.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { getHeightInches } from '../src/data/heightLookup';
import { historicalMovementShooterEvidenceForSpan } from '../src/data/historicalMovementShooters';
import { historicalCutterForSpan } from '../src/data/historicalCutters';

const OUTPUT = resolve(import.meta.dirname, '../src/data/offBallProfile.json');
const CUT_OUTPUT = resolve(import.meta.dirname, '../src/data/cuttingProfile.json');
/** A listed pre-2015 cutter's share of plays from cuts, by tier — where the 2015+ perimeter cutters
 * sit (Bruce Brown 0.25, Tony Allen 0.21, Mikal Bridges 0.11, Klay 0.09). */
const LIST_CUT_SHARE = { primary: 0.16, parttime: 0.09 };
const PLAY_TYPES = resolve(import.meta.dirname, '../src/data/raw/nbaStats/playtypes_player_offense.csv');
/** Fewer play-type possessions than this over the span and the model reads him instead. */
const MIN_POSSESSIONS = 400;
const LIST_FLOOR = 0.32;
const RIDGE = 1;

const isPerimeter = (s: PlayerSpan) => s.primaryPosition === 'PG' || s.primaryPosition === 'SG' || s.primaryPosition === 'SF';
const startYear = (s: PlayerSpan) => Number(s.spanLabel.slice(0, 4));
function endYear(s: PlayerSpan): number {
  const a = startYear(s);
  const tail = s.spanLabel.slice(5);
  if (tail.length === 4) return Number(tail);
  const b = Math.floor(a / 100) * 100 + Number(tail);
  return b < a ? b + 100 : b;
}

// 1. Real shares: player -> season start year -> [moving, all] possessions.
const real = new Map<string, Map<number, [number, number]>>();
const realCut = new Map<string, Map<number, number>>();
const lines = readFileSync(PLAY_TYPES, 'utf8').trim().split(/\r?\n/);
const head = lines[0].split(',');
const col = (k: string) => head.indexOf(k);
for (const line of lines.slice(1)) {
  const c = line.match(/("[^"]*"|[^,]*)(,|$)/g)!.map((x) => x.replace(/,$/, '').replace(/^"|"$/g, ''));
  const name = normalizePlayerName(c[col('PLAYER_NAME')]);
  const year = Number(c[col('SEASON')].slice(0, 4));
  const poss = Number(c[col('POSS')]) || 0;
  const byYear = real.get(name) ?? new Map<number, [number, number]>();
  const cell = byYear.get(year) ?? [0, 0];
  cell[1] += poss;
  if (c[col('PLAY_TYPE')] === 'OffScreen' || c[col('PLAY_TYPE')] === 'Handoff') cell[0] += poss;
  byYear.set(year, cell);
  real.set(name, byYear);
  if (c[col('PLAY_TYPE')] === 'Cut') {
    const cuts = realCut.get(name) ?? new Map<number, number>();
    cuts.set(year, (cuts.get(year) ?? 0) + poss);
    realCut.set(name, cuts);
  }
}
/** The player's whole measured career, when it is long enough to say anything. */
function careerShare(s: PlayerSpan): number | null {
  const byYear = real.get(normalizePlayerName(s.playerName));
  if (!byYear) return null;
  let moving = 0;
  let all = 0;
  for (const [m, a] of byYear.values()) { moving += m; all += a; }
  return all >= 3 * MIN_POSSESSIONS ? moving / all : null;
}
function realShare(s: PlayerSpan): number | null {
  const byYear = real.get(normalizePlayerName(s.playerName));
  if (!byYear) return null;
  let moving = 0;
  let all = 0;
  for (let y = startYear(s); y < endYear(s); y++) {
    const cell = byYear.get(y);
    if (cell) { moving += cell[0]; all += cell[1]; }
  }
  return all >= MIN_POSSESSIONS ? moving / all : null;
}

// 2. The box-score model, fitted on the spans with real shares.
function features(s: PlayerSpan): number[] {
  const b = s.box;
  const tpa = b.threePA ?? 0;
  const h = getHeightInches(s.playerName) ?? 78;
  return [1, b.ppg, b.rpg, b.apg, b.spg, b.bpg, b.fgPct, tpa, b.threePct ?? 0, b.ftPct ?? 0.75, b.tsPct, s.fga, (h - 78) / 3,
    tpa / Math.max(1, s.fga), b.apg / Math.max(1, s.fga)];
}
function ridge(X: number[][], y: number[]): number[] {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((row, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += row[i] * row[j]; A[i][k] += row[i] * y[n]; } });
  for (let i = 1; i < k; i++) A[i][i] += RIDGE;
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c]; }
  }
  return A.map((row, i) => row[k] / row[i]);
}
const shooter = (s: PlayerSpan) => isPerimeter(s) && (s.box.threePA ?? 0) >= 2;
const measured = draftPool.map((s) => ({ s, share: realShare(s) }));
const train = measured.filter((m) => m.share !== null && shooter(m.s));
const weights = ridge(train.map((m) => features(m.s)), train.map((m) => m.share!));
const predict = (s: PlayerSpan) => features(s).reduce((sum, x, i) => sum + x * weights[i], 0);

// 3. The model as a rank: within the decade, onto the real distribution.
const realSorted = train.map((m) => m.share!).sort((a, b) => a - b);
const quantile = (q: number) => realSorted[Math.min(realSorted.length - 1, Math.max(0, Math.round(q * (realSorted.length - 1))))];
const byDecade = new Map<number, number[]>();
for (const s of draftPool) if (shooter(s)) {
  const d = Math.floor(startYear(s) / 10) * 10;
  byDecade.set(d, [...(byDecade.get(d) ?? []), predict(s)]);
}
for (const v of byDecade.values()) v.sort((a, b) => a - b);
function modelShare(s: PlayerSpan): number {
  const pool = byDecade.get(Math.floor(startYear(s) / 10) * 10);
  if (!pool || pool.length < 20) return quantile(0.5);
  const p = predict(s);
  let lo = 0;
  let hi = pool.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (pool[m] <= p) lo = m + 1; else hi = m; }
  return quantile(lo / pool.length);
}

type Source = 'nba' | 'blend' | 'model' | 'list';
const out: Record<string, [number, Source]> = {};
const counts: Record<Source, number> = { nba: 0, blend: 0, model: 0, list: 0 };
for (const { s, share } of measured) {
  if (!shooter(s)) continue;
  const career = share === null ? careerShare(s) : null;
  let value = share ?? (career !== null ? (career + modelShare(s)) / 2 : modelShare(s));
  let source: Source = share !== null ? 'nba' : career !== null ? 'blend' : 'model';
  if (share === null && historicalMovementShooterEvidenceForSpan(s) && value < LIST_FLOOR) {
    value = LIST_FLOOR;
    source = 'list';
  }
  out[s.id] = [Math.round(value * 1000), source];
  counts[source]++;
}
writeFileSync(OUTPUT, `${JSON.stringify(out).replace(/\],"/g, '],\n"')}\n`);
console.log(`offBallProfile.json: ${Object.keys(out).length} perimeter shooter spans (nba ${counts.nba}, blend ${counts.blend}, model ${counts.model}, list ${counts.list})`);

// Cutting, perimeter players only (a big's cuts are rolls and dunker-spot dives, his label already
// says so): the NBA.com Cut share, else the listed historical cutters. Nothing for anyone else — the
// box score can't see a wing's cuts (checked on 2015+: rank agreement 0.66 for wings, 0.84 for bigs).
const cutOut: Record<string, [number, 'nba' | 'list']> = {};
const cutCounts = { nba: 0, list: 0 };
for (const s of draftPool) {
  if (!isPerimeter(s)) continue;
  const byYear = real.get(normalizePlayerName(s.playerName));
  const cuts = realCut.get(normalizePlayerName(s.playerName));
  let all = 0;
  let cut = 0;
  for (let y = startYear(s); y < endYear(s); y++) { all += byYear?.get(y)?.[1] ?? 0; cut += cuts?.get(y) ?? 0; }
  if (all >= MIN_POSSESSIONS) {
    cutOut[s.id] = [Math.round((1000 * cut) / all), 'nba'];
    cutCounts.nba++;
    continue;
  }
  const listed = historicalCutterForSpan(s);
  if (listed) {
    cutOut[s.id] = [Math.round(1000 * LIST_CUT_SHARE[listed.tier]), 'list'];
    cutCounts.list++;
  }
}
writeFileSync(CUT_OUTPUT, `${JSON.stringify(cutOut).replace(/\],"/g, '],\n"')}\n`);
console.log(`cuttingProfile.json: ${Object.keys(cutOut).length} perimeter spans (nba ${cutCounts.nba}, list ${cutCounts.list})`);
