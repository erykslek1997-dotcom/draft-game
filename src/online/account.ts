import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface Account {
  id: string;
  /** Public name on the leaderboards (the Google name until the player changes it). */
  nickname: string;
  /** First sign-in: no profile yet, `nickname` is only the suggestion from Google. */
  needsName?: boolean;
}

/** Signs in with Google and comes back to this same page. */
export async function signInWithGoogle(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
  });
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

function defaultNickname(session: Session): string {
  const meta = session.user.user_metadata as { full_name?: string; name?: string } | undefined;
  const name = (meta?.full_name ?? meta?.name ?? 'Player').trim();
  return name.slice(0, 24).padEnd(2, '.');
}

/** Reads the player's profile; on first sign-in there is none yet and the player picks a name. */
async function loadAccount(session: Session): Promise<Account | null> {
  if (!supabase) return null;
  // A guest in a multiplayer room (anonymous sign-in) has no account: no name, no boards.
  if (session.user.is_anonymous) return null;
  const id = session.user.id;
  // 2026-11-12: a session can outlive its account (deleted in the dashboard): ask the server, and if
  // the user is gone, sign out instead of asking a ghost for a name (a softlock in the playtest).
  const { data: who, error: whoError } = await supabase.auth.getUser();
  if (whoError || !who.user) {
    await supabase.auth.signOut({ scope: 'local' });
    return null;
  }
  const { data } = await supabase.from('profiles').select('nickname').eq('id', id).maybeSingle();
  if (data?.nickname) return { id, nickname: data.nickname as string };
  return { id, nickname: defaultNickname(session), needsName: true };
}

export type NicknameResult = 'ok' | 'short' | 'taken' | 'error';

/** Saves the name (creating the profile on first sign-in). Names are unique, ignoring case. */
export async function setNickname(id: string, nickname: string): Promise<NicknameResult> {
  if (!supabase) return 'error';
  const clean = nickname.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (clean.length < 2) return 'short';
  const { data: same } = await supabase.from('profiles').select('id').ilike('nickname', clean.replace(/[\\%_]/g, '\\$&')).neq('id', id).limit(1);
  if (same && same.length) return 'taken';
  const { error } = await supabase.from('profiles').upsert({ id, nickname: clean });
  // 23505: the database's unique index caught a name taken a moment ago.
  if (error?.code === '23505') return 'taken';
  return error ? 'error' : 'ok';
}

/** Three free names close to a taken one ("Ann" → "Ann2", "Ann_7", "TheAnn"), for one tap. */
export async function suggestNicknames(taken: string): Promise<string[]> {
  if (!supabase) return [];
  const base = taken.trim().replace(/\s+/g, ' ').slice(0, 20);
  const n = () => 2 + Math.floor(Math.random() * 98);
  const candidates = [...new Set([`${base}${n()}`, `${base}_${n()}`, `The${base.replace(/ /g, '')}`.slice(0, 24), `${base}${n()}`, `${base}.${n()}`, `${base}${n()}${n()}`])];
  const { data } = await supabase.from('profiles').select('nickname').in('nickname', candidates);
  const used = new Set((data ?? []).map((r) => String(r.nickname).toLowerCase()));
  return candidates.filter((c) => c.length >= 2 && !used.has(c.toLowerCase())).slice(0, 3);
}

/** The signed-in player, kept in sync with Supabase's session (undefined while loading). */
export function useAccount(): { account: Account | null | undefined; refresh: () => void } {
  const [account, setAccount] = useState<Account | null | undefined>(supabase ? undefined : null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    const apply = (session: Session | null) => {
      if (!session) {
        if (alive) setAccount(null);
        return;
      }
      void loadAccount(session).then((a) => alive && setAccount(a));
    };
    void supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [tick]);
  return { account, refresh: () => setTick((t) => t + 1) };
}
