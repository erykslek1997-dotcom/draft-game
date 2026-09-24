import { useEffect } from 'react';

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
  boardOpen,
  onToggleBoard,
}: {
  youOnClock: boolean;
  complete: boolean;
  onClockLabel: string;
  picksAway: number | null;
  recentPicks: TickerPick[];
  boardOpen: boolean;
  onToggleBoard: () => void;
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
      <button type="button" className="at-ticker-toggle at-cond" aria-expanded={boardOpen} onClick={onToggleBoard}>
        {boardOpen ? 'Hide draft board ▴' : 'Show full draft board ▾'}
      </button>
    </div>
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
