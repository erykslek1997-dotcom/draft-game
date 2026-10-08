import { useEffect, useMemo, useRef, useState } from 'react';
import { createLotteryDrum, drumHeight, type LotteryDrum } from './lotteryDrum';
import type { CSSProperties, ReactNode } from 'react';
import type { Team } from '../engine/types';

export interface HowToPlayItem {
  title: string;
  body: ReactNode;
}

interface Props {
  teams: Team[];
  /** Rounds in this draft (9 for the All-Time Draft, 5 for Quick 5) — for "your picks" list. */
  rounds: number;
  onDone: () => void;
  /** Every mode's "how to play?" rules, shown on demand (see GameShell/QuickFive). */
  howToPlay?: HowToPlayItem[];
  /** 2026-09-24: a way back to the main menu before the draft starts. */
  onExit?: () => void;
  /** Called once the reel has stopped on the result — the intro's early lottery uses it to start
   * preparing the player data while the player reads the result, not mid-spin. */
  onRevealed?: () => void;
}

const MUTE_KEY = 'draftverse.lotteryMuted';
function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Columns for the picks grid on a narrow screen: an even split, never more than 5 across. */
function narrowPickColumns(count: number): number {
  if (count <= 5) return count;
  for (const cols of [3, 4, 5]) if (count % cols === 0) return cols;
  return Math.ceil(count / Math.ceil(count / 5));
}

/** Overall pick numbers (1-based) a team in `slot` makes in a snake draft. */
/** 2026-09-25, NBA-era touch: one real piece of draft history under the result. Every line is a
 * well-documented fact — keep it that way if you add more. */
const DRAFT_ARCHIVE_FACTS = [
  'The first NBA draft lottery, in 1985, drew envelopes from a hopper. The Knicks won it and took Patrick Ewing.',
  'From 1966 to 1984 the No. 1 pick came down to a coin flip between the worst team in each conference.',
  'In 1979 the Lakers won the coin flip — with a pick they had acquired from the New Orleans Jazz — and drafted Magic Johnson.',
  'In 1984 Houston took Hakeem Olajuwon first. Michael Jordan went third, to Chicago.',
  'Until 1965 teams could make a "territorial pick" of a local star before the draft — that is how Wilt Chamberlain became a Philadelphia Warrior.',
  'Kobe Bryant was drafted 13th in 1996 by the Charlotte Hornets and traded to the Lakers.',
  'Since 2019 the three worst teams share the best lottery odds: 14% each at the No. 1 pick.',
  'The league held its first draft in 1947, back when it was still the BAA.',
];

function snakePickNumbers(slot: number, teamCount: number, rounds: number): number[] {
  return Array.from({ length: rounds }, (_, r) => {
    const pickInRound = r % 2 === 0 ? slot - 1 : teamCount - slot;
    return r * teamCount + pickInRound + 1;
  });
}

/**
 * The draft-slot reveal between the menu and the board. The slot itself is already decided
 * (`createInitialTeams` in draft.ts picks the human's slot at random when the draft is created);
 * this screen only reveals it.
 *
 * 2026-09-24, user's own call ("gracz ma w pompce gdzie jest AI, może losowanie ala kasyno gdzie
 * tylko pokazuje nasz numer draftu"): it used to reveal all 16 teams card by card, most of it
 * CPU teams nobody cares about at this point (the draft board's ticker shows them anyway). Now a
 * single slot-machine reel spins through the numbers and winds down onto YOUR pick, then spells
 * out what that slot means in a snake draft — every overall pick you'll make.
 *
 * 2026-09-28, user ("zastąpić mechanizm dźwigni ... na klasyczne kulki"): the reel and its lever
 * gave way to a lottery drum — one white ball per CPU team and a red one for the player drop into
 * the draft order one by one, and the pick the red ball lands in is the slot (lotteryDrum.ts).
 */
