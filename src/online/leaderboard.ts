import type { DailyDraftMode } from '../dailyDraftDay';
import { supabase } from './supabase';

export interface DailyScore {
  overall: number;
  place: number;
  field: number;
}

export interface LeaderboardRow extends DailyScore {
  userId: string;
  nickname: string;
}

/** Sends today's first result. A second try is refused by the database (one result a day). */
export async function submitDailyScore(userId: string, mode: DailyDraftMode, day: string, score: DailyScore): Promise<'saved' | 'already' | 'error'> {
  if (!supabase) return 'error';
  const { error } = await supabase.from('daily_scores').insert({
    user_id: userId,
    mode,
    day,
    overall: Math.round(score.overall * 100) / 100,
    place: score.place,
    field: score.field,
  });
  if (!error) return 'saved';
  return error.code === '23505' ? 'already' : 'error';
}

/** The day's table: best Overall first, earlier submission breaking ties. */
export async function fetchDailyLeaderboard(mode: DailyDraftMode, day: string, limit = 50): Promise<LeaderboardRow[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('daily_leaderboard')
    .select('user_id, nickname, overall, place, field, created_at')
    .eq('mode', mode)
    .eq('day', day)
    .order('overall', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error || !data) return null;
  return data.map((r) => ({
    userId: r.user_id as string,
    nickname: r.nickname as string,
    overall: Number(r.overall),
    place: r.place as number,
    field: r.field as number,
  }));
}
