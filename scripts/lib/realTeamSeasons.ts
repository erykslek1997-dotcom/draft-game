/**
 * Shared real-NBA-team-season data builder, factored out of `trainNetRatingModel.ts` (2026-08-14)
 * so a second script (`calibrateArchetypeComposition.ts`) can reuse the exact same real
 * roster/rating join instead of re-deriving it — any future fix to the matching logic benefits
 * both scripts instead of silently drifting between two copies.
 *
 * Data sources (both transient user exports per [[game-advanced-boxscore-exports]] — re-export
 * if these paths are gone):
 *   - team_advanced.csv (Desktop): team-game grain, OFFRTG/DEFRTG/NETRTG, 1997-2026.
 *   - advanced.csv (%TEMP%): player-game grain, has team+season+MIN but NO raw box counting
 *     stats — used only for real minutes-share, never to derive a fresh BoxLine.
 *
 * For every real (season, team), pulls the real roster's minutes split from advanced.csv, matches
 * each player by normalized name + season falling inside one of their existing spans in this
 * project's own full archive (`players` from src/data/players.ts — curated + generated +
 * curated-expanded, ~14,000 spans). Callers get the raw matched `{span, minutes}` list, not a
 * pre-aggregated number — what to aggregate (TAL for net rating, archetype composition for
 * calibration) is each caller's own concern.
 */
import fs from 'fs';
import { players } from '../../src/data/players';
import { normalizePlayerName } from '../../src/data/schema';
import type { PlayerSpan } from '../../src/data/schema';
import { parseSpanLabel } from './rawPlayerData';

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

function loadRosterMinutes(): Map<string, Map<string, number>> {
  const { header, rows } = loadCsv(PLAYER_ADVANCED_CSV);
  const iType = colIndex(header, 'type');
  const iTeam = colIndex(header, 'team');
  const iSeason = colIndex(header, 'season');
  const iPlayer = colIndex(header, 'player');
  const iMin = colIndex(header, 'MIN');

  const result = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r[iType] !== 'regular') continue;
    const min = parseFloat(r[iMin]);
    if (!Number.isFinite(min) || min <= 0) continue;
    const key = `${r[iSeason]}|${r[iTeam]}`;
    const normName = normalizePlayerName(r[iPlayer]);
    let roster = result.get(key);
    if (!roster) {
      roster = new Map();
      result.set(key, roster);
    }
    roster.set(normName, (roster.get(normName) ?? 0) + min);
  }
  return result;
}

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

export interface RealTeamSeason {
  season: number;
  team: string;
  realOff: number;
  realDef: number;
  realNet: number;
  games: number;
  /** matched-minutes / total-real-minutes for this team-season. */
  coverage: number;
  /** Every real roster player who matched a span in this project's own archive, with their real
   * minutes played for this specific team-season (NOT the span's own `fga`/box-derived minutes). */
  matchedPlayers: { span: PlayerSpan; minutes: number }[];
}

export interface BuildOptions {
  /** Team-seasons below this matched-minutes coverage are dropped. Default 0.6. */
  minCoverage?: number;
  /** Team-seasons with fewer real games than this are dropped (guards against tiny/lockout-
   * shortened-adjacent samples). Default 20. */
  minGames?: number;
}

export function buildRealTeamSeasons(options: BuildOptions = {}): RealTeamSeason[] {
  const minCoverage = options.minCoverage ?? 0.6;
  const minGames = options.minGames ?? 20;

  const teamSeasonReal = loadTeamSeasonReal();
  const rosterMinutes = loadRosterMinutes();
  const spanIndex = buildSpanIndex();

  const result: RealTeamSeason[] = [];
  let skippedNoRoster = 0;
  let skippedLowCoverage = 0;
  let skippedFewGames = 0;

  for (const [key, real] of teamSeasonReal) {
    if (real.games < minGames) {
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
    const matchedPlayers: { span: PlayerSpan; minutes: number }[] = [];
    for (const [normName, minutes] of roster) {
      totalMin += minutes;
      const span = matchSpan(spanIndex, normName, real.season);
      if (!span) continue;
      matchedMin += minutes;
      matchedPlayers.push({ span, minutes });
    }
    const coverage = totalMin > 0 ? matchedMin / totalMin : 0;
    if (coverage < minCoverage) {
      skippedLowCoverage++;
      continue;
    }

    result.push({
      season: real.season,
      team: real.team,
      realOff: real.offRtg,
      realDef: real.defRtg,
      realNet: real.netRtg,
      games: real.games,
      coverage,
      matchedPlayers,
    });
  }

  console.log(
    `Team-seasons: ${result.length} kept, ${skippedNoRoster} skipped (no roster join), ` +
      `${skippedLowCoverage} skipped (coverage < ${minCoverage}), ${skippedFewGames} skipped (< ${minGames} games).`,
  );
  return result;
}

// --- Small shared stats helpers, same pattern as precomputeCorrectionCoefficients.ts. ---
export function fitLinearRegression(points: { x: number; y: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  const cov = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
  const varX = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
  const slope = varX === 0 ? 0 : cov / varX;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

export function rSquared(points: { x: number; y: number }[], slope: number, intercept: number): number {
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

export function pearsonR(points: { x: number; y: number }[]): number {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  const cov = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
  const varX = points.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
  const varY = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  return varX === 0 || varY === 0 ? 0 : cov / Math.sqrt(varX * varY);
}
