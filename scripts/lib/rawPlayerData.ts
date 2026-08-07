/**
 * Shared raw-source-data parsing/derivation logic used by every script that reads the
 * player-data JSON folder (generatePlayers.ts, expandCuratedSpans.ts, deriveCuratedSecondary.ts).
 * Pure functions and types only — no file I/O side effects at import time, unlike the
 * generation scripts themselves, so this is safe to import from multiple entry points.
 */
import fs from 'fs';
import path from 'path';
import type { OffensiveArchetype, DefensiveRole, Position } from '../../src/data/schema';

export const DATA_DIR = 'C:\\Users\\Eryks\\Desktop\\player-data';

export interface RawSeason {
  seasonEnd: number;
  team: string;
  position: string;
  games: number;
}

export interface RawStats {
  minutesPerGame: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
  stealsPerGame: number;
  blocksPerGame: number;
  fieldGoalAttempts: number;
  fieldGoalPct: number;
  threePointAttempts: number;
  threePointPct: number | null;
  freeThrowAttempts: number;
  freeThrowPct: number;
}

export interface RawSpan {
  id: string;
  startSeasonEnd: number;
  endSeasonEnd: number;
  eligible: boolean;
  games: number;
  fgaPerGame: number;
  seasons: RawSeason[];
  stats: RawStats;
}

export interface RawPlayer {
  id: string;
  name: string;
  spans: RawSpan[];
}

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

export function normalizePosition(pos: string | undefined): Position | null {
  if (!pos) return null;
  return POSITION_MAP[pos] ?? null;
}

// --- Quality gates ---
export const PLAYER_MIN_GAMES = 40;
export const PLAYER_MIN_MPG = 15;
export const SPAN_MIN_GAMES = 30;
export const SPAN_MIN_MPG = 10;

export function spanQualifies(span: RawSpan): boolean {
  return span.eligible && span.games >= SPAN_MIN_GAMES && span.stats.minutesPerGame >= SPAN_MIN_MPG;
}

export function playerQualifies(spans: RawSpan[]): boolean {
  return spans.some((s) => s.eligible && s.games >= PLAYER_MIN_GAMES && s.stats.minutesPerGame >= PLAYER_MIN_MPG);
}

// --- Derived box stats ---
export interface DerivedBox {
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  fgPct: number;
  threePct: number;
  threePA: number;
  ftPct: number;
  tsPct: number;
  fga: number;
}

export function deriveBox(span: RawSpan): DerivedBox {
  const g = span.games;
  const fga = span.fgaPerGame;
  const fta = span.stats.freeThrowAttempts / g;
  const ppg = span.stats.pointsPerGame;
  const tsDenom = 2 * (fga + 0.44 * fta);
  const tsPct = tsDenom > 0 ? ppg / tsDenom : 0;
  return {
    ppg,
    rpg: span.stats.reboundsPerGame,
    apg: span.stats.assistsPerGame,
    spg: span.stats.stealsPerGame,
    bpg: span.stats.blocksPerGame,
    fgPct: span.stats.fieldGoalPct / 100,
    threePct: (span.stats.threePointPct ?? 0) / 100,
    threePA: span.stats.threePointAttempts / g,
    ftPct: span.stats.freeThrowPct / 100,
    tsPct: Math.max(0, Math.min(1, tsPct)),
    fga,
  };
}

// --- Archetype/role classification: documented rules-based heuristic, no qualitative
// scouting data exists in the source, so this approximates from box shape + position.
// Only used for players with no hand judgment call to fall back on (see expandCuratedSpans.ts
// for how curated players' extra windows get archetype/role instead). ---
export function classifyOffense(position: Position, box: DerivedBox): OffensiveArchetype {
  const threeRate = box.fga > 0 ? box.threePA / box.fga : 0;
  const astRate = box.ppg > 0 ? box.apg / box.ppg : 0;
  const isBig = position === 'C' || position === 'PF';

  if (isBig) {
    if (astRate > 0.55 && box.apg >= 3) return 'Versatile Big';
    if (threeRate > 0.3) return 'Stretch Big';
    if (threeRate > 0.12) return 'Versatile Big';
    if (box.fga >= 11) return 'Post Scorer';
    return 'Roll & Cut Big';
  }
  if (position === 'SF') {
    if (astRate > 0.45 && box.apg >= 4) return box.fga >= 13 ? 'Shot Creator' : 'Secondary Ball Handler';
    if (threeRate > 0.4 && box.fga < 11) return 'Stationary Shooter';
    if (box.fga >= 14) return 'Shot Creator';
    if (box.fga >= 9) return 'Slasher';
    return 'Athletic Finisher';
  }
  // PG / SG
  if (astRate > 0.6 && box.apg >= 5) return box.fga >= 13 ? 'Primary Ball Handler' : 'Secondary Ball Handler';
  if (threeRate > 0.42 && box.fga < 11) return 'Off Screen Shooter';
  if (box.fga >= 15) return 'Shot Creator';
  if (box.fga < 8) return 'Athletic Finisher';
  return 'Secondary Ball Handler';
}

