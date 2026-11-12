import type { DailyDraftMode } from '../dailyDraftDay';
import type { PointsBreakdown } from './points';
import type { DailyProof } from './verifyDaily';
import { supabase } from './supabase';

export interface DailyScore {
  overall: number;
  place: number;
  field: number;
}

export interface LeaderboardRow {
  userId: string;
  nickname: string;
  points: number;
  /** Today's table only. */
  breakdown?: { draft: number; season: number; streak: number };
  /** The server re-ran the draft and it matched. */
  verified?: boolean;
  /** The week's table only: days played. */
  days?: number;
}

/**
 * 2026-11-12, fewer requests: the same result is sent once per page visit, and a table read in the
 * last 30 seconds is shown from memory (the server also limits writes, schema.sql `rate_check`).
 */
const sent = new Map<string, string>();
const cache = new Map<string, { at: number; rows: LeaderboardRow[] }>();
const FRESH_MS = 30_000;

async function cached(key: string, load: () => Promise<LeaderboardRow[] | null>): Promise<LeaderboardRow[] | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.rows;
  const rows = await load();
  if (rows) cache.set(key, { at: Date.now(), rows });
  return rows;
}

/** Sends (or, once the season is played, updates) today's result and its points. */
export async function submitDailyScore(userId: string, mode: DailyDraftMode, day: string, score: DailyScore, points: PointsBreakdown, proof?: DailyProof): Promise<'saved' | 'error'> {
  if (!supabase) return 'error';
  const key = `${userId}|${mode}|${day}`;
  const body = JSON.stringify([score, points]);
  if (sent.get(key) === body) return 'saved';
  const { error } = await supabase.from('daily_scores').upsert(
    {
      user_id: userId,
      mode,
      day,
      overall: Math.round(score.overall * 100) / 100,
      place: score.place,
      field: score.field,
      points: points.total,
      draft_points: points.draft,
      season_points: points.season,
      streak_points: points.streak,
      ...(proof ? { proof } : {}),
    },
    { onConflict: 'user_id,mode,day' },
  );
  if (error) return 'error';
  sent.set(key, body);
  for (const k of cache.keys()) if (k.includes(`|${mode}|`)) cache.delete(k);
  return 'saved';
}

/** The day's table: most points first, earlier submission breaking ties. */
export async function fetchDailyLeaderboard(mode: DailyDraftMode, day: string, limit = 50): Promise<LeaderboardRow[] | null> {
  return cached(`day|${mode}|${day}`, () => loadDaily(mode, day, limit));
}

async function loadDaily(mode: DailyDraftMode, day: string, limit: number): Promise<LeaderboardRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('daily_leaderboard')
    .select('user_id, nickname, points, draft_points, season_points, streak_points, created_at, verified')
    .eq('mode', mode)
    .eq('day', day)
    .order('points', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error || !data) return null;
  return data.map((r) => ({
    userId: r.user_id as string,
    nickname: r.nickname as string,
    points: Number(r.points),
    breakdown: { draft: Number(r.draft_points), season: Number(r.season_points), streak: Number(r.streak_points) },
    verified: r.verified === 'ok',
  }));
}

/** Monday of the week a day falls in (UTC), as the weekly view keys it. */
export function weekOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** This week's table: points summed over the days played. */
export async function fetchWeeklyLeaderboard(mode: DailyDraftMode, day: string, limit = 50): Promise<LeaderboardRow[] | null> {
  return cached(`week|${mode}|${weekOf(day)}`, () => loadWeekly(mode, day, limit));
}

async function loadWeekly(mode: DailyDraftMode, day: string, limit: number): Promise<LeaderboardRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('weekly_leaderboard')
    .select('user_id, nickname, points, days')
    .eq('mode', mode)
    .eq('week', weekOf(day))
    .order('points', { ascending: false })
    .limit(limit);
  if (error || !data) return null;
  return data.map((r) => ({ userId: r.user_id as string, nickname: r.nickname as string, points: Number(r.points), days: Number(r.days) }));
}
