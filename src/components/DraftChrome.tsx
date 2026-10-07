import { useEffect } from 'react';
import type { PlayerSpan } from '../data/schema';
import { rimPressureTeam } from '../engine/rimPressure';
import { CapIcon } from './ShotChip';
import { TIER_FRAME_COLOR } from './DraftPlayerCard';
import { MagnifierIcon } from './MagnifierIcon';

/**
 * 2026-09-24: small pieces of draft-screen chrome shared by the All-Time Draft (DraftBoard) and
 * Quick 5, so both modes behave the same: the collapsed-board ticker and the "leave this draft?"
 * confirm.
 */

export interface TickerPick {
  pickNumber: number;
  teamCode: string;
  isHuman: boolean;
  shortName: string;
}

/**
 * 2026-10-07, the UI simplification (approved mockup): one strip under the header replaces the
 * status line and the "Your pick" budget banner. Whose pick and the round on the left, your caps
 * next to it, the last two picks on the right; a 2px progress line runs along the bottom.
 */
export function DraftStrip({
  youOnClock,
  complete,
  onClockLabel,
  picksAway,
  recentPicks,
  round,
  rounds,
  progress,
  capLeft,
  slotsLeft,
  maxThisPick,
  scoutsLeft = null,
  onScoutsInfo,
}: {
  youOnClock: boolean;
  complete: boolean;
  onClockLabel: string;
  picksAway: number | null;
  recentPicks: TickerPick[];
  round: number;
  rounds: number;
  /** Share of all picks made, 0–1. */
  progress: number;
  capLeft: number;
  slotsLeft: number;
  /** This pick's hard ceiling, only when it rules someone out. */
  maxThisPick: number | null;
  /** Scouting reports left (null: not shown); the chip opens the "?" dialog that explains them. */
  scoutsLeft?: number | null;
  onScoutsInfo?: () => void;
}) {
  const perPick = slotsLeft > 0 ? capLeft / slotsLeft : capLeft;
  return (
    <div className={`at-calm-strip${youOnClock ? ' is-yours' : ''}`} role="status" aria-live="polite">
      <span className="at-calm-strip-turn">
        {complete ? (
          <b>Draft complete</b>
        ) : youOnClock ? (
          <span className="at-calm-pill">Your pick</span>
        ) : (
          <span className="at-calm-strip-clock">
            <b>{onClockLabel}</b> picking
            {picksAway !== null && <span className="at-calm-faint"> · you {picksAway === 1 ? 'next' : `in ${picksAway}`}</span>}
          </span>
        )}
        {!complete && (
          <span>
            Round <b className="at-calm-num">{round}</b> of {rounds}
          </span>
        )}
      </span>
      {slotsLeft > 0 && (
        <span className="at-calm-strip-caps">
          <CapIcon /> <b className="at-calm-num">{capLeft.toFixed(1)}</b>{' '}
          <span className="at-calm-soft">
            caps left{slotsLeft > 1 && <> · ~{perPick.toFixed(1)} a pick</>}
            {maxThisPick !== null && <> · max {maxThisPick.toFixed(1)} this pick</>}
          </span>
        </span>
      )}
      {scoutsLeft !== null && (
        <button type="button" className="at-calm-strip-scouts" onClick={onScoutsInfo} title="Tap a player card to open his scouting page">
          <MagnifierIcon /> {scoutsLeft} scouting report{scoutsLeft === 1 ? '' : 's'} left
        </button>
      )}
      {recentPicks.length > 0 && (
        <span className="at-calm-strip-last">
          {recentPicks.map((p, i) => (
            <span key={p.pickNumber}>
              {i > 0 && ' · '}
              {p.isHuman ? 'You' : p.teamCode} took {p.shortName}
            </span>
          ))}
        </span>
      )}
      <span className="at-calm-strip-progress" aria-hidden>
        <span style={{ width: `${progress * 100}%` }} />
      </span>
    </div>
  );
}

/** The "?" of the draft header: the rules, the card colours by tier and what scouting does. */
export function DraftHelpDialog({
  howToPlay,
  tiers,
  scoutsLeft,
  onClose,
}: {
  howToPlay: ReadonlyArray<{ title: string; body: string }>;
  tiers: ReadonlyArray<keyof typeof TIER_FRAME_COLOR>;
  scoutsLeft: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="mode-help-backdrop" onClick={onClose}>
      <div className="mode-help-modal at-calm-help" role="dialog" aria-modal="true" aria-label="How the draft works" onClick={(e) => e.stopPropagation()}>
        <div className="mode-help-modal-head">
          <span className="mode-help-modal-title">How the draft works</span>
          <button type="button" className="at-calm-icon" aria-label="Close" onClick={onClose} autoFocus>
            ×
          </button>
        </div>
        {howToPlay.map((item) => (
          <p key={item.title} className="at-calm-help-item">
            <b>{item.title}.</b> {item.body}
          </p>
        ))}
        <p className="at-calm-help-item">
          <b>Cards.</b> Draft takes the years shown on the card — his best stretch. Tap a card to open
          his scouting page and compare his other years.
        </p>
        <p className="at-calm-help-item">
          <b>Scouting.</b> {scoutsLeft > 0 ? `${scoutsLeft} scouting report${scoutsLeft === 1 ? '' : 's'} left` : 'No scouting reports left'} this
          draft. “Scout him” on a player’s page shows his tier and his offense, defense and fit grades.
        </p>
        {tiers.length > 0 && (
          <>
            <h3 className="at-calm-help-h">Tiers</h3>
            <p className="at-calm-help-item at-calm-faint">The label on a card is the tier of the years it drafts.</p>
            <div className="at-calm-help-tiers">
              {tiers.map((tier) => (
                <span key={tier}>
                  <span className="at-calm-dot" style={{ background: TIER_FRAME_COLOR[tier] }} aria-hidden />
                  {tier}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
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
      <span className="at-board-toggle-long">{open ? 'Hide board' : 'Draft board'}</span>
      <span className="at-board-toggle-short" aria-hidden>
        Board
      </span>
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

/** 2026-09-25, user-reported ("miałem niski rim pressure… nie ma żadnej takiej informacji podczas
 * draftu"): the results screen scores team rim pressure, but nothing warned about it while there
 * was still time to fix it. Same `rimPressureTeam` the fit score reads, on the current starters.
 * Below 55 is roughly the bottom tenth of finished CPU fives (seeded full drafts, 2026-09-25);
 * held back until three starters are in, when one pick can't yet be the whole story. */
const RIM_PRESSURE_WARN_BELOW = 55;
const RIM_PRESSURE_WARN_MIN_STARTERS = 3;

export function RimPressureNote({ starters }: { starters: PlayerSpan[] }) {
  if (starters.length < RIM_PRESSURE_WARN_MIN_STARTERS || starters.length > 5) return null;
  if (rimPressureTeam(starters) >= RIM_PRESSURE_WARN_BELOW) return null;
  return (
    <span className="at-your-turn-need">
      ⚠ Low rim pressure — nobody in your five attacks the basket yet. Look for a slasher or a big who finishes inside.
    </span>
  );
}
