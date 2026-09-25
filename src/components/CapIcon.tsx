import { useEffect, useState } from 'react';
import './ShotChip.css';

/** 2026-09-25, user's own pick ("nazwiemy to caps, jako waluta w grze… nawiązanie do cap space"):
 * the draft currency is "caps" — a bottle cap is both a nod to the salary cap and a classic
 * game currency. Under the hood a player's price is still his real shots per game (FGA). Drawn
 * as a plain crimped bottle cap seen from above with a basketball on its face, no brand. */
const CAP_EDGE_POINTS = Array.from({ length: 42 }, (_, i) => {
  const angle = (i / 42) * Math.PI * 2;
  const r = i % 2 === 0 ? 11.6 : 10.2;
  return `${(12 + r * Math.cos(angle)).toFixed(2)},${(12 + r * Math.sin(angle)).toFixed(2)}`;
}).join(' ');

export function CapIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="cap-icon" data-caps-info width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <polygon points={CAP_EDGE_POINTS} fill="#a8791f" />
      <circle cx="12" cy="12" r="9" fill="#e2b545" />
      {/* basketball in the middle of the cap */}
      <circle cx="12" cy="12" r="6.4" fill="#e8762c" stroke="#7a3510" strokeWidth="0.8" />
      <g fill="none" stroke="#3b1a08" strokeWidth="0.75" strokeLinecap="round">
        <line x1="12" y1="5.6" x2="12" y2="18.4" />
        <line x1="5.6" y1="12" x2="18.4" y2="12" />
        <path d="M7.4 7.5 Q10 12 7.4 16.5" />
        <path d="M16.6 7.5 Q14 12 16.6 16.5" />
      </g>
      <ellipse cx="8.6" cy="7.2" rx="2.2" ry="1.1" fill="#fff" opacity="0.35" transform="rotate(-35 8.6 7.2)" />
    </svg>
  );
}

/** An amount of caps: icon + number (whole numbers unless `decimals` asks otherwise). */
export function Caps({ value, decimals = 0, size }: { value: number; decimals?: number; size?: number }) {
  return (
    <span className="caps-amount" title="caps">
      <CapIcon size={size} />
      {value.toFixed(decimals)}
    </span>
  );
}

/** 2026-09-25, user's ask ("jak ktoś kliknie na ikonę caps to pop-up który wyjaśnia co to jest"):
 * mounted once at the app root. A click on any caps icon that isn't inside a button or link (where
 * the click belongs to that control) opens this short explainer. */
export function CapsInfoHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const icon = target?.closest?.('[data-caps-info]');
      if (!icon || icon.closest('button, a, select, label')) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="at-shell caps-info-overlay" onClick={() => setOpen(false)}>
      <div className="caps-info-card" role="dialog" aria-modal="true" aria-label="What are caps?" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="player-peek-close" onClick={() => setOpen(false)} aria-label="Close">
          ✕
        </button>
        <div className="caps-info-head">
          <CapIcon size={40} />
          <h2>Caps</h2>
        </div>
        <p>
          <b>Caps are your draft budget.</b> Every player costs caps — as many as the shots a game he took in those
          years. Stars who took a lot of shots cost a lot; role players and defenders are cheap.
        </p>
        <p>
          Your whole team has to fit under the cap shown on the meter. Spend big on early stars and you’ll need
          bargains later — a cheaper stretch of the same player’s career can be the one that fits.
        </p>
        <p className="caps-info-foot">The name is a nod to the NBA’s salary cap.</p>
      </div>
    </div>
  );
}
