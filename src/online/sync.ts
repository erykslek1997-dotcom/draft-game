import type { DailyDraftMode } from '../dailyDraftDay';
import { mergeDailyDraftDays, type DailyDraftResult } from '../components/dailyDraftProgress';
import { supabase } from './supabase';

/**
 * 2026-11-11, the account keeps the dailies: every day you posted is on the server, so a new phone or
 * browser gets your history and streak back the moment you sign in.
 */
export async function pullDailyHistory(userId: string): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.from('daily_scores').select('mode, day, overall, place, field').eq('user_id', userId).limit(1000);
  if (error || !data) return 0;
  const byMode = new Map<DailyDraftMode, Record<string, DailyDraftResult>>();
  for (const r of data) {
    const mode = r.mode as DailyDraftMode;
    const days = byMode.get(mode) ?? {};
    days[r.day as string] = { overall: Number(r.overall), place: r.place as number, field: r.field as number };
    byMode.set(mode, days);
  }
  for (const [mode, days] of byMode) mergeDailyDraftDays(mode, days);
  return data.length;
}
