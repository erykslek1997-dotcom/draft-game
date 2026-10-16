import type { DailyDraftMode } from '../dailyDraftDay';

/**
 * 2026-10-16, the daily drafts: the day's result and a streak per mode, in this browser's
 * localStorage (no backend yet) — the same shape as the Draw Five daily (`dailyProgress.ts`).
 * The result is the place after the draft and the team's Overall; the season's part comes with
 * the All-Time daily (the user: points for the draft and for the season, to a leaderboard once
 * there is a server).
 */
const STORAGE_KEY = 'draftverse.dailyDraft.v1';

export interface DailyDraftResult {
  place: number;
  field: number;
  overall: number;
}

interface ModeProgress {
  days: Record<string, DailyDraftResult>;
  streak: { current: number; best: number; lastDay: string | null };
}

type Progress = Partial<Record<DailyDraftMode, ModeProgress>>;

const emptyMode = (): ModeProgress => ({ days: {}, streak: { current: 0, best: 0, lastDay: null } });

function read(): Progress {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Progress) : {};
  } catch {
    return {};
  }
}

function write(progress: Progress): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Private mode or full storage: the day still plays, it just isn't remembered.
  }
}

function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dailyDraftResult(mode: DailyDraftMode, day: string): DailyDraftResult | null {
  return read()[mode]?.days[day] ?? null;
}

export function dailyDraftStreak(mode: DailyDraftMode, today: string): number {
  const streak = read()[mode]?.streak;
  if (!streak) return 0;
  return streak.lastDay === today || streak.lastDay === previousDay(today) ? streak.current : 0;
}

/** Saves the day's result (the first one only) and moves the streak on. */
export function saveDailyDraftResult(mode: DailyDraftMode, day: string, result: DailyDraftResult): void {
  const progress = read();
  const own = progress[mode] ?? emptyMode();
  if (own.days[day]) return;
  own.days = { ...own.days, [day]: result };
  const { streak } = own;
  const current = streak.lastDay === previousDay(day) ? streak.current + 1 : streak.lastDay === day ? streak.current : 1;
  own.streak = { current, best: Math.max(streak.best, current), lastDay: day };
  write({ ...progress, [mode]: own });
}

/** Forgets the day's result (testing replays only). */
export function clearDailyDraftResult(mode: DailyDraftMode, day: string): void {
  const progress = read();
  const own = progress[mode];
  if (!own?.days[day]) return;
  const days = { ...own.days };
  delete days[day];
  const streak = own.streak.lastDay === day ? { ...own.streak, current: Math.max(0, own.streak.current - 1), lastDay: own.streak.current > 1 ? previousDay(day) : null } : own.streak;
  write({ ...progress, [mode]: { days, streak } });
}

/** "4th". */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
