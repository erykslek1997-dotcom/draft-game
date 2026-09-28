import type { Position } from '../data/schema';
import type { DailyPool, GolfGrade, Lineup } from '../engine/bestFive';

/**
 * 2026-09-28, the user: "okej, teraz daily … na ten moment tylko slot machine". The Daily Slot
 * Machine: one board a day, the same for everyone, one attempt, and a streak of days played —
 * kept in this browser's localStorage (there is no backend). Brought back from the old
 * `bestFiveProgress.ts` (removed 2026-09-27 with the daily puzzle), keyed by the player's LOCAL
 * date so the board turns over at their midnight, not UTC's.
 */
const STORAGE_KEY = 'draftverse.dailySlot.v1';
/** Kept local (not engine/positions) so the menu can read the streak without loading the engine. */
const STARTER_SLOTS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

interface DailyEntry {
  lineupIds: Partial<Record<Position, string>>;
  grade: GolfGrade;
  composite: number;
}

export interface Streak {
  current: number;
  best: number;
  lastDay: string | null;
}

interface Progress {
  daily: Record<string, DailyEntry>;
  streak: Streak;
}

const EMPTY: Progress = { daily: {}, streak: { current: 0, best: 0, lastDay: null } };

function read(): Progress {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Progress;
    return parsed?.daily && parsed.streak ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

function write(progress: Progress): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Blocked storage — the result still shows, it just isn't remembered.
  }
}

/** Today's date in the player's own time zone, YYYY-MM-DD. */
export function localDayKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The board seed for a day — its own namespace, so no random board ever equals a daily one. */
export function dailySeed(day: string): string {
  return `daily:${day}`;
}

function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDayKey(new Date(y, m - 1, d - 1));
}

/** The streak as it stands on `today` — a streak whose last play was before yesterday is over. */
export function currentStreak(today: string): Streak {
  const { streak } = read();
  const alive = streak.lastDay === today || streak.lastDay === previousDay(today);
  return alive ? streak : { ...streak, current: 0 };
}

/** Today's result, if already played. */
export function dailyEntry(today: string): { grade: GolfGrade; composite: number } | null {
  const entry = read().daily[today];
  return entry ? { grade: entry.grade, composite: entry.composite } : null;
}

/** Today's already-submitted lineup, rebuilt from the day's pool, or null if not played yet. */
export function savedDailyLineup(today: string, pool: DailyPool): Lineup | null {
  const entry = read().daily[today];
  if (!entry) return null;
  const lineup: Lineup = {};
  for (const slot of STARTER_SLOTS) {
    const span = pool.bySlot[slot].find((s) => s.id === entry.lineupIds[slot]);
    if (!span) return null;
    lineup[slot] = span;
  }
  return lineup;
}

/** Records today's submission (once) and advances the streak. Returns the updated streak. */
export function recordDailyResult(today: string, lineup: Lineup, grade: GolfGrade, composite: number): Streak {
  const progress = read();
  if (progress.daily[today]) return currentStreak(today);
  const lineupIds: Partial<Record<Position, string>> = {};
  for (const slot of STARTER_SLOTS) lineupIds[slot] = lineup[slot]?.id;
  const prev = progress.streak;
  const current = prev.lastDay === previousDay(today) ? prev.current + 1 : 1;
  const streak: Streak = { current, best: Math.max(prev.best, current), lastDay: today };
  // Only the last month of boards is kept; older days can't be replayed anyway.
  const recentDays = Object.keys(progress.daily).sort().slice(-30);
  const daily: Record<string, DailyEntry> = {};
  for (const day of recentDays) daily[day] = progress.daily[day];
  daily[today] = { lineupIds, grade, composite };
  write({ daily, streak });
  return streak;
}

/** Time until the next local midnight, e.g. "5h 12m". */
export function untilTomorrow(now: Date = new Date()): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(0, Math.round((next.getTime() - now.getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
