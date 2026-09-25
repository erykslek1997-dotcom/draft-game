import { useEffect, useState } from 'react';
import type { PlayerSpan } from '../data/schema';
import { DESK_EXPERT_TITLE, deskName, type DeskExpert, type DraftDeskResult } from '../engine/draftDesk';
import { Face } from './ShotChip';
import './DraftDesk.css';

/**
 * 2026-09-25, user's ask ("wypowiedzi ekspertów … po 3 pickach, jednorazowe"; mockup C, "debate
 * thread", picked over the studio-panel cards): shown once per full draft, right after the
 * human's third pick. Lines arrive one at a time like a live desk; the whole thing is skippable —
 * "Back to the draft" works from the first frame. CPU picks wait while it's open (GameShell).
 */
const LINE_DELAY_MS = 1100;

function ExpertIcon({ expert }: { expert: DeskExpert }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (expert === 'coach') {
    return (
      <svg {...common}>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 4V3h6v1" />
        <path d="M8.5 10l2 2 4-4" />
        <path d="M8.5 16h7" />
      </svg>
    );
  }
  if (expert === 'analyst') {
    return (
      <svg {...common}>
        <path d="M4 20h16" />
        <rect x="6" y="11" width="3" height="7" />
        <rect x="11" y="6" width="3" height="12" />
        <rect x="16" y="13" width="3" height="5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function DraftDesk({ roster, desk, onClose }: { roster: PlayerSpan[]; desk: DraftDeskResult; onClose: () => void }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? desk.turns.length : 1));
  const done = shown >= desk.turns.length;

  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setShown((n) => n + 1), LINE_DELAY_MS);
    return () => clearTimeout(t);
  }, [shown, done]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const next = desk.turns[shown];
  const title = roster.map(deskName).join(', ');

  return (
    <div className="mode-help-backdrop desk-backdrop">
      <div className="desk-modal" role="dialog" aria-modal="true" aria-labelledby="desk-title">
        <div className="desk-talk">
          <div className="desk-kicker">
            <span className="desk-live"><span className="desk-live-dot" />LIVE</span>
            <span className="desk-kicker-text at-cond">Draft Desk · after 3 picks</span>
          </div>
          <h2 id="desk-title" className="desk-title">{title} — the desk reacts</h2>
          <ol className="desk-thread" aria-live="polite">
            {desk.turns.slice(0, shown).map((turn, i) => (
              <li className="desk-line" key={i}>
                <span className="desk-avatar"><ExpertIcon expert={turn.expert} /></span>
                <div className="desk-line-body">
                  <span className="desk-speaker at-cond">{DESK_EXPERT_TITLE[turn.expert]}</span>
                  <p className="desk-bubble">{turn.text}</p>
                </div>
              </li>
            ))}
            {next && (
              <li className="desk-line desk-line--typing" aria-hidden>
                <span className="desk-avatar"><ExpertIcon expert={next.expert} /></span>
                <div className="desk-line-body">
                  <span className="desk-speaker at-cond">{DESK_EXPERT_TITLE[next.expert]}</span>
                  <span className="desk-bubble desk-typing"><i /><i /><i /></span>
                </div>
              </li>
            )}
          </ol>
        </div>
        <aside className="desk-side">
          <span className="desk-side-label at-cond">Your first three</span>
          <ul className="desk-roster">
            {roster.map((p) => (
              <li className="desk-roster-row" key={p.id}>
                <Face name={p.playerName} />
                <span className="desk-roster-name">{p.playerName}</span>
                <span className="desk-roster-pos">{p.primaryPosition}</span>
              </li>
            ))}
          </ul>
          <div className={`desk-consensus${done ? '' : ' desk-consensus--pending'}`}>
            <span className="desk-consensus-label at-cond">Desk consensus · next pick</span>
            <span className="desk-consensus-text">{done ? desk.consensus : '…'}</span>
          </div>
          <button type="button" className="primary-btn desk-close" onClick={onClose} autoFocus>
            Back to the draft
          </button>
        </aside>
      </div>
    </div>
  );
}