export default function DraftLottery({ teams, rounds, onDone, howToPlay, onExit, onRevealed }: Props) {
  const human = teams.find((t) => t.isHuman) ?? teams[0];
  const teamCount = teams.length;
  const slot = human.draftSlot;
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [archiveFact] = useState(() => DRAFT_ARCHIVE_FACTS[Math.floor(Math.random() * DRAFT_ARCHIVE_FACTS.length)]);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState({ text: 'Your ball is the red one.', hot: false });
  const [muted, setMuted] = useState(readMuted);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drumRef = useRef<LotteryDrum | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drum = createLotteryDrum(canvas, {
      slot,
      teamCount,
      onStatus: (text, hot) => setStatus({ text, hot }),
      onLanded: () => { setStarted(true); setDone(true); },
    });
    drumRef.current = drum;
    return () => { drum.destroy(); drumRef.current = null; };
  }, [slot, teamCount]);
  useEffect(() => {
    drumRef.current?.setMuted(muted);
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // storage blocked: the choice just lasts for this screen
    }
  }, [muted]);
  useEffect(() => {
    if (!done || !onRevealed) return;
    // Let the result paint first; preparing the data blocks the main thread for a moment.
    const id = window.setTimeout(onRevealed, 250);
    return () => window.clearTimeout(id);
  }, [done, onRevealed]);

  const picks = useMemo(() => snakePickNumbers(slot, teamCount, rounds), [slot, teamCount, rounds]);

  return (
    <div className={`at-shell at-calm at-lottery${started ? ' is-started' : ''}`}>
      <div className="at-calm-header">
        {onExit ? (
          <button type="button" className="at-calm-btn at-calm-btn--ghost" onClick={onExit}>
            ← Menu
          </button>
        ) : (
          <span className="rs-header-spacer" aria-hidden />
        )}
        <h1 className="at-calm-title">Draft Lottery</h1>
        <span className="rs-header-spacer" aria-hidden />
      </div>
      <p className={`at-lottery-sub${status.hot ? ' is-hot' : ''}`} aria-live="polite">
        <span className="at-lottery-sub-dot" aria-hidden />
        {status.text}
      </p>

      <canvas
        ref={canvasRef}
        className="at-drum"
        width={800}
        height={drumHeight(teamCount) * 2}
        aria-label={`Lottery drum: ${teamCount} team balls, yours in red, dropping into the draft order`}
      />

      {done && (
        <div className="at-lottery-result">
          <p className="at-lottery-team-line">
            <b>{human.name}</b> picks <b>#{slot}</b> in round 1.
          </p>
          <p className="at-lottery-picks-label">Snake draft — your picks:</p>
          {/* 2026-09-24, user-reported live ("brzydko dzieli te picki"): a wrapping flex row broke
              9 picks into an uneven 7 + 2. A grid with an explicit column count keeps rows even —
              all in one row when there's room, otherwise the most even split (9 -> 3x3). */}
          <div
            className="at-lottery-picks"
            style={{ '--pick-cols': picks.length, '--pick-cols-narrow': narrowPickColumns(picks.length) } as CSSProperties}
          >
            {picks.map((n, r) => (
              <span key={n} className="at-lottery-pick" title={`Round ${r + 1}`}>
                <span className="at-lottery-pick-round">R{r + 1}</span> #{n}
              </span>
            ))}
          </div>
        </div>
      )}

      {done && (
        <p className="at-lottery-archive">
          <span className="at-vintage-years">From the archives</span> {archiveFact}
        </p>
      )}

      <div className="at-lottery-actions">
        {done ? (
          <button className="primary-btn at-lottery-continue" onClick={onDone}>
            Play
          </button>
        ) : !started ? (
          <button
            className="primary-btn at-lottery-draw"
            onClick={() => {
              setStarted(true);
              drumRef.current?.start();
            }}
          >
            Draw
          </button>
        ) : null}
        <div className="at-lottery-secondary">
          {!done && (
            <button className="secondary-btn at-lottery-skip" onClick={() => drumRef.current?.finish()}>
              Skip
            </button>
          )}
          <button
            type="button"
            className="secondary-btn at-lottery-skip at-lottery-mute"
            aria-pressed={muted}
            onClick={() => setMuted((m) => !m)}
          >
            {muted ? 'Sound off' : 'Sound on'}
          </button>
        </div>
      </div>

      {howToPlay && howToPlay.length > 0 && (
        <div className="at-lottery-howtoplay">
          <button
            type="button"
            className="secondary-btn how-to-play-btn at-cond"
            onClick={() => setShowHowToPlay((v) => !v)}
          >
            {showHowToPlay ? 'Hide how to play' : 'How to play?'}
          </button>
          {showHowToPlay && (
            <ol className="how-to-play-panel">
              {howToPlay.map((item) => (
                <li key={item.title}>
                  <b>{item.title}.</b> {item.body}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
