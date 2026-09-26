import { useState } from 'react';

interface SpinLeverProps {
  /** Called once the arm reaches the bottom of its pull. */
  onPull: () => void;
  label?: string;
  disabled?: boolean;
}

/** Arm travel before `onPull` fires — the machine starts as the lever bottoms out. */
const PULL_MS = 380;

/**
 * 2026-09-26, the user: "jak losujemy numer draftu albo graczy, może być element wizualny który
 * daje nam możliwość wystartowania". A one-armed-bandit lever: the draw waits until it's pulled
 * (click, tap, Enter or Space), the arm swings down and springs back, and the reels start as it
 * bottoms out.
 */
export function SpinLever({ onPull, label = 'Pull', disabled = false }: SpinLeverProps) {
  const [pulled, setPulled] = useState(false);
  function pull() {
    if (pulled || disabled) return;
    setPulled(true);
    window.setTimeout(onPull, PULL_MS);
  }
  return (
    <button type="button" className={`spin-lever${pulled ? ' is-pulled' : ''}`} onClick={pull} disabled={disabled} aria-label={label}>
      <span className="spin-lever-track" aria-hidden>
        <span className="spin-lever-arm" />
        <span className="spin-lever-knob" />
        <span className="spin-lever-base" />
      </span>
      <span className="spin-lever-label at-cond">{label}</span>
    </button>
  );
}
