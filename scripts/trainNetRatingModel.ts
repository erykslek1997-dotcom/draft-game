/**
 * Trains and validates the one item flagged as worth pursuing from the
 * `all_time_nba_draft_model_spec_v1.json` review (2026-08-14 chat): does a linear model built
 * on this project's own OTAL/DTAL/SPC actually predict REAL NBA team net rating, in real units
 * (points per 100 possessions) instead of the game's internal 0-100 relative scale?
 *
 * Data sources (both transient user exports per [[game-advanced-boxscore-exports]] — re-export
 * if these paths are gone):
 *   - team_advanced.csv (Desktop): team-game grain, OFFRTG/DEFRTG/NETRTG, 1997-2026.
 *   - advanced.csv (%TEMP%): player-game grain, has team+season+MIN but NO raw box counting
 *     stats, so it can only be used for real minutes-share, not for deriving a fresh BoxLine.
 *
 * Method: for every real (season, team), pull the real roster's minutes split from advanced.csv,
 * match each player by normalized name + season falling inside one of their existing spans in
 * this project's own full archive (`players` from src/data/players.ts — curated + generated +
 * curated-expanded, ~14,000 spans), and take the MIN-weighted average of that span's
 * computeOffensiveTalent/computeDefensiveTalent/computeSpacing. Regress the real OFFRTG/DEFRTG
 * against those weighted averages. This reuses the exact TAL/O-TAL/D-TAL/SPC the game already
 * computes — no new box-stat pipeline, no ML library, just the same
 * `fitLinearRegression`-over-two-points-arrays pattern already used in
 * precomputeCorrectionCoefficients.ts.
 *
 * Validation follows the project's own established bar (see [[game-advanced-boxscore-exports]]
 * — "don't build a scoring correction on a noisy signal"): split-half by season parity, fit on
 * one half, report OUT-OF-SAMPLE R² on the other half. In-sample R² alone is not trusted here.
 */
