import { useEffect, useMemo, useRef, useState } from 'react';
import QuickFive, { type MiniMp } from './QuickFive';
import { careerStats, levelOf } from '../online/career';
import { levelTitle } from '../online/careerPoints';
import { useAccount } from '../online/account';
import {
  AWAY_MS,
  MAX_PLAYERS,
  MP_ERROR_TEXT,
  ROOM_CAP_MAX,
  ROOM_CAP_MIN,
  createRoom,
  joinRoom,
  leaveRoom,
  myUserId,
  rememberRoom,
  roomLink,
  sendPick,
  sendTourney,
  startRoom,
  useRoom,
  CHAT_MAX,
  type ChatLine,
  type MpError,
} from '../online/multiplayer';
import { Actions, Btn, H3, Kv, Mast, NightGame, Prompt } from '../night/ui';
import { copyLink } from './shareSave';
import { TEAM_COUNT } from '../engine/positions';
import { QUICK_ROUNDS } from '../engine/quickDraft';

const NICK_KEY = 'draftverse.mp.nick';

/** The team (index) on the clock after `done` picks: the snake, as the server counts it. */
function onClockSlot(teams: number, done: number): number {
  const round = Math.floor(done / teams);
  const i = done % teams;
  return round % 2 === 0 ? i : teams - 1 - i;
}
/** The draft lottery everyone watches after the start; the first pick opens after it. */
const LOTTERY_MS = 20_000;

