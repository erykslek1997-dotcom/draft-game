import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

/**
 * 2026-11-12: Mini Draft with friends. A room is a board (its seed) that up to `MAX_PLAYERS` people
 * draft together; the other teams are CPU GMs. The server keeps the pick log and checks whose turn
 * it is (supabase/schema.sql, `mp_pick`); every screen replays that log with the same engine, so
 * the CPU's picks come out the same everywhere and anyone in the room may send them.
 */
export const MAX_PLAYERS = 4;
/** Seconds a player has for a pick before the CPU picks for him. */
export const PICK_CLOCK_S = 120;
/** How often a screen says "still here"; the server hands a silent player's team to the CPU after 30 s. */
const PING_MS = 10_000;
/** A player counts as gone after this long without a ping (the server's own rule). */
export const AWAY_MS = 30_000;
/** Without the live link the screen asks for news this often. */
const POLL_MS = 2_500;

export interface MpRoom {
  id: string;
  code: string;
  host: string;
  seed: number;
  max_players: number;
  clock_s: number;
  status: 'lobby' | 'draft' | 'done';
  /** 16: a Mini; 2: a Duel. */
  teams: number;
  /** Caps for a team's five. */
  cap: number;
  /** 5: a Mini or Duel; 9: the All-Time Draft. */
  rounds: number;
  started_at: string | null;
}
export interface MpMember {
  user_id: string;
  nickname: string;
  level: number;
  slot: number | null;
  joined_at: string;
  last_seen: string;
  /** All-Time: the team they sent after the draft (years + rotation). */
  final?: { roster: string[]; rotation: unknown } | null;
  /** Tournament rounds this player has seen. */
  tourney: number;
}
export interface MpPick {
  pick_no: number;
  player_id: string;
  made_at: string;
}

export type MpError = 'not_found' | 'started' | 'full' | 'server_full' | 'offline' | 'rate' | 'schema' | 'error';

function errorOf(message: string | undefined): MpError {
  const m = message ?? '';
  // eslint-disable-next-line no-console
  console.warn('[multiplayer]', m);
  if (m.includes('Could not find the function') || m.includes('does not exist') || m.includes('schema cache')) return 'schema';
  if (m.includes('not_found')) return 'not_found';
  if (m.includes('started')) return 'started';
  if (m.includes('server_full')) return 'server_full';
  if (m.includes('full')) return 'full';
  if (m.includes('rate limit')) return 'rate';
  return 'error';
}

export const MP_ERROR_TEXT: Record<MpError, string> = {
  not_found: 'No room with that code. Check it with your friend.',
  started: 'That draft has already started.',
  full: 'That room is full.',
  server_full: 'Server full right now. Try again in a few minutes.',
  offline: 'Online play isn’t available here.',
  schema: 'The server needs an update: run supabase/schema.sql again.',
  rate: 'Too many rooms in a short time. Try again later.',
  error: 'Something went wrong. Try again.',
};

/** A guest plays too: without an account the game signs in anonymously (no name on the boards). */
async function ensureSession(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  return error ? null : (anon.user?.id ?? null);
}

/** Seconds a Duel pick gets: two players, ten picks, a quick game. */
export const DUEL_CLOCK_S = 45;

/** The cap a host can set for a room, in steps of 0.1. */
export const ROOM_CAP_MIN = 60;
export const ROOM_CAP_MAX = 90;

/** The All-Time Draft online (2026-11-13): up to 8 people, a minute a pick. */
export const ALLTIME_MAX_PLAYERS = 8;
export const ALLTIME_CLOCK_S = 60;
export type RoomKind = 'mini' | 'duel' | 'alltime';

export async function sendFinal(roomId: string, final: { roster: string[]; rotation: unknown }): Promise<void> {
  await supabase?.rpc('mp_final', { p_room: roomId, p_final: final });
}

export async function createRoom(nick: string, level: number, kind: RoomKind = 'mini', cap = 70): Promise<{ code: string } | { error: MpError }> {
  const duel = kind === 'duel';
  const allTime = kind === 'alltime';
  if (!supabase || !(await ensureSession())) return { error: 'offline' };
  const seed = Math.floor(Math.random() * 2 ** 31);
  const { data, error } = await supabase.rpc('mp_create', { p_seed: seed, p_nick: nick, p_level: level, p_max: duel ? 2 : allTime ? ALLTIME_MAX_PLAYERS : MAX_PLAYERS, p_clock: duel ? DUEL_CLOCK_S : allTime ? ALLTIME_CLOCK_S : PICK_CLOCK_S, p_teams: duel ? 2 : 16, p_cap: allTime ? 100.9 : cap, p_rounds: allTime ? 9 : 5 });
  return error ? { error: errorOf(error.message) } : { code: data as string };
}

