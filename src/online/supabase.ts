import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 2026-11-11, online features (the user's Supabase project, Google sign-in). The URL and the
 * publishable key come from the build (GitHub → Settings → Variables: VITE_SUPABASE_URL,
 * VITE_SUPABASE_ANON_KEY; locally a `.env.local`). Both are public by design: what a player may
 * read or write is decided by the database's row-level security (supabase/schema.sql), never by
 * the key. Without them the game simply stays offline, as before.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;
export const onlineEnabled = supabase !== null;
