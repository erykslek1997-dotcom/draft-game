import { useState } from 'react';
import type { PlayerSpan } from '../data/schema';
import { headshotUrl } from '../data/headshots';
import { BOMB_MIN_MINUTES } from '../engine/dailyBomb';
import { bombDescription } from './bombDescription';
import { Btn, CapI, H3, fmtCaps } from '../night/frame';

/**
 * 2026-10-16, the Bomb daily (mockup `docs/mockups/daily-drafts.html`, screens 4 and 5): the card
 * that takes your pick in the Bomb's round, and his reveal on the results — description, then
 * face, then name.
 */
export function BombLanding({ span, round, onContinue }: { span: PlayerSpan; round: number; onContinue: () => void }) {
  return (
    <div className="nt">
      <div className="drawer-dim" aria-hidden />
      <div className="modal bombm" role="alertdialog" aria-modal="true" aria-label="The Bomb joins your team">
        <span className="eb">Round {round} · The Bomb</span>
        <h2>Someone joins your team</h2>
        <span className="sil" aria-hidden>
          ?
        </span>
        <p className="bdesc">“{bombDescription(span)}”</p>
        <div className="bmeta">
          <span>{span.primaryPosition}</span>
          <span>
            <CapI />
            {fmtCaps(span.fga)} caps
          </span>
          <span>plays {BOMB_MIN_MINUTES}+ min</span>
        </div>
        <p className="empty-note">Who he is waits for the results.</p>
        <Btn onClick={onContinue}>Continue the draft</Btn>
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
    <section className="breveal" aria-label="The Bomb revealed">
      <H3 tone="gold" note={step < 2 ? 'tap to reveal' : gem ? 'a gem today' : 'a role player'}>
        The Bomb
      </H3>
      <div className="br-steps">
        <div className="br">
          <span className="eb">1 · Description</span>
          <span className="sil sm" aria-hidden>
            ?
          </span>
          <p>{bombDescription(span)}</p>
          {step === 0 && (
            <Btn kind="line" onClick={next}>
              Show his face
            </Btn>
          )}
        </div>
        <div className={`br${step >= 1 ? '' : ' hidden'}`}>
          <span className="eb">2 · Face</span>
          {step >= 1 && src ? <img src={src} alt="" /> : <span className="sil sm">?</span>}
          <p>{step >= 1 ? (gem ? 'A gem today.' : 'A role player.') : '…'}</p>
          {step === 1 && (
            <Btn kind="line" onClick={next}>
              Show his name
            </Btn>
          )}
        </div>
        <div className={`br${step >= 2 ? '' : ' hidden'}`}>
          <span className="eb">3 · Name</span>
          {step >= 2 && src ? <img src={src} alt="" /> : <span className="sil sm">?</span>}
          <p>
            {step >= 2 ? (
              <>
                <b>{span.playerName}</b> · {span.spanLabel}
              </>
            ) : (
              '…'
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
