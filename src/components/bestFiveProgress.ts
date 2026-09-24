import type { Position } from '../data/schema';
import { STARTER_SLOTS } from '../engine/positions';
import type { DailyPool, GolfGrade, Lineup } from '../engine/bestFive';

/**
 * 2026-09-24: Best 5's "Submit once" rule and a daily streak, kept in localStorage. Before this
 * the daily puzzle promised one attempt a day but a page refresh gave you a fresh board, and
 * nothing carried over from one day to the next. Per browser only — there's still no backend.
 */
const STORAGE_KEY = 'draftverse.bestFive.v1';

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

function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** The streak as it stands on `today` — a streak whose last play was before yesterday is over. */
export function currentStreak(today: string): Streak {
  const { streak } = read();
  const alive = streak.lastDay === today || streak.lastDay === previousDay(today);
  return alive ? streak : { ...streak, current: 0 };
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
