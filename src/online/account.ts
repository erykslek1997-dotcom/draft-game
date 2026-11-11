import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface Account {
  id: string;
  /** Public name on the leaderboards (the Google name until the player changes it). */
  nickname: string;
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

/** Reads (and on first sign-in creates) the player's profile. */
async function loadAccount(session: Session): Promise<Account | null> {
  if (!supabase) return null;
  const id = session.user.id;
  const { data } = await supabase.from('profiles').select('nickname').eq('id', id).maybeSingle();
  if (data?.nickname) return { id, nickname: data.nickname as string };
  const nickname = defaultNickname(session);
  await supabase.from('profiles').insert({ id, nickname });
  return { id, nickname };
}

export async function setNickname(id: string, nickname: string): Promise<boolean> {
  if (!supabase) return false;
  const clean = nickname.trim().slice(0, 24);
  if (clean.length < 2) return false;
  const { error } = await supabase.from('profiles').update({ nickname: clean }).eq('id', id);
  return !error;
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