import fs from 'fs';
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import type { PlayerSpan } from '../src/data/schema';
import { parseSpanLabel } from './lib/rawPlayerData';
import { computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { computeSpacing } from '../src/engine/spacing';

const TEAM_ADVANCED_CSV = 'C:\\Users\\Eryks\\Desktop\\team_advanced.csv';
const PLAYER_ADVANCED_CSV = 'C:\\Users\\Eryks\\AppData\\Local\\Temp\\advanced.csv';

// --- Generic CSV loader: header-indexed, tolerant of the CRLF trap documented in
// [[game-advanced-boxscore-exports]] (naive split('\n') glues '\r' onto the last column). ---
function loadCsv(path: string): { header: string[]; rows: string[][] } {
  const text = fs.readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split(',');
  const rows = new Array<string[]>(lines.length - 1);
  for (let i = 1; i < lines.length; i++) rows[i - 1] = lines[i].split(',');
  return { header, rows };
}

function colIndex(header: string[], name: string): number {
  const idx = header.indexOf(name);
  if (idx === -1) throw new Error(`Column "${name}" not found in header: ${header.join(',')}`);
  return idx;
}

// --- Step 1: real team-season net rating, from team_advanced.csv, regular season only. ---
interface TeamSeasonReal {
  season: number;
  team: string;
  offRtg: number;
  defRtg: number;
  netRtg: number;
  games: number;
}

function loadTeamSeasonReal(): Map<string, TeamSeasonReal> {
  const { header, rows } = loadCsv(TEAM_ADVANCED_CSV);
  const iType = colIndex(header, 'type');
  const iTeam = colIndex(header, 'team');
  const iSeason = colIndex(header, 'season');
  const iOff = colIndex(header, 'OFFRTG');
  const iDef = colIndex(header, 'DEFRTG');
  const iNet = colIndex(header, 'NETRTG');

  const sums = new Map<string, { off: number; def: number; net: number; games: number; team: string; season: number }>();
  for (const r of rows) {
    if (r[iType] !== 'regular') continue;
    const season = parseInt(r[iSeason], 10);
    const team = r[iTeam];
    const key = `${season}|${team}`;
    const off = parseFloat(r[iOff]);
    const def = parseFloat(r[iDef]);
    const net = parseFloat(r[iNet]);
    if (!Number.isFinite(off) || !Number.isFinite(def) || !Number.isFinite(net)) continue;
    let entry = sums.get(key);
    if (!entry) {
      entry = { off: 0, def: 0, net: 0, games: 0, team, season };
      sums.set(key, entry);
    }
    entry.off += off;
    entry.def += def;
    entry.net += net;
    entry.games += 1;
  }

  const result = new Map<string, TeamSeasonReal>();
  for (const [key, e] of sums) {
    result.set(key, {
      season: e.season,
      team: e.team,
      offRtg: e.off / e.games,
      defRtg: e.def / e.games,
      netRtg: e.net / e.games,
      games: e.games,
    });
  }
  return result;
}

// --- Step 2: real roster minutes per (season, team), from advanced.csv, regular season only. ---
function loadRosterMinutes(): Map<string, Map<string, { minutes: number; displayName: string }>> {
  const { header, rows } = loadCsv(PLAYER_ADVANCED_CSV);
  const iType = colIndex(header, 'type');
  const iTeam = colIndex(header, 'team');
  const iSeason = colIndex(header, 'season');
  const iPlayer = colIndex(header, 'player');
  const iMin = colIndex(header, 'MIN');

  const result = new Map<string, Map<string, { minutes: number; displayName: string }>>();
  for (const r of rows) {
    if (r[iType] !== 'regular') continue;
    const min = parseFloat(r[iMin]);
    if (!Number.isFinite(min) || min <= 0) continue;
    const season = r[iSeason];
    const team = r[iTeam];
    const key = `${season}|${team}`;
    const name = r[iPlayer];
    const normName = normalizePlayerName(name);
    let roster = result.get(key);
    if (!roster) {
      roster = new Map();
      result.set(key, roster);
    }
    const existing = roster.get(normName);
    if (existing) existing.minutes += min;
    else roster.set(normName, { minutes: min, displayName: name });
  }
  return result;
}

// --- Step 3: index this project's own full archive by normalized name -> parsed span windows. ---
interface IndexedSpan {
  start: number;
  end: number;
  span: PlayerSpan;
}

function buildSpanIndex(): Map<string, IndexedSpan[]> {
  const index = new Map<string, IndexedSpan[]>();
  for (const span of players) {
    const parsed = parseSpanLabel(span.spanLabel);
    if (!parsed) continue;
    const key = normalizePlayerName(span.playerName);
    const entry: IndexedSpan = { start: parsed.startSeasonEnd, end: parsed.endSeasonEnd, span };
    const arr = index.get(key);
    if (arr) arr.push(entry);
    else index.set(key, [entry]);
  }
  return index;
}

/** Best-matching span for a (normalized name, season): must contain `season` in [start,end],
 * preferring the tightest window, tie-broken by closeness to the window's midpoint. */
function matchSpan(index: Map<string, IndexedSpan[]>, normName: string, season: number): PlayerSpan | null {
  const candidates = index.get(normName);
  if (!candidates) return null;
  let best: IndexedSpan | null = null;
  let bestWidth = Infinity;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (season < c.start || season > c.end) continue;
    const width = c.end - c.start;
    const dist = Math.abs(season - (c.start + c.end) / 2);
    if (width < bestWidth || (width === bestWidth && dist < bestDist)) {
      best = c;
      bestWidth = width;
      bestDist = dist;
    }
  }
  return best ? best.span : null;
}

// --- Step 4: build predicted-vs-real rows per team-season. ---
interface TrainingRow {
  season: number;
  team: string;
  realOff: number;
  realDef: number;
  realNet: number;
  predOff: number;
  predDef: number;
  predSpc: number;
  coverage: number;
  games: number;
}

const MIN_COVERAGE = 0.6;
const MIN_GAMES = 20;

