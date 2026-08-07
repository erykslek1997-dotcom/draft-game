/**
 * One-off (re-runnable) pass over the hand-curated players.ts rows: for each row, finds
 * the matching real player in the player-data source folder, gathers the actual per-season
 * position data for that row's specific span (calendar-year range parsed from spanLabel),
 * and recomputes secondaryPositions from real % of games at each position instead of the
 * original hand judgment call. Rewrites only the `secondary` array portion of each matched
 * row's tuple literal, leaving stats, comments, and formatting untouched. Rows for players
 * not found in the source folder (or whose span can't be parsed/matched to real seasons)
 * are left exactly as they are.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizePlayerName } from '../src/data/schema';
import type { Position } from '../src/data/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = 'C:\\Users\\Eryks\\Desktop\\player-data';
const PLAYERS_FILE = path.resolve(__dirname, '../src/data/players.ts');

const POSITION_MAP: Record<string, Position> = {
  PG: 'PG',
  SG: 'SG',
  SF: 'SF',
  PF: 'PF',
  C: 'C',
  G: 'SG',
  F: 'SF',
  'G-F': 'SG',
  'F-G': 'SF',
  'F-C': 'PF',
  'C-F': 'C',
  'PG-SG': 'PG',
  'SG-PG': 'SG',
  'SF-PF': 'SF',
  'PF-SF': 'PF',
  'PF-C': 'PF',
  'C-PF': 'C',
};

function normalizePosition(pos: string | undefined): Position | null {
  if (!pos) return null;
  return POSITION_MAP[pos] ?? null;
}

interface RawSeason {
  seasonEnd: number;
  position: string;
  games: number;
}
interface RawSpan {
  startSeasonEnd: number;
  endSeasonEnd: number;
  seasons: RawSeason[];
}
interface RawPlayer {
  id: string;
  name: string;
  spans: RawSpan[];
}

/** Curated rows use the name a player was best known by during that span; the source data
 * uses their current/final name. Only needed where the two genuinely differ. */
const NAME_ALIASES: Record<string, string> = {
  'ron artest': 'metta world peace',
};

// --- Load and index every raw player by normalized name ---
const nameIndex = new Map<string, RawPlayer>();
const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
for (const file of files) {
  let raw: RawPlayer;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
  } catch {
    continue;
  }
  if (!raw.name) continue;
  nameIndex.set(normalizePlayerName(raw.name), raw);
}

/** "1971-73" -> { startSeasonEnd: 1972, endSeasonEnd: 1973 } (nearest year matching the suffix). */
function parseSpanLabel(label: string): { startSeasonEnd: number; endSeasonEnd: number } | null {
  const m = label.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startCalendarYear = parseInt(m[1], 10);
  const endSuffix = m[2];
  const startSeasonEnd = startCalendarYear + 1;
  for (let candidate = startSeasonEnd; candidate <= startSeasonEnd + 5; candidate++) {
    if (String(candidate).slice(-2) === endSuffix) return { startSeasonEnd, endSeasonEnd: candidate };
  }
  return null;
}

const SECONDARY_POSITION_SHARE_THRESHOLD = 0.2;

/**
 * Real per-season position breakdown for a player, deduped by season across that player's
 * (overlapping) raw spans. `range` of null means "whole career".
 *
 * The career-wide fallback matters for the handful of curated spans the user supplied newer
 * Basketball-Reference exports for (2023-25) that postdate this source dump: without it,
 * those rows would keep their original hand-guessed secondary even when the player's entire
 * documented career says otherwise (e.g. Embiid, listed at C in every season on record).
 */
function realSecondaryPositions(
  raw: RawPlayer,
  range: { startSeasonEnd: number; endSeasonEnd: number } | null,
  curatedPrimary: Position,
): Position[] | null {
  const gamesByPosition = new Map<Position, number>();
  const seasonsSeen = new Set<number>();
  let totalGames = 0;
  for (const span of raw.spans) {
    for (const s of span.seasons) {
      if (range && (s.seasonEnd < range.startSeasonEnd || s.seasonEnd > range.endSeasonEnd)) continue;
      if (seasonsSeen.has(s.seasonEnd)) continue;
      seasonsSeen.add(s.seasonEnd);
      const pos = normalizePosition(s.position);
      if (!pos || !s.games) continue;
      gamesByPosition.set(pos, (gamesByPosition.get(pos) ?? 0) + s.games);
      totalGames += s.games;
    }
  }
  if (totalGames === 0) return null;
  const secondary: Position[] = [];
  for (const [pos, games] of gamesByPosition.entries()) {
    if (pos === curatedPrimary) continue;
    if (games / totalGames >= SECONDARY_POSITION_SHARE_THRESHOLD) secondary.push(pos);
  }
  return secondary;
}

// --- Rewrite matched rows in players.ts, touching only the secondary-array literal ---
const ROW_RE =
  /^(\s*\['[^']+',\s*(?:'[^']*'|"[^"]*"),\s*')([^']+)('\s*,\s*')([A-Z]+)('\s*,\s*)(\[[^\]]*\])(,.*)$/;

const source = fs.readFileSync(PLAYERS_FILE, 'utf8');
const lines = source.split('\n');

let matched = 0;
let changed = 0;
let noRawData = 0;
const changeLog: string[] = [];

const rewritten = lines.map((line) => {
  const m = line.match(ROW_RE);
  if (!m) return line;
  const [, prefix, spanLabel, mid, posStr, mid2, secondaryLiteral, rest] = m;

  // Recover the name via a looser match since it may be single- or double-quoted.
  const nameMatch = line.match(/^\s*\['[^']+',\s*(?:'([^']*)'|"([^"]*)")/);
  const name = nameMatch ? nameMatch[1] ?? nameMatch[2] : null;
  if (!name) return line;

  matched++;
  const normalized = normalizePlayerName(name);
  const raw = nameIndex.get(NAME_ALIASES[normalized] ?? normalized);
  if (!raw) {
    noRawData++;
    changeLog.push(`NO RAW MATCH: ${name} (${spanLabel})`);
    return line;
  }
  const range = parseSpanLabel(spanLabel);
  let newSecondary = range ? realSecondaryPositions(raw, range, posStr as Position) : null;
  if (newSecondary === null) {
    // The span predates/postdates this source dump — fall back to the player's whole
    // documented career rather than leaving an unverified hand guess in place.
    newSecondary = realSecondaryPositions(raw, null, posStr as Position);
    if (newSecondary === null) {
      noRawData++;
      changeLog.push(`NO SEASON DATA AT ALL: ${name} (${spanLabel})`);
      return line;
    }
    changeLog.push(`(career fallback used) ${name} (${spanLabel})`);
  }

  const oldList: string[] = JSON.parse(secondaryLiteral.replace(/'/g, '"'));
  const sameSet = oldList.length === newSecondary.length && oldList.every((p) => newSecondary.includes(p));
  if (sameSet) return line;

  changed++;
  const newLiteral = `[${newSecondary.map((p) => `'${p}'`).join(', ')}]`;
  changeLog.push(`${name} (${spanLabel}): [${oldList.join(', ')}] -> [${newSecondary.join(', ')}]`);
  return prefix + spanLabel + mid + posStr + mid2 + newLiteral + rest;
});

fs.writeFileSync(PLAYERS_FILE, rewritten.join('\n'));

console.log(`Rows matched: ${matched}`);
console.log(`No real season data found (left unchanged): ${noRawData}`);
console.log(`Rows changed: ${changed}`);
console.log('--- changes ---');
for (const c of changeLog) console.log(c);