export async function joinRoom(code: string, nick: string, level: number): Promise<{ roomId: string } | { error: MpError }> {
  if (!supabase || !(await ensureSession())) return { error: 'offline' };
  const { data, error } = await supabase.rpc('mp_join', { p_code: code.trim().toUpperCase(), p_nick: nick, p_level: level });
  return error ? { error: errorOf(error.message) } : { roomId: data as string };
}

export async function leaveRoom(roomId: string): Promise<void> {
  await supabase?.rpc('mp_leave', { p_room: roomId });
}

export async function startRoom(roomId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc('mp_start', { p_room: roomId });
  return !error;
}

export async function sendPick(roomId: string, pickNo: number, playerId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('mp_pick', { p_room: roomId, p_pick: pickNo, p_player: playerId });
  return !error && data === true;
}

export async function sendTourney(roomId: string, rounds: number): Promise<void> {
  await supabase?.rpc('mp_tourney', { p_room: roomId, p_rounds: rounds });
}

export async function myUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** The room's code is kept for this tab, so a refresh brings you back to your draft. */
const ROOM_KEY = 'draftverse.mp.room';
export function rememberRoom(code: string | null): void {
  try {
    if (code) window.sessionStorage.setItem(ROOM_KEY, code);
    else window.sessionStorage.removeItem(ROOM_KEY);
  } catch {
    // Not kept: a refresh lands on the menu.
  }
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
}
export function roomFromUrl(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('room');
  if (fromUrl && /^[A-Za-z2-9]{5}$/.test(fromUrl)) return fromUrl.toUpperCase();
  try {
    return window.sessionStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
}
export function roomLink(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?room=${code}`;
}

/** What the player on the clock is browsing (sent live, never stored). */
export interface Peek {
  user: string;
  /** Position tab, or ALL. */
  tab: string;
  /** Caps filter top, or null for any. */
  upTo: number | null;
  /** The player they last starred or looked at, masked like the list shows him. */
  eyeing?: string;
  at: number;
}

/** A chat line (sent live over the room's channel, never stored: gone on refresh). */
export interface ChatLine {
  id: string;
  user: string;
  text: string;
  at: number;
}
export const CHAT_MAX = 200;
/** One line a second at most, per screen. */
const CHAT_GAP_MS = 1000;
/** Lines kept on screen. */
const CHAT_KEEP = 100;

/** A swap of a drafted player's years (All-Time rooms). */
export interface MpSwap {
  id: number;
  at_pick: number;
  slot: number;
  player_name: string;
  span_id: string;
}

export async function sendSwap(roomId: string, atPick: number, playerName: string, spanId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('mp_swap', { p_room: roomId, p_at: atPick, p_player: playerName, p_span: spanId });
  return !error && data === true;
}

export interface RoomLive {
  room: MpRoom | null;
  members: MpMember[];
  picks: MpPick[];
  /** Live updates are on; false: the link is busy (server full) and the screen polls instead. */
  live: boolean;
  /** The server's clock now, ms (pick clocks count the same on every screen). */
  now: () => number;
  /** Reloads the picks at once (after your own pick). */
  refresh: () => void;
  /** Duel: who clicked Ready for the game (live, not stored). */
  ready: Set<string>;
  sendReady: () => void;
  chat: ChatLine[];
  /** False when the line was too soon after the last one or empty. */
  sendChat: (text: string) => boolean;
  swaps: MpSwap[];
  peek: Peek | null;
  sendPeek: (p: Omit<Peek, 'at' | 'user'>) => void;
}

/** Everything a room's screen needs, kept up to date over Realtime (or polling when that's busy). */
export function useRoom(roomId: string | null): RoomLive {
  const [room, setRoom] = useState<MpRoom | null>(null);
  const [members, setMembers] = useState<MpMember[]>([]);
  const [picks, setPicks] = useState<MpPick[]>([]);
  const [live, setLive] = useState(true);
  const offset = useRef(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const meRef = useRef<string | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [swaps, setSwaps] = useState<MpSwap[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [ready, setReady] = useState<Set<string>>(new Set());
  const iAmReady = useRef(false);
  const echoed = useRef(new Set<string>());
  const lastChat = useRef(0);
  const addLine = useCallback((l: ChatLine) => setChat((old) => (old.some((x) => x.id === l.id) ? old : [...old, l].slice(-CHAT_KEEP))), []);

  const loadRoom = useCallback(async () => {
    if (!supabase || !roomId) return;
    const { data } = await supabase.from('mp_rooms').select('id,code,host,seed,max_players,clock_s,status,started_at,teams,cap,rounds').eq('id', roomId).maybeSingle();
    setRoom(data ? ({ ...data, seed: Number(data.seed), cap: Number(data.cap ?? 70) } as MpRoom) : null);
  }, [roomId]);
  const loadMembers = useCallback(async () => {
    if (!supabase || !roomId) return;
    const { data } = await supabase.from('mp_members').select('user_id,nickname,level,slot,joined_at,last_seen,tourney,final').eq('room_id', roomId).order('joined_at');
    if (data) setMembers(data as MpMember[]);
  }, [roomId]);
  const loadSwaps = useCallback(async () => {
    if (!supabase || !roomId) return;
    const { data } = await supabase.from('mp_swaps').select('id,at_pick,slot,player_name,span_id').eq('room_id', roomId).order('id');
    if (data) setSwaps((old) => (data.length >= old.length ? (data as MpSwap[]) : old));
  }, [roomId]);
  const loadPicks = useCallback(async () => {
    if (!supabase || !roomId) return;
    const { data } = await supabase.from('mp_picks').select('pick_no,player_id,made_at').eq('room_id', roomId).order('pick_no');
    if (data) setPicks((old) => (data.length >= old.length ? (data as MpPick[]) : old));
  }, [roomId]);

  useEffect(() => {
    if (!supabase || !roomId) return;
    const sb = supabase;
    void loadRoom();
    void loadMembers();
    void loadPicks();
    void loadSwaps();
    let channel: RealtimeChannel | null = sb
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mp_picks', filter: `room_id=eq.${roomId}` }, (p) => {
        const row = p.new as MpPick;
        setPicks((old) => {
          if (old.some((x) => x.pick_no === row.pick_no)) return old;
          // A gap (a missed message): read the whole log again.
          if (row.pick_no !== old.length + 1) {
            void loadPicks();
            return old;
          }
          return [...old, row];
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mp_members', filter: `room_id=eq.${roomId}` }, () => void loadMembers())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mp_swaps', filter: `room_id=eq.${roomId}` }, () => void loadSwaps())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mp_rooms', filter: `id=eq.${roomId}` }, () => void loadRoom())
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        const l = payload as ChatLine;
        if (typeof l?.text === 'string' && typeof l.user === 'string') addLine({ id: String(l.id), user: l.user, text: l.text.slice(0, CHAT_MAX), at: Date.now() });
      })
      .on('broadcast', { event: 'ready' }, ({ payload }) => {
        const user = String((payload as { user?: string })?.user ?? '');
        if (!user) return;
        setReady((old) => new Set(old).add(user));
        // Someone who clicked after you (or refreshed) hears that you're ready too.
        if (iAmReady.current && meRef.current && !echoed.current.has(user)) {
          echoed.current.add(user);
          void channelRef.current?.send({ type: 'broadcast', event: 'ready', payload: { user: meRef.current } });
        }
      })
      .on('broadcast', { event: 'peek' }, ({ payload }) => setPeek({ ...(payload as Peek), at: Date.now() }))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setLive(true);
          // Anything sent before the link was up.
          void loadRoom();
          void loadMembers();
          void loadPicks();
          void loadSwaps();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setLive(false);
      });

    channelRef.current = channel;
    void sb.auth.getSession().then(({ data }) => (meRef.current = data.session?.user.id ?? null));
    const ping = async () => {
      const sent = Date.now();
      const { data } = await sb.rpc('mp_ping', { p_room: roomId });
      if (typeof data === 'string') offset.current = Date.parse(data) - (sent + Date.now()) / 2;
      void loadMembers();
    };
    void ping();
    const pinger = window.setInterval(() => void ping(), PING_MS);
    return () => {
      window.clearInterval(pinger);
      if (channel) void sb.removeChannel(channel);
      channelRef.current = null;
      channel = null;
    };
  }, [roomId, loadRoom, loadMembers, loadPicks, loadSwaps, addLine]);

  // Polling when the live link is busy.
  useEffect(() => {
    if (live || !roomId) return;
    const t = window.setInterval(() => {
      void loadPicks();
      void loadRoom();
      void loadSwaps();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [live, roomId, loadPicks, loadRoom, loadSwaps]);

  const now = useCallback(() => Date.now() + offset.current, []);
  const sendPeek = useCallback((p: Omit<Peek, 'at' | 'user'>) => {
    const ch = channelRef.current;
    if (!ch || !meRef.current) return;
    void ch.send({ type: 'broadcast', event: 'peek', payload: { ...p, user: meRef.current } });
  }, []);
  const sendChat = useCallback(
    (text: string) => {
      const clean = text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
      const ch = channelRef.current;
      if (!clean || !ch || !meRef.current || Date.now() - lastChat.current < CHAT_GAP_MS) return false;
      lastChat.current = Date.now();
      const line: ChatLine = { id: `${meRef.current}:${Date.now()}`, user: meRef.current, text: clean, at: Date.now() };
      addLine(line);
      void ch.send({ type: 'broadcast', event: 'chat', payload: line });
      return true;
    },
    [addLine],
  );
  const sendReady = useCallback(() => {
    if (!meRef.current) return;
    iAmReady.current = true;
    setReady((old) => new Set(old).add(meRef.current!));
    void channelRef.current?.send({ type: 'broadcast', event: 'ready', payload: { user: meRef.current } });
  }, []);
  return { room, members, picks, live, now, refresh: () => { void loadPicks(); void loadSwaps(); }, swaps, peek, sendPeek, chat, sendChat, ready, sendReady };
}