function buildTrainingRows(): TrainingRow[] {
  const teamSeasonReal = loadTeamSeasonReal();
  const rosterMinutes = loadRosterMinutes();
  const spanIndex = buildSpanIndex();

  const rows: TrainingRow[] = [];
  let skippedNoRoster = 0;
  let skippedLowCoverage = 0;
  let skippedFewGames = 0;

  for (const [key, real] of teamSeasonReal) {
    if (real.games < MIN_GAMES) {
      skippedFewGames++;
      continue;
    }
    const roster = rosterMinutes.get(key);
    if (!roster) {
      skippedNoRoster++;
      continue;
    }

    let totalMin = 0;
    let matchedMin = 0;
    let sumOff = 0;
    let sumDef = 0;
    let sumSpc = 0;
    for (const [normName, { minutes }] of roster) {
      totalMin += minutes;
      const span = matchSpan(spanIndex, normName, real.season);
      if (!span) continue;
      matchedMin += minutes;
      sumOff += computeOffensiveTalent(span) * minutes;
      sumDef += computeDefensiveTalent(span) * minutes;
      sumSpc += computeSpacing(span) * minutes;
    }
    const coverage = totalMin > 0 ? matchedMin / totalMin : 0;
    if (coverage < MIN_COVERAGE) {
      skippedLowCoverage++;
      continue;
    }

    rows.push({
      season: real.season,
      team: real.team,
      realOff: real.offRtg,
      realDef: real.defRtg,
      realNet: real.netRtg,
      predOff: sumOff / matchedMin,
      predDef: sumDef / matchedMin,
      predSpc: sumSpc / matchedMin,
      coverage,
      games: real.games,
    });
  }

  console.log(
    `Team-seasons: ${rows.length} kept, ${skippedNoRoster} skipped (no roster join), ` +
      `${skippedLowCoverage} skipped (coverage < ${MIN_COVERAGE}), ${skippedFewGames} skipped (< ${MIN_GAMES} games).`,
  );
  return rows;
}

// --- Regression helpers (same pattern as precomputeCorrectionCoefficients.ts). ---
function fitLinearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  const cov = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
  const varX = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
  const slope = varX === 0 ? 0 : cov / varX;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

