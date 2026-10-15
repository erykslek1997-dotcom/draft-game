import { useEffect } from 'react';
import type { PlayerSpan } from '../data/schema';
import { DESK_CAST } from '../engine/desk';
import { CALLS_PER_DRAFT, type CallId, type CallOption, type CallResult } from '../engine/deskCalls';
import { DeskVoices } from './DeskVoices';
import { Face } from './ShotChip';
import { FitName } from './FitName';
import './PhoneDesk.css';

/**
 * 2026-10-15, "Phone the Desk" (approved mockup https://claude.ai/artifact/5ZSUn6nxWsoiybnPvmtGDm):
 * the chip in the status bar, the sheet of tonight's on-call experts, the call itself, and the
 * War Room banner over the list. The engine (deskCalls.ts) decides who answers what; this file only
 * shows it. A call never drafts for you — names go to your Big Board, the pick stays yours.
 */

export function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </svg>
  );
}

function Badge({ id }: { id: CallId }) {
  if (id === 'desk') return <span className="pd-av pd-av--desk" aria-hidden>TV</span>;
  const x = DESK_CAST[id];
  return <span className="pd-av" style={{ ['--h' as string]: x.hue }} aria-hidden>{x.mono}</span>;
}

/** The chip next to the scouting reports: how many calls are left, lit only on your pick. */
export function PhoneChip({ left, live, onOpen }: { left: number; live: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={`pd-chip${live ? ' is-live' : ''}`}
      onClick={onOpen}
      disabled={!live}
      title={live ? 'Call an expert from the studio' : 'Calls open on your pick'}
      aria-label={`Phone the desk, ${left} call${left === 1 ? '' : 's'} left`}
    >
      <PhoneIcon />
      <span className="pd-chip-label">Phone the desk ·</span>
      <span className="pd-chip-short">Call ·</span> <b>{left}</b>
    </button>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** Tonight's on-call experts, the desk and Moonbat. */
export function CallSheet({ options, left, pickLabel, onCall, onClose }: { options: CallOption[]; left: number; pickLabel: string; onCall: (id: CallId) => void; onClose: () => void }) {
  useEscape(onClose);
  return (
    <div className="mode-help-backdrop pd-backdrop" onClick={onClose}>
      <div className="pd-sheet" role="dialog" aria-modal="true" aria-labelledby="pd-sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="pd-sheet-head">
          <h2 id="pd-sheet-title">Who are you calling?</h2>
          <span className="pd-soft">{pickLabel}</span>
          <span className="pd-left">{left} of {CALLS_PER_DRAFT} calls left</span>
        </div>
        <div className="pd-lines">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`pd-line${o.unavailable ? ' is-off' : ''}${o.id === 'desk' ? ' pd-line--desk' : ''}${o.free ? ' pd-line--free' : ''}`}
              disabled={!!o.unavailable}
              onClick={() => onCall(o.id)}
            >
              <Badge id={o.id} />
              <span className="pd-who">
                <b>{o.name}</b>
                <small>{o.tag}</small>
                <span className="pd-blurb">{o.blurb}</span>
                <span className={`pd-badge${o.free ? ' pd-badge--free' : ''}`}>{o.unavailable ?? o.badge}</span>
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="at-calm-btn pd-close" onClick={onClose}>
          Back to the board
        </button>
      </div>
    </div>
  );
}

/** The call: the expert (and whoever barges in), then his names with a star for your Big Board. */
export function CallWindow({
  result,
  callNumber,
  starred,
  onToggleStar,
  onStarAll,
  onClose,
}: {
  result: CallResult | null;
  callNumber: number | null;
  starred: (name: string) => boolean;
  onToggleStar: (name: string) => void;
  onStarAll: (players: PlayerSpan[]) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const id = result?.id;
  const title = id === undefined ? 'Dialling…' : id === 'desk' ? 'The Desk' : DESK_CAST[id].name;
  // No lens in the subtitle either: the names give the taste away soon enough.
  const sub = id === undefined ? '' : id === 'moonbat' ? 'Free call' : `${id === 'desk' ? 'Chalk talk · ' : id === 'host' ? 'League sources · ' : ''}call ${callNumber ?? '?'} of ${CALLS_PER_DRAFT}`;
  return (
    <div className="mode-help-backdrop pd-backdrop" onClick={onClose}>
      <div className="pd-call" role="dialog" aria-modal="true" aria-labelledby="pd-call-title" onClick={(e) => e.stopPropagation()}>
        <div className="pd-call-top">
          {id !== undefined && <Badge id={id} />}
          <span className="pd-who">
            <b id="pd-call-title">{title}</b>
            <small>{sub}</small>
          </span>
          <span className="pd-onair"><i aria-hidden />{id === 'desk' ? 'LIVE' : 'ON THE LINE'}</span>
        </div>
        <div className="pd-call-body" aria-live="polite">
          {result ? <DeskVoices voices={result.lines} /> : <p className="pd-soft">Ringing the studio…</p>}
          {result && result.picks.length > 0 && (
            <ul className="pd-picks">
              {result.picks.map((p) => (
                <li key={p.id} className="pd-pick">
                  <Face name={p.playerName} />
                  <span className="pd-pick-name">
                    <FitName as="b" name={p.playerName} faceNextToIt />
                    <small>{p.primaryPosition} · {p.spanLabel}</small>
                  </span>
                  <span className="pd-pick-cost at-calm-num">{p.fga.toFixed(1)}</span>
                  <button
                    type="button"
                    className={`pd-star${starred(p.playerName) ? ' is-on' : ''}`}
                    onClick={() => onToggleStar(p.playerName)}
                    aria-pressed={starred(p.playerName)}
                    aria-label={`${starred(p.playerName) ? 'Remove' : 'Add'} ${p.playerName} ${starred(p.playerName) ? 'from' : 'to'} your Big Board`}
                  >
                    ★
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="pd-call-foot">
          <button type="button" className="primary-btn" onClick={onClose} autoFocus>
            Back to the board
          </button>
          {result && result.picks.length > 1 && (
            <button type="button" className="at-calm-btn" onClick={() => onStarAll(result.picks)}>
              Star all {result.picks.length}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Over the list while Onoffsky's War Room is on. */
export function WarRoomBanner({ count, showAll, onToggle }: { count: number; showAll: boolean; onToggle: () => void }) {
  const x = DESK_CAST.onoffsky;
  return (
    <div className="pd-warroom" role="status">
      <span className="pd-av" style={{ ['--h' as string]: x.hue }} aria-hidden>{x.mono}</span>
      <p>
        <b>Jake Onoffsky cut your board to {count}.</b>{' '}
        <span>{showAll ? 'Showing everyone for now.' : 'No order, no numbers — the rest won’t move your number. Ends after your pick.'}</span>
      </p>
      <button type="button" className="at-calm-btn" onClick={onToggle}>
        {showAll ? `Back to the ${count}` : 'Show everyone'}
      </button>
    </div>
  );
}
