import { supabase } from './supabase';
import { draftPoints, draftXp } from './careerPoints';

export { draftPoints, draftXp, levelOf } from './careerPoints';

/**
 * 2026-11-12, the career: every finished draft, the dailies too. It feeds the account's counters
 * (drafts per mode, wins, titles, records), XP and level, and, for free drafts, a few points on the
 * week's table: plus for the top half of the field, minus for the bottom half, so grinding weak
 * drafts costs instead of paying (the user: "bezsensowny grind karany").
 */
import type { CareerMode } from './careerPoints';

export type { CareerMode };

export interface CareerResult {
  /** One per draft, so a result is only counted once (here and on the server). */
  id: string;
  mode: CareerMode;
  daily: boolean;
  place: number;
  field: number;
  overall: number;
  /** Draw Five: beat the opponent. */
  won: boolean;
  /** All-Time / Bomb: won the season. */
  title: boolean;
  points: number;
  xp: number;
  at: string;
}

const KEY = 'draftverse.career.v1';

function readAll(): CareerResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as CareerResult[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(list: CareerResult[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-3000)));
  } catch {
    // Private window or full storage: the career just isn't kept here.
  }
}

/** 2026-11-12: forgets the career here (signing out of the account it belongs to). */
export function clearCareer(): void {
  writeAll([]);
}

export function careerResults(): CareerResult[] {
  return readAll();
}

/** A new id for a draft that has none of its own. */
export function newDraftId(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${rnd}`;
}

let userId: string | null = null;

/** The signed-in player (AccountBar sets it); results are sent while it is set. */
export function setCareerUser(id: string | null): void {
  userId = id;
}

function toRow(r: CareerResult, uid: string) {
  return { id: r.id, user_id: uid, mode: r.mode, daily: r.daily, place: r.place, field: r.field, overall: Math.round(r.overall * 100) / 100, won: r.won, title: r.title, points: r.points, xp: r.xp };
}

/**
 * Records a finished draft (or updates it: the season's title comes later). Kept here; sent to the
 * account when signed in. The same id twice changes nothing unless the title is new.
 */
export function recordDraft(input: Omit<CareerResult, 'points' | 'xp' | 'at' | 'won' | 'title'> & { won?: boolean; title?: boolean }): void {
  const list = readAll();
  const old = list.find((r) => r.id === input.id);
  const won = input.won ?? old?.won ?? false;
  const title = input.title ?? old?.title ?? false;
  if (old && old.won === won && old.title === title) return;
  const base = { ...input, won, title };
  const r: CareerResult = { ...base, points: draftPoints(base), xp: draftXp(base), at: old?.at ?? new Date().toISOString() };
  writeAll(old ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r]);
  if (supabase && userId) void supabase.from('draft_results').upsert(toRow(r, userId), { onConflict: 'user_id,id' });
}

/** On sign-in: the account's drafts join this browser's, and this browser's unsent recent ones go up. */
const synced = new Set<string>();

export async function syncCareer(uid: string): Promise<boolean> {
  if (!supabase || synced.has(uid)) return false;
  synced.add(uid);
  const { data, error } = await supabase.from('draft_results').select('id, mode, daily, place, field, overall, won, title, points, xp, created_at').eq('user_id', uid).limit(3000);
  if (error || !data) return false;
  const mine = readAll();
  const known = new Set(mine.map((r) => r.id));
  const server = new Set(data.map((r) => r.id as string));
  const added: CareerResult[] = data
    .filter((r) => !known.has(r.id as string))
    .map((r) => ({ id: r.id as string, mode: r.mode as CareerMode, daily: !!r.daily, place: r.place as number, field: r.field as number, overall: Number(r.overall), won: !!r.won, title: !!r.title, points: Number(r.points), xp: r.xp as number, at: r.created_at as string }));
  if (added.length) writeAll([...mine, ...added].sort((a, b) => a.at.localeCompare(b.at)));
  // Only the last hour's can still be posted (the server's rule).
  const hourAgo = Date.now() - 3600_000;
  const unsent = mine.filter((r) => !server.has(r.id) && Date.parse(r.at) > hourAgo);
  if (unsent.length) await supabase.from('draft_results').upsert(unsent.map((r) => toRow(r, uid)), { onConflict: 'user_id,id' });
  return added.length > 0;
}

export interface CareerStats {
  played: Record<CareerMode, number>;
  total: number;
  drawFiveWins: number;
  titles: number;
  wins: number;
  xp: number;
  bestOverall: Partial<Record<CareerMode, number>>;
  bestWeekPoints: number;
}

export function careerStats(list = readAll()): CareerStats {
  const played: Record<CareerMode, number> = { drawfive: 0, mini: 0, alltime: 0, bomb: 0 };
  const bestOverall: Partial<Record<CareerMode, number>> = {};
  let drawFiveWins = 0;
  let titles = 0;
  let wins = 0;
  let xp = 0;
  const weeks = new Map<string, number>();
  for (const r of list) {
    played[r.mode] = (played[r.mode] ?? 0) + 1;
    if (r.mode === 'drawfive' && r.won) drawFiveWins++;
    if (r.title) titles++;
    if (r.mode !== 'drawfive' && r.place === 1) wins++;
    xp += r.xp;
    if (r.mode !== 'drawfive') bestOverall[r.mode] = Math.max(bestOverall[r.mode] ?? 0, r.overall);
    if (!r.daily) {
      const d = new Date(r.at);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const wk = d.toISOString().slice(0, 10);
      weeks.set(wk, (weeks.get(wk) ?? 0) + r.points);
    }
  }
  return { played, total: list.length, drawFiveWins, titles, wins, xp, bestOverall, bestWeekPoints: Math.max(0, ...weeks.values()) };
}