function rSquared(points: { x: number; y: number }[], slope: number, intercept: number): number {
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

function pearsonR(points: { x: number; y: number }[]): number {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  const cov = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
  const varX = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
  const varY = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  return varX === 0 || varY === 0 ? 0 : cov / Math.sqrt(varX * varY);
}

// --- Main ---
const rows = buildTrainingRows();
if (rows.length < 20) {
  console.error('Too few team-seasons survived to fit anything meaningful. Aborting.');
  process.exit(1);
}

const avgCoverage = rows.reduce((s, r) => s + r.coverage, 0) / rows.length;
console.log(`Average roster-minutes coverage: ${(avgCoverage * 100).toFixed(1)}%`);
console.log(`Season range: ${Math.min(...rows.map((r) => r.season))}-${Math.max(...rows.map((r) => r.season))}\n`);

function report(label: string, xKey: 'predOff' | 'predDef', yKey: 'realOff' | 'realDef', data: TrainingRow[]) {
  const points = data.map((r) => ({ x: r[xKey], y: r[yKey] }));
  const { slope, intercept } = fitLinearRegression(points);
  const r2 = rSquared(points, slope, intercept);
  const r = pearsonR(points);
  console.log(`${label}: n=${points.length}  r=${r.toFixed(3)}  R²=${r2.toFixed(3)}  ${yKey} = ${intercept.toFixed(2)} + ${slope.toFixed(4)} * ${xKey}`);
  return { slope, intercept, r2, r };
}

console.log('--- IN-SAMPLE (full dataset, fit and evaluated on the same rows) ---');
const offFit = report('Offense (predOff -> realOff)', 'predOff', 'realOff', rows);
const defFit = report('Defense (predDef -> realDef)', 'predDef', 'realDef', rows);
console.log(`Full precision: OFF_INTERCEPT=${offFit.intercept} OFF_SLOPE=${offFit.slope}`);
console.log(`Full precision: DEF_INTERCEPT=${defFit.intercept} DEF_SLOPE=${defFit.slope}`);

// Net rating: derive from the two independently-fit halves, not a separately-fit third
// regression — this is the honest end-to-end test of what a real team model would actually do
// (project offense and defense separately, then take the difference).
const netPoints = rows.map((r) => ({
  x: offFit.intercept + offFit.slope * r.predOff - (defFit.intercept + defFit.slope * r.predDef),
  y: r.realNet,
}));
const netR = pearsonR(netPoints);
const { slope: netSlope, intercept: netIntercept } = fitLinearRegression(netPoints);
const netR2 = rSquared(netPoints, netSlope, netIntercept);
console.log(`Net rating (derived off-def -> realNet): n=${netPoints.length}  r=${netR.toFixed(3)}  R²(vs y=x diagonal not fit, raw correlation matters more here)=${netR2.toFixed(3)}\n`);

console.log('--- OUT-OF-SAMPLE (split-half by season parity, the bar this project actually trusts) ---');
const odd = rows.filter((r) => r.season % 2 === 1);
const even = rows.filter((r) => r.season % 2 === 0);
console.log(`odd seasons n=${odd.length}, even seasons n=${even.length}`);

function outOfSample(train: TrainingRow[], test: TrainingRow[], xKey: 'predOff' | 'predDef', yKey: 'realOff' | 'realDef') {
  const trainPoints = train.map((r) => ({ x: r[xKey], y: r[yKey] }));
  const { slope, intercept } = fitLinearRegression(trainPoints);
  const testPoints = test.map((r) => ({ x: r[xKey], y: r[yKey] }));
  const r2 = rSquared(testPoints, slope, intercept);
  const r = pearsonR(testPoints);
  return { r, r2 };
}

for (const [trainName, train, testName, test] of [
  ['odd', odd, 'even', even],
  ['even', even, 'odd', odd],
] as const) {
  const off = outOfSample(train, test, 'predOff', 'realOff');
  const def = outOfSample(train, test, 'predDef', 'realDef');
  console.log(`fit on ${trainName} -> test on ${testName}:  offense r=${off.r.toFixed(3)} R²=${off.r2.toFixed(3)}   defense r=${def.r.toFixed(3)} R²=${def.r2.toFixed(3)}`);
}

console.log('\n--- Spacing as a covariate check (does predSpc add signal beyond predOff for real OFFRTG?) ---');
const spcCorr = pearsonR(rows.map((r) => ({ x: r.predSpc, y: r.realOff })));
console.log(`raw corr(predSpc, realOff) = ${spcCorr.toFixed(3)} (for comparison, corr(predOff, realOff) = ${offFit.r.toFixed(3)})`);

console.log('\n--- Face validity: 10 largest residuals (predicted net rating vs real, using the in-sample fit) ---');
const withResidual = rows
  .map((r) => {
    const predNet = offFit.intercept + offFit.slope * r.predOff - (defFit.intercept + defFit.slope * r.predDef);
    return { ...r, predNet, residual: predNet - r.realNet };
  })
  .sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));
for (const r of withResidual.slice(0, 10)) {
  console.log(
    `${r.season} ${r.team}: real net ${r.realNet.toFixed(1)}, predicted ${r.predNet.toFixed(1)} (residual ${r.residual.toFixed(1)}), coverage ${(r.coverage * 100).toFixed(0)}%`,
  );
}

console.log('\n--- Named sanity checks ---');
for (const [season, team] of [
  [2016, 'GSW'],
  [2016, 'PHI'],
  [2023, 'DEN'],
  [1998, 'CHI'],
  [2001, 'LAL'],
] as const) {
  const row = rows.find((r) => r.season === season && r.team === team);
  if (!row) {
    console.log(`${season} ${team}: not in filtered dataset (missing/low coverage).`);
    continue;
  }
  const predNet = offFit.intercept + offFit.slope * row.predOff - (defFit.intercept + defFit.slope * row.predDef);
  console.log(`${season} ${team}: real net ${row.realNet.toFixed(1)}, predicted net ${predNet.toFixed(1)}, coverage ${(row.coverage * 100).toFixed(0)}%`);
}
