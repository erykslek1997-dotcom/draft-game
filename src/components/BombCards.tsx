import { useState } from 'react';
import type { PlayerSpan } from '../data/schema';
import { headshotUrl } from '../data/headshots';
import { BOMB_MIN_MINUTES } from '../engine/dailyBomb';
import { bombDescription } from './bombDescription';
import { CapIcon } from './CapIcon';

/**
 * 2026-10-16, the Bomb daily (mockup `docs/mockups/daily-drafts.html`, screens 4 and 5): the card
 * that takes your pick in the Bomb's round, and his reveal on the results — description, then
 * face, then name.
 */
export function BombLanding({ span, round, onContinue }: { span: PlayerSpan; round: number; onContinue: () => void }) {
  return (
    <div className="mode-help-backdrop bomb-backdrop">
      <div className="bomb-card at-stage-in" role="alertdialog" aria-modal="true" aria-label="The Bomb joins your team">
        <span className="bomb-k">Round {round} · The Bomb</span>
        <h2 className="bomb-h">Someone joins your team</h2>
        <span className="bomb-sil" aria-hidden>
          ?
        </span>
        <p className="bomb-desc">{bombDescription(span)}</p>
        <p className="bomb-meta">
          {span.primaryPosition} · <CapIcon /> {span.fga.toFixed(1)} caps · plays at least {BOMB_MIN_MINUTES} minutes
        </p>
        <p className="bomb-meta">Who he is waits for the results.</p>
        <button type="button" className="rs-primary bomb-go" onClick={onContinue} autoFocus>
          Continue the draft
        </button>
      </div>
    </div>
  );
}

/** The results' reveal: each tap shows the next step; the last one names him (`onNamed`). */
export function BombReveal({ span, gem, onNamed }: { span: PlayerSpan; gem: boolean; onNamed: () => void }) {
  const [step, setStep] = useState(0);
  const src = headshotUrl(span.playerName);
  function next() {
    const n = step + 1;
    setStep(n);
    if (n === 2) onNamed();
  }
  return (
    <section className="bomb-reveal" aria-label="The Bomb revealed">
      <div className="bomb-reveal-head">
        <span className="bomb-k">The Bomb</span>
        {step < 2 && (
          <button type="button" className="at-calm-btn bomb-reveal-next" onClick={next}>
            {step === 0 ? 'Show his face' : 'Show his name'}
          </button>
        )}
      </div>
      <div className="bomb-reveal-steps">
        <div className="bomb-rv">
          <span className="bomb-rv-st">1 · Description</span>
          <span className="bomb-sil bomb-sil--sm" aria-hidden>
            ?
          </span>
          <span className="bomb-rv-txt">{bombDescription(span)}</span>
        </div>
        <div className={`bomb-rv${step >= 1 ? '' : ' is-hidden'}`}>
          <span className="bomb-rv-st">2 · Face</span>
          {step >= 1 && src ? <img className="bomb-rv-face" src={src} alt="" /> : <span className="bomb-sil bomb-sil--sm">?</span>}
          <span className="bomb-rv-txt">{step >= 1 ? (gem ? 'A gem today.' : 'A role player.') : '…'}</span>
        </div>
        <div className={`bomb-rv${step >= 2 ? ' is-named' : ' is-hidden'}`}>
          <span className="bomb-rv-st">3 · Name</span>
          {step >= 2 && src ? <img className="bomb-rv-face" src={src} alt="" /> : <span className="bomb-sil bomb-sil--sm">?</span>}
          <span className="bomb-rv-txt">
            {step >= 2 ? (
              <>
                <b>{span.playerName}</b> · {span.spanLabel}
              </>
            ) : (
              '…'
            )}
          </span>
        </div>
      </div>
    </section>
  );
}
