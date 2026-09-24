import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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
}

/** Tick delays for the reel, fast to slow — a slot machine winding down onto the result. */
function reelDelays(): number[] {
  const delays: number[] = [];
  for (let d = 45; d < 420; d *= 1.13) delays.push(Math.round(d));
  return delays;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Overall pick numbers (1-based) a team in `slot` makes in a snake draft. */
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
 */
export default function DraftLottery({ teams, rounds, onDone, howToPlay, onExit }: Props) {
  const human = teams.find((t) => t.isHuman) ?? teams[0];
  const teamCount = teams.length;
  const slot = human.draftSlot;
  const delays = useMemo(reelDelays, []);
  const [tick, setTick] = useState(() => (prefersReducedMotion() ? delays.length : 0));
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const done = tick >= delays.length;

  useEffect(() => {
    if (done) return;
    const timer = setTimeout(() => setTick((t) => t + 1), delays[tick]);
    return () => clearTimeout(timer);
  }, [tick, done, delays]);

  // Counts up through the numbers like a reel and lands exactly on the real slot on the last tick.
  const shown = ((((slot - 1 - (delays.length - tick)) % teamCount) + teamCount) % teamCount) + 1;
  const picks = useMemo(() => snakePickNumbers(slot, teamCount, rounds), [slot, teamCount, rounds]);

  return (
    <div className="at-shell at-lottery">
      {onExit && (
        <button type="button" className="at-menu-btn at-cond" onClick={onExit}>
          ← Menu
        </button>
      )}
      <div className="at-board-brand at-cond">Draft Lottery</div>
      <p className="at-lottery-sub">{done ? 'The balls have spoken.' : 'Drawing your draft slot…'}</p>

      <div className={`at-reel ${done ? 'at-reel--done' : ''}`} aria-live="polite">
        <span className="at-reel-label at-cond">Your pick</span>
        <span className="at-reel-window">
          <span key={tick} className="at-reel-number at-cond">
            #{shown}
          </span>
        </span>
        <span className="at-reel-of">of {teamCount}</span>
      </div>

      {done && (
        <div className="at-lottery-result">
          <p className="at-lottery-team-line">
            <b>{human.name}</b> picks <b>#{slot}</b> in round 1.
          </p>
          <p className="at-lottery-picks-label">Snake draft — your picks:</p>
          <div className="at-lottery-picks">
            {picks.map((n, r) => (
              <span key={n} className="at-lottery-pick" title={`Round ${r + 1}`}>
                <span className="at-lottery-pick-round">R{r + 1}</span> #{n}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="at-lottery-actions">
        {done ? (
          <button className="primary-btn at-lottery-continue" onClick={onDone}>
            Play
          </button>
        ) : (
          <button className="secondary-btn at-lottery-skip" onClick={() => setTick(delays.length)}>
            Skip
          </button>
        )}
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