function savedNick(): string {
  try {
    return window.localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Mini Draft with friends (2026-11-12): make a room or join one by its code or link, wait in the
 * lobby, then draft live: up to four people, the other teams CPU GMs, a pick clock, and the same
 * tournament for everyone at the end. Guests play too (no account needed).
 */
export default function MultiMini({ initialCode, onExit, duel }: { initialCode?: string; onExit: () => void; /** A Duel room (test mode): 1v1, ten picks. */ duel?: boolean }) {
  const { account } = useAccount();
  const level = useMemo(() => levelOf(careerStats().xp).level, []);
  const [nick, setNick] = useState(savedNick);
  useEffect(() => {
    if (account?.nickname && !nick) setNick(account.nickname);
  }, [account, nick]);
  const [code, setCode] = useState(initialCode ?? '');
  const [cap, setCap] = useState(70);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MpError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set when the room came from the address bar or a refresh, not from this form.
  const [fromLink, setFromLink] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  // The form is a link's join form until that room turns out to be over.
  const linkCode = notice ? undefined : initialCode;
  const cleanNick = nick.trim().replace(/\s+/g, ' ').slice(0, 24);
  async function enter(join: string | null) {
    if (cleanNick.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      window.localStorage.setItem(NICK_KEY, cleanNick);
    } catch {
      // Asked again next time.
    }
    let joinCode = join;
    if (!joinCode) {
      const made = await createRoom(cleanNick, level, duel, cap);
      if ('error' in made) {
        setBusy(false);
        setError(made.error);
        return;
      }
      joinCode = made.code;
    }
    const joined = await joinRoom(joinCode, cleanNick, level);
    setBusy(false);
    if ('error' in joined) {
      setError(joined.error);
      if (joined.error !== 'server_full' && joined.error !== 'error') rememberRoom(null);
      return;
    }
    setMe(await myUserId());
    rememberRoom(joinCode);
    setRoomCode(joinCode);
    setRoomId(joined.roomId);
  }

  // A link or a refresh: back into the room (the name is already known from last time).
  useEffect(() => {
    if (initialCode && savedNick().trim().length >= 2) {
      setFromLink(true);
      void enter(initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exit() {
    if (roomId) void leaveRoom(roomId);
    rememberRoom(null);
    onExit();
  }

  if (!roomId || !roomCode || !me) {
    return (
      <NightGame
        aside={
          <>
            <Mast title={duel ? 'Duel' : 'Play with friends'} sub={duel ? 'Test mode · one on one' : `Mini Draft · up to ${MAX_PLAYERS} players`} />
            <section>
              <H3>How it works</H3>
              <Kv k="Players" v={duel ? 'Two' : `Up to ${MAX_PLAYERS}`} />
              {duel ? <Kv k="Picks" v="Ten, snake" /> : <Kv k="Other teams" v="CPU GMs" />}
              <Kv k="Pick clock" v={duel ? '45 seconds' : '2 minutes'} />
              <Kv k="Then" v={duel ? 'One game' : 'A tournament'} />
              <Kv k="Account" v="Not needed" />
            </section>
            <Actions links={{ onMenu: exit }} />
          </>
        }
      >
        {duel ? (
          <Prompt eb="Duel · test mode" title="One on one">
            Two GMs, one cap, a board of 40 players. Snake draft, five picks each, then your fives play one game.
          </Prompt>
        ) : (
          <Prompt eb="Mini Draft · multiplayer" title="Draft against your friends">
            {TEAM_COUNT} teams, {QUICK_ROUNDS} rounds, the same board for the whole room. Make a room and send the link, or type a friend’s code.
          </Prompt>
        )}
        <form
          className="mp-form"
          onSubmit={(e) => {
            e.preventDefault();
            // Enter only ever joins: making a room takes its own click (playtest 2026-11-12, rooms made by accident).
            if (code.trim().length === 5) void enter(code.trim().toUpperCase());
          }}
        >
          <label>
            <span>Your name in the room</span>
            <input value={nick} maxLength={24} onChange={(e) => setNick(e.target.value)} placeholder="Name" />
          </label>
          <label>
            <span>{linkCode ? 'Room from your link' : 'Join a friend’s room'}</span>
            <span className="mp-row">
              <input value={code} maxLength={5} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" autoComplete="off" className="mp-code" readOnly={Boolean(linkCode)} />
              <Btn disabled={busy || cleanNick.length < 2 || code.trim().length !== 5} onClick={() => void enter(code.trim().toUpperCase())}>
                {busy ? 'Joining…' : 'Join'}
              </Btn>
            </span>
          </label>
          {!linkCode && (
            <div className="mp-make">
              <span>No code? Start your own room and send the link.</span>
              <span className="mp-caps">
                Cap <b>{cap.toFixed(1)}</b>
                <input
                  type="range"
                  min={ROOM_CAP_MIN}
                  max={ROOM_CAP_MAX}
                  step={0.1}
                  value={cap}
                  onChange={(e) => setCap(Math.round(Number(e.target.value) * 10) / 10)}
                  aria-label="Cap (FGA) for each five"
                />
              </span>
              <Btn kind="line" disabled={busy || cleanNick.length < 2} onClick={() => void enter(null)}>
                {busy && !code ? 'Making a room…' : 'Make a new room'}
              </Btn>
            </div>
          )}
          {cleanNick.length < 2 && <p className="mp-note">Pick a name first (2 letters or more).</p>}
          {error && <p className="mp-err">{MP_ERROR_TEXT[error]}</p>}
          {notice && <p className="mp-note">{notice}</p>}
        </form>
      </NightGame>
    );
  }
  return (
    <Room
      roomId={roomId}
      code={roomCode}
      me={me}
      onExit={exit}
      onOver={
        // Any finished room you walk into (a link, a refresh, a code the browser filled in from
        // last time — playtest 2026-11-12) is forgotten, not reopened.
        fromLink || code
          ? () => {
              // A finished room in the address bar (playtest 2026-11-12): forget it, start fresh.
              rememberRoom(null);
              setRoomId(null);
              setRoomCode(null);
              setCode('');
              setFromLink(false);
              setNotice(`Room ${roomCode} is over. Make a new one or join another.`);
            }
          : undefined
      }
    />
  );
}

function Room({ roomId, code, me, onExit, onOver }: { roomId: string; code: string; me: string; onExit: () => void; onOver?: () => void }) {
  const live = useRoom(roomId);
  const { room, members, picks } = live;
  // Only a room that was already over when you walked in: one that ends while you play stays.
  const firstStatus = useRef<string | null>(null);
  if (room && firstStatus.current === null) firstStatus.current = room.status;
  useEffect(() => {
    if (firstStatus.current === 'done' && onOver) onOver();
  }, [room?.status, onOver]);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const isHost = room?.host === me;
  // Ticks so "away" marks keep up with the clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, []);
  const here = (lastSeen: string) => live.now() - Date.parse(lastSeen) < AWAY_MS;

  const mine = members.find((m) => m.user_id === me);
  const chatBox = (
    <RoomChat
      lines={live.chat}
      me={me}
      nameOf={(u) => members.find((m) => m.user_id === u)?.nickname ?? 'Someone'}
      colorOf={(u) =>
        CHAT_COLORS[
          Math.max(
            0,
            members.findIndex((m) => m.user_id === u),
          ) % CHAT_COLORS.length
        ]
      }
      onSend={live.sendChat}
    />
  );
  const mp: MiniMp | null = useMemo(() => {
    if (!room || room.status === 'lobby' || !mine || mine.slot === null) return null;
    const names = new Map(members.filter((m) => m.slot !== null).map((m) => [m.slot!, m.nickname] as const));
    const herePlayers = new Set(members.filter((m) => m.slot !== null && (m.user_id === me || here(m.last_seen))).map((m) => m.slot!));
    // The leader sends the CPU's picks: the first player still here, by when they joined.
    const leader = members.find((m) => m.user_id === me || here(m.last_seen))?.user_id === me;
    const last = picks[picks.length - 1];
    const startsAt = Date.parse(room.started_at ?? new Date().toISOString()) + LOTTERY_MS;
    return {
      roomId,
      seed: room.seed,
      mySlot: mine.slot,
      teams: room.teams ?? 16,
      cap: room.cap ?? 70,
      names,
      here: herePlayers,
      picks: picks.map((p) => p.player_id),
      lastPickAt: last ? Date.parse(last.made_at) : startsAt,
      startsAt,
      clockS: room.clock_s,
      now: live.now,
      leader,
      sendPeek: live.sendPeek,
      duelReady:
        room.teams === 2
          ? (() => {
              const rival = members.find((m) => m.user_id !== me && m.slot !== null);
              return { mine: live.ready.has(me), theirs: Boolean(rival && live.ready.has(rival.user_id)), theirsAway: !rival || !here(rival.last_seen), set: live.sendReady };
            })()
          : undefined,
      peekLine: (() => {
        const p = live.peek;
        const onClock = members.find((m) => m.slot === onClockSlot(room.teams, picks.length));
        if (!p || !onClock || p.user !== onClock.user_id || p.user === me || Date.now() - p.at > 60_000) return undefined;
        const what = p.tab === 'ALL' ? 'the whole list' : `${p.tab}s`;
        return `Live: ${onClock.nickname} is looking at ${what}${p.upTo !== null ? ` up to ${p.upTo} caps` : ''}${p.eyeing ? `, just starred ${p.eyeing}` : ''}.`;
      })(),
      tourney: (() => {
        // A round opens when everyone still here has seen the one before it.
        const others = members.filter((m) => m.user_id !== me && m.slot !== null && here(m.last_seen));
        const behind = others.filter((m) => m.tourney < Math.min(...others.map((o) => o.tourney)) + 1 && m.tourney === Math.min(...others.map((o) => o.tourney)));
        const gate = others.length ? Math.min(...others.map((o) => o.tourney)) + 1 : 99;
        return {
          gate,
          waiting: behind.map((m) => m.nickname).join(', ') || undefined,
          onShown: (n: number) => void sendTourney(roomId, n),
        };
      })(),
      send: (pickNo, playerId) => {
        void sendPick(roomId, pickNo, playerId).then((ok) => ok && live.refresh());
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, members, picks, mine, me, roomId, live.peek, live.ready, Math.floor(live.now() / 5000)]);

  if (mp) {
    return (
      <>
        {!live.live && <div className="mp-busy">Live link busy (server full): the draft updates every few seconds.</div>}
        <QuickFive mp={mp} onExit={onExit} />
        {chatBox}
      </>
    );
  }

  const link = roomLink(code);
  const gone = room === null && members.length === 0;
  return (
    <>
      {chatBox}
      <NightGame
        aside={
          <>
            <Mast title="Your room" sub={`${room?.teams === 2 ? 'Duel' : 'Mini Draft'} · ${members.length} of ${room?.max_players ?? MAX_PLAYERS} players`} />
            <section>
              <H3>Room</H3>
              <Kv k="Code" v={code} gold />
              <Kv k="Teams" v={room?.teams === 2 ? '2 · one each' : `${TEAM_COUNT} · the rest CPU`} />
              <Kv k="Pick clock" v={`${room?.clock_s ?? 120} s`} />
              <Kv k="Cap" v={(room?.cap ?? 70).toFixed(1)} />
            </section>
            <Actions links={{ onMenu: onExit }}>
              <Btn kind="line" onClick={onExit}>
                Leave the room
              </Btn>
            </Actions>
          </>
        }
      >
        {gone ? (
          <Prompt eb="Room closed" title="The host closed this room">
            Make a new one from the menu.
          </Prompt>
        ) : (
          <>
            <Prompt eb={`Room ${code}`} title={isHost ? 'Send the link to your friends' : 'Waiting for the host to start'}>
              {isHost ? 'Start when everyone is in. Empty seats go to CPU GMs.' : 'You’ll draft as soon as the host starts.'}
            </Prompt>
            <div className="mp-link">
              <code>{link}</code>
              <Btn
                kind="line"
                onClick={() =>
                  void copyLink(link).then((ok) => {
                    if (!ok) return;
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  })
                }
              >
                {copied ? 'Copied' : 'Copy link'}
              </Btn>
            </div>
            <section>
              <H3 note={`${members.length}/${room?.max_players ?? MAX_PLAYERS}`}>Players</H3>
              <ol className="mp-players">
                {members.map((m) => (
                  <li key={m.user_id} className={here(m.last_seen) || m.user_id === me ? undefined : 'away'}>
                    <b>{m.nickname}</b>
                    <span>
                      {levelTitle(m.level)} · Lv {m.level}
                      {m.user_id === room?.host ? ' · host' : ''}
                      {m.user_id === me ? ' · you' : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            {isHost && (
              <Btn
                disabled={starting}
                onClick={() => {
                  setStarting(true);
                  void startRoom(roomId).then(() => setStarting(false));
                }}
              >
                {starting ? 'Starting…' : members.length < 2 ? 'Start anyway' : 'Start the draft'}
              </Btn>
            )}
          </>
        )}
      </NightGame>
    </>
  );
}

/** The room's chat (2026-11-12): a bubble in the corner that opens into the conversation. */
function RoomChat({ lines, me, nameOf, colorOf, onSend }: { lines: ChatLine[]; me: string; nameOf: (user: string) => string; colorOf: (user: string) => string; onSend: (text: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (open) setSeen(lines.length);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, lines.length]);
  const unread = Math.max(0, lines.filter((l) => l.user !== me).length - lines.slice(0, seen).filter((l) => l.user !== me).length);
  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  if (!open)
    return (
      <>
        <button type="button" className="mp-chat-fab" onClick={() => setOpen(true)} aria-label="Open the room chat">
          Chat{unread > 0 && <b>{unread}</b>}
        </button>
        {/* Phones: a dock at the bottom (mockup approved 2026-11-12) instead of the floating bubble. */}
        <nav className="mp-dock" aria-label="Room">
          <button type="button" onClick={() => jump('mp-list')}>
            Players
          </button>
          <button
            type="button"
            onClick={() => {
              // The Duel has its pick log on the page; the Mini opens its draft board.
              if (document.getElementById('mp-picks')) jump('mp-picks');
              else window.dispatchEvent(new Event('draftverse:board'));
            }}
          >
            Board
          </button>
          <button type="button" onClick={() => setOpen(true)}>
            Chat{unread > 0 && <b>{unread}</b>}
          </button>
        </nav>
      </>
    );
  return (
    <section className="mp-chat" aria-label="Room chat">
      <header>
        <span>Room chat</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close the chat">
          ✕
        </button>
      </header>
      <ol ref={listRef}>
        {lines.length === 0 && <li className="mp-chat-empty">Say hi. Messages aren’t saved.</li>}
        {lines.map((l) => (
          <li key={l.id} className={l.user === me ? 'me' : undefined}>
            <b style={{ color: colorOf(l.user) }}>{l.user === me ? 'You' : nameOf(l.user)}</b> {l.text}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (onSend(text)) setText('');
        }}
      >
        <input value={text} maxLength={CHAT_MAX} onChange={(e) => setText(e.target.value)} placeholder="Message" autoComplete="off" aria-label="Message" />
        <button type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

const CHAT_COLORS = ['#e8b04b', '#6fc3df', '#e0645a', '#8fd18a', '#c38be0', '#f0a07a', '#7aa8f0', '#d8d36a'];