export function classifyDefense(position: Position, box: DerivedBox): DefensiveRole {
  const isBig = position === 'C' || position === 'PF';
  if (isBig) {
    if (box.bpg >= 1.8) return 'Anchor Big';
    if (box.bpg >= 0.9 || box.rpg >= 9) return 'Mobile Big';
    if (box.rpg >= 6) return 'Helper';
    return 'Low Activity';
  }
  if (box.spg >= 1.6) return position === 'PG' ? 'Point of Attack' : 'Wing Stopper';
  if (box.spg >= 1.1) return 'Chaser';
  if (box.spg >= 0.8) return 'Helper';
  return 'Low Activity';
}

export function spanLabelFor(span: RawSpan): string {
  const startCalendarYear = span.startSeasonEnd - 1;
  const endShort = String(span.endSeasonEnd).slice(-2);
  return `${startCalendarYear}-${endShort}`;
}

function mostRecentPosition(span: RawSpan): Position | null {
  const sorted = [...span.seasons].sort((a, b) => b.seasonEnd - a.seasonEnd);
  for (const s of sorted) {
    const pos = normalizePosition(s.position);
    if (pos) return pos;
  }
  return null;
}

/** A position must account for at least this share of a span's games to count as a
 * realistic secondary — occasional token minutes at another spot shouldn't grant eligibility. */
export const SECONDARY_POSITION_SHARE_THRESHOLD = 0.2;

export interface PositionBreakdown {
  primary: Position | null;
  secondary: Position[];
}

/**
 * Derives primary/secondary position from the actual per-season position data within a
 * span (or the whole career, when `seasons` covers more than one span's window), weighted
 * by games played at each. A player logged at one position for ~100% of their games (a
 * classic center like Kareem, Embiid, or Shaq) correctly gets no secondary at all, while a
 * player who genuinely split real minutes across two positions does.
 */
export function computePositionBreakdown(seasons: RawSeason[], fallbackSpan?: RawSpan): PositionBreakdown {
  const gamesByPosition = new Map<Position, number>();
  const seasonsSeen = new Set<number>();
  let totalGames = 0;
  for (const s of seasons) {
    if (seasonsSeen.has(s.seasonEnd)) continue;
    seasonsSeen.add(s.seasonEnd);
    const pos = normalizePosition(s.position);
    if (!pos || !s.games) continue;
    gamesByPosition.set(pos, (gamesByPosition.get(pos) ?? 0) + s.games);
    totalGames += s.games;
  }
  if (totalGames === 0) {
    return { primary: fallbackSpan ? mostRecentPosition(fallbackSpan) : null, secondary: [] };
  }
  const entries = [...gamesByPosition.entries()].sort((a, b) => b[1] - a[1]);
  const primary = entries[0][0];
  const secondary = entries
    .slice(1)
    .filter(([, games]) => games / totalGames >= SECONDARY_POSITION_SHARE_THRESHOLD)
    .map(([pos]) => pos);
  return { primary, secondary };
}

/** "1971-73" -> { startSeasonEnd: 1972, endSeasonEnd: 1973 } (nearest year matching the suffix). */
export function parseSpanLabel(label: string): { startSeasonEnd: number; endSeasonEnd: number } | null {
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

/** Loads every raw player file, indexed by normalized name. Built once per script run. */
export function loadRawPlayersByName(normalizeName: (name: string) => string): Map<string, RawPlayer> {
  const index = new Map<string, RawPlayer>();
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    let raw: RawPlayer;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    if (!raw.name) continue;
    index.set(normalizeName(raw.name), raw);
  }
  return index;
}
