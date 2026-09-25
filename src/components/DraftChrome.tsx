import { useEffect } from 'react';
import { CapIcon } from './ShotChip';

/**
 * 2026-09-24: small pieces of draft-screen chrome shared by the All-Time Draft (DraftBoard) and
 * Quick 5, so both modes behave the same: the CPU-speed control, the collapsed-board ticker and
 * the "leave this draft?" confirm.
 */

export function AiSpeedControl({
  labels,
  index,
  onChange,
}: {
  labels: readonly string[];
  index: number;
  onChange: (index: number) => void;
}) {
  return (
    <div className="at-speed" role="group" aria-label="CPU pick speed">
      <span className="at-speed-label at-cond">CPU speed</span>
      {labels.map((label, i) => (
        <button
          key={label}
          type="button"
          className={`at-speed-btn at-cond ${i === index ? 'at-active' : ''}`}
          aria-pressed={i === index}
          onClick={() => onChange(i)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export interface TickerPick {
  pickNumber: number;
  teamCode: string;
  isHuman: boolean;
  shortName: string;
}

export function DraftTicker({
  youOnClock,
  complete,
  onClockLabel,
  picksAway,
  recentPicks,
}: {
  youOnClock: boolean;
  complete: boolean;
  onClockLabel: string;
  picksAway: number | null;
  recentPicks: TickerPick[];
}) {
  return (
    <div className="at-ticker">
      <span className="at-ticker-now">
        {youOnClock ? (
          <b className="at-ticker-you">You're on the clock</b>
        ) : complete ? (
          <b>Draft complete</b>
        ) : (
          <>
            <span className="at-ticker-label">On the clock</span> <b>{onClockLabel}</b>
          </>
        )}
        {!complete && !youOnClock && picksAway !== null && (
          <span className="at-ticker-next">· you pick {picksAway === 1 ? 'next' : `in ${picksAway} picks`}</span>
        )}
      </span>
      {recentPicks.length > 0 && (
        <span className="at-ticker-recent" aria-label="Latest picks">
          {recentPicks.map((p) => (
            <span key={p.pickNumber} className={`at-ticker-pick ${p.isHuman ? 'is-you' : ''}`}>
              <span className="at-ticker-pick-no">#{p.pickNumber}</span> {p.teamCode} {p.shortName}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * Show/hide the full draft board. 2026-09-24, user-reported live ("nachodzi na siebie, i trochę nie
 * pasuje, może tam gdzie szybkość go damy?"): it first sat inside the ticker row, crowding the
 * latest-picks chips and butting into the opened board; it now lives in the top bar next to the
 * CPU-speed control, with the other "how this screen looks" settings.
 */
export function BoardToggleButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="at-board-toggle at-cond" aria-expanded={open} onClick={onToggle}>
      {open ? 'Hide draft board ▴' : 'Show draft board ▾'}
    </button>
  );
}

export function LeaveDraftDialog({ text, onStay, onLeave }: { text: string; onStay: () => void; onLeave: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onStay();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStay]);
  return (
    <div className="mode-help-backdrop" onClick={onStay}>
      <div
        className="mode-help-modal at-exit-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="Leave the draft?"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mode-help-modal-head">
          <span className="mode-help-modal-title at-cond">Leave the draft?</span>
        </div>
        <p className="at-exit-modal-text">{text}</p>
        <div className="at-exit-modal-actions">
          <button type="button" className="secondary-btn" onClick={onStay} autoFocus>
            Keep drafting
          </button>
          <button type="button" className="primary-btn" onClick={onLeave}>
            Back to menu
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The "Your pick" banner's budget line, shared by the All-Time Draft and Quick 5.
 *
 * 2026-09-24, user-reported live ("to się matematycznie zgadza, ale sugeruje zapychanie pod
 * limit"): the first version led with the MAXIMUM this pick could cost ("up to 12.4 shots this
 * pick (7.6 kept for your other 3 picks)") — correct, but it read as advice to spend it all now
 * and fill the rest with the cheapest bodies in the pool. It now leads with what's left and the
 * even split across the remaining picks; the hard maximum is only a quiet footnote.
 */
export function TurnBudgetText({
  round,
  rounds,
  capLeft,
  slotsLeft,
  maxThisPick,
  priciestAvailable,
}: {
  round: number;
  rounds: number;
  capLeft: number;
  slotsLeft: number;
  maxThisPick: number;
  /** Cost of the most expensive player still on the board. The per-pick ceiling is only worth
   * mentioning once it's below that — early on "can cost up to 78.6" rules nobody out and just
   * reads as noise (user-reported live: "78.6 nadal trochę dziwnie"). */
  priciestAvailable?: number;
}) {
  const ceilingMatters = priciestAvailable == null || maxThisPick < priciestAvailable;
  const perPick = (slotsLeft > 0 ? capLeft / slotsLeft : capLeft).toFixed(1);
  const left = capLeft.toFixed(1);
  return (
    <span>
      Round {round}/{rounds} ·{' '}
      {slotsLeft <= 1 ? (
        <>
          <CapIcon /> <b>{left}</b> caps left for your last pick
        </>
      ) : (
        <>
          <CapIcon /> <b>{left}</b> caps left for your last {slotsLeft} picks — about <b>{perPick}</b> each
          {ceilingMatters && (
            <span className="at-your-turn-reserve"> · this pick can cost up to {maxThisPick.toFixed(1)}</span>
          )}
        </>
      )}
    </span>
  );
}
