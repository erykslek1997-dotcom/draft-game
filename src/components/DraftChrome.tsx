import { useEffect } from 'react';
import type { PlayerSpan } from '../data/schema';
import { rimPressureTeam } from '../engine/rimPressure';
import { CapIcon } from './ShotChip';
import { TIER_FRAME_COLOR } from './DraftPlayerCard';

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

export function DraftTicker({
  youOnClock,
  complete,
  onClockLabel,
  picksAway,
  recentPicks,
  progress,
}: {
  youOnClock: boolean;
  complete: boolean;
  onClockLabel: string;
  picksAway: number | null;
  recentPicks: TickerPick[];
  /** 2026-09-26 ("przylepiony pasek powinien bardziej pokazywać przebieg draftu"): the overall pick
   * count and round, shown as a thin bar under the ticker in the sticky header. */
  progress?: { picksMade: number; totalPicks: number; round: number; rounds: number };
}) {
  return (
    <div className="at-ticker">
      {progress && (
        <span className="at-ticker-progress" aria-label={`Pick ${Math.min(progress.picksMade + 1, progress.totalPicks)} of ${progress.totalPicks}`}>
          <span className="at-ticker-progress-text">
            Pick <b>{Math.min(progress.picksMade + 1, progress.totalPicks)}</b>/{progress.totalPicks} · Round {progress.round}/{progress.rounds}
          </span>
          <span className="at-ticker-progress-track" aria-hidden>
            <span style={{ width: `${(progress.picksMade / progress.totalPicks) * 100}%` }} />
          </span>
        </span>
      )}
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
            <p className="at-calm-help-item at-calm-faint">The dot on a card is the tier of the years it drafts.</p>
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

/**
 * The "Your pick" banner's budget line, shared by the All-Time Draft and Quick 5.
 *
 * 2026-09-24, user-reported live ("to się matematycznie zgadza, ale sugeruje zapychanie pod
 * limit"): the first version led with the MAXIMUM this pick could cost ("up to 12.4 shots this
 * pick (7.6 kept for your other 3 picks)") — correct, but it read as advice to spend it all now
 * and fill the rest with the cheapest bodies in the pool. It now leads with what's left and the
 * even split across the remaining picks; the hard maximum is only a quiet footnote.
 */
/** 2026-09-25, user's ask ("rundy 1-4 mogą być od siebie zależne… w pierwszej rundzie 'pick smart,
 * but don't look at the cost', i później opis w zależności co wybraliśmy"): while the per-pick
 * ceiling still rules nobody out, a short read on how you've been spending instead — measured
 * against an even split of the cap over the whole draft. */
function pacingHint(capTotal: number | undefined, capLeft: number, rounds: number, slotsLeft: number): string | null {
  if (capTotal == null) return null;
  const picksMade = rounds - slotsLeft;
  if (picksMade <= 0) return 'pick smart — the cost doesn’t matter yet';
  const evenShare = capTotal / rounds;
  const spentPerPick = (capTotal - capLeft) / picksMade;
  if (spentPerPick > evenShare * 1.25) return 'you’ve spent big — cheaper picks will have to follow';
  if (spentPerPick < evenShare * 0.8) return 'you’ve saved caps — room for another star';
  return 'right on pace — keep mixing stars and value';
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

export function TurnBudgetText({
  round,
  rounds,
  capLeft,
  slotsLeft,
  maxThisPick,
  priciestAvailable,
  capTotal,
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
  /** The whole cap, for the early-round pacing hint. */
  capTotal?: number;
}) {
  const ceilingMatters = priciestAvailable == null || maxThisPick < priciestAvailable;
  const hint = ceilingMatters ? null : pacingHint(capTotal, capLeft, rounds, slotsLeft);
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
          {hint && <span className="at-your-turn-reserve"> · {hint}</span>}
        </>
      )}
    </span>
  );
}
