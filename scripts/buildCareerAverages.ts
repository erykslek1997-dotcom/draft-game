/**
 * Extracts each player's TRUE whole-career per-game averages from the player-data source
 * folder into `src/data/careerAverages.json` — used by `DraftBoard.tsx`'s player-mode Draft
 * table, where the user explicitly asked for real career numbers instead of a single span's
 * (2026-08-13: "PTS AST itd powinno pokazywać średnie z kariery a nie z spanu").
 *
 * Why this needs its own extract rather than just averaging a player's existing `PlayerSpan`s:
 * the source's own `spans` are THEMSELVES overlapping rolling windows (2 real seasons wide,
 * stepped by 1 year — season N pairs with N+1, then N+1 pairs with N+2, etc.), the same raw
 * granularity `players.ts` builds every `PlayerSpan.box` from. A plain average across every span
 * would double-count almost every real season (each one falls inside ~2 overlapping windows),
 * silently overweighting mid-career years relative to the first/last season of the career.
 *
 * There's also no true single-season STL/BLK/FG%/3PT% in this source at all — `RawSeason`
 * (`span.seasons[]`) only carries points/rebounds/assists/FGA per real season; steals, blocks,
 * FG% and 3PT% exist only blended into the 2-season window's own `stats` block. So instead of
 * reconstructing single seasons (possible for 4 of 7 fields, not the other 3), this greedily
 * tiles each player's raw windows into a MINIMAL, NON-OVERLAPPING covering of their whole real
 * career (classic interval-covering: repeatedly extend the covered frontier with whichever
 * available window reaches furthest without leaving a gap), then takes one real, games-weighted
 * average across just that disjoint set for every field. Every real season is counted in
 * exactly one selected window — no double counting — at the same 2-season-window data
 * granularity the rest of the game already uses for every other stat, not a fabricated
 * single-season reconstruction for some fields and not others.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizePlayerName } from '../src/data/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = 'C:\\Users\\Eryks\\Desktop\\player-data';
const OUT_FILE = path.resolve(__dirname, '../src/data/careerAverages.json');

interface RawSpanStats {
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
  stealsPerGame: number;
  blocksPerGame: number;
  fieldGoalPct: number;
  threePointPct: number | null;
}
interface RawSpan {
  startSeasonEnd: number;
  endSeasonEnd: number;
  games?: number;
  stats?: RawSpanStats;
}
interface RawPlayer {
  name?: string;
  spans?: RawSpan[];
}

export interface CareerAverageRow {
  name: string;
  games: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  fgPct: number;
  threePct: number;
}

/** Greedily tiles a player's raw windows into a minimal set that covers their whole recorded
 * career with zero overlap. Standard "minimum intervals to cover a line" greedy: at each step,
 * among every not-yet-used window that starts at or before the next needed season (no gap),
 * keep the one that reaches furthest — every other reachable candidate at that step is now a
 * strict subset of what the kept one already covers, so it's safe to drop for good. */
function tileNonOverlapping(spans: RawSpan[]): RawSpan[] {
  let remaining = spans
    .filter((s) => s.games && s.stats)
    .sort((a, b) => a.startSeasonEnd - b.startSeasonEnd);
  const selected: RawSpan[] = [];
  let frontier = -Infinity;
  while (remaining.length > 0) {
    const reachable = remaining.filter((s) => s.startSeasonEnd <= frontier + 1);
    const choice =
      reachable.length > 0
        ? reachable.reduce((best, s) => (s.endSeasonEnd > best.endSeasonEnd ? s : best))
        : remaining[0]; // gap in the source data — jump to the next available window
    selected.push(choice);
    frontier = Math.max(frontier, choice.endSeasonEnd);
    remaining = remaining.filter((s) => s !== choice && s.startSeasonEnd > frontier);
  }
  return selected;
}

function weightedAverage(tiles: RawSpan[], get: (s: RawSpanStats) => number): number {
  const totalGames = tiles.reduce((sum, s) => sum + s.games!, 0);
  if (totalGames === 0) return 0;
  return tiles.reduce((sum, s) => sum + s.games! * get(s.stats!), 0) / totalGames;
}

const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
const rows: CareerAverageRow[] = [];
const seen = new Set<string>();
let skippedNoSpans = 0;

for (const file of files) {
  let raw: RawPlayer;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    continue;
  }
  if (!raw.name || !raw.spans || raw.spans.length === 0) {
    skippedNoSpans++;
    continue;
  }
  const key = normalizePlayerName(raw.name);
  if (seen.has(key)) continue; // one raw file per player already; defensive against dupes
  seen.add(key);

  const tiles = tileNonOverlapping(raw.spans);
  if (tiles.length === 0) continue;
  const games = tiles.reduce((sum, s) => sum + s.games!, 0);

  rows.push({
    name: raw.name,
    games,
    ppg: Math.round(weightedAverage(tiles, (s) => s.pointsPerGame) * 10) / 10,
    rpg: Math.round(weightedAverage(tiles, (s) => s.reboundsPerGame) * 10) / 10,
    apg: Math.round(weightedAverage(tiles, (s) => s.assistsPerGame) * 10) / 10,
    spg: Math.round(weightedAverage(tiles, (s) => s.stealsPerGame) * 10) / 10,
    bpg: Math.round(weightedAverage(tiles, (s) => s.blocksPerGame) * 10) / 10,
    fgPct: Math.round(weightedAverage(tiles, (s) => s.fieldGoalPct) * 10) / 1000,
    threePct: Math.round(weightedAverage(tiles, (s) => s.threePointPct ?? 0) * 10) / 1000,
  });
}

rows.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(OUT_FILE, JSON.stringify(rows));

console.log(`wrote ${OUT_FILE}`);
console.log(`players: ${rows.length}  skipped (no spans): ${skippedNoSpans}`);
const lebron = rows.find((r) => normalizePlayerName(r.name) === normalizePlayerName('LeBron James'));
if (lebron) console.log('sanity check, LeBron James career:', lebron);
