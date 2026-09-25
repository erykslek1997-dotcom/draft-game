import { useState } from 'react';
import { headshotUrl } from '../data/headshots';
import './ShotChip.css';

/**
 * 2026-09-11, shared between BestFive.tsx and QuickFive.tsx (user's own ask: "może używajmy
 * podobnych kafelków jak w build the best 5?" — use similar tiles between the two modes) — pulled
 * out once both needed it rather than duplicated, since it's real presentational logic (the cap-
 * relative color tiering), not the "separate lightweight copy, zero shared risk" philosophy that
 * governs quickDraft.ts's relationship to draft.ts (that one's about isolating calibration-
 * sensitive engine code; this is UI, safe to share).
 */

function initials(name: string): string {
  const p = name.split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/** 2026-09-11, user-reported live with their own example ("K. Abdul-Jabbar"): a long full name
 * wraps to two lines in the ~110px-wide pool-card grid, growing that one card taller than its
 * neighbors. Past `maxLen`, shrink the first name to an initial and keep the surname intact —
 * still identifiable, fits one line. Short names (or single-word ones, e.g. a mononym) pass
 * through untouched. Card buttons still carry the untruncated name in their `title` for hover. */
export function shortenName(name: string, maxLen = 15): string {
  if (name.length <= maxLen) return name;
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  const first = parts[0];
  const rest = parts.slice(1).join(' ');
  return `${first[0]}. ${rest}`;
}

/** Headshot with a monogram fallback (no image, or the image 404s). Faces come from the shared
 * `data/headshots` lookup Codex built for the Card Collection. */
export function Face({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const src = headshotUrl(name);
  // Track the src that failed, not a bare boolean — so when this same <Face> instance is reused
  // for a different player (React keeps it mounted across slot re-picks), a new `src` clears the
  // failed state and the monogram doesn't stick.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === src;
  return (
    <span className={`bf-face bf-face--${size}`} aria-hidden>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** A candidate's shot cost is real, always-visible game data (not the engine's hidden judgment),
 * so — unlike a talent/tier signal — it's safe to color without leaking anything a "blind
 * scouting" premise needs to hide. Tiered against an even per-slot split of the relevant cap: a
 * cheap pick reads as affordable at a glance, a pricey one as a real trade-off, without ever
 * hinting whether the player is actually GOOD. */
export function shotBudgetTier(fga: number, cap: number): 'cheap' | 'mid' | 'pricey' {
  const perSlot = cap / 5;
  if (fga <= perSlot * 0.75) return 'cheap';
  if (fga <= perSlot * 1.25) return 'mid';
  return 'pricey';
}

/** 2026-09-25, user's own pick ("nazwiemy to caps, jako waluta w grze… nawiązanie do cap space"):
 * the draft currency is "caps" — a bottle cap is both a nod to the salary cap and a classic
 * game currency. Under the hood a player's price is still his real shots per game (FGA). Drawn
 * as a plain crimped bottle cap seen from above, no brand. */
const CAP_EDGE_POINTS = Array.from({ length: 42 }, (_, i) => {
  const angle = (i / 42) * Math.PI * 2;
  const r = i % 2 === 0 ? 11.6 : 10.2;
  return `${(12 + r * Math.cos(angle)).toFixed(2)},${(12 + r * Math.sin(angle)).toFixed(2)}`;
}).join(' ');

export function CapIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="cap-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <polygon points={CAP_EDGE_POINTS} fill="#a8791f" />
      <circle cx="12" cy="12" r="9" fill="#e2b545" />
      <circle cx="12" cy="12" r="6.6" fill="none" stroke="#b8872a" strokeWidth="1.1" />
      <ellipse cx="9.6" cy="8.8" rx="2.6" ry="1.4" fill="#fff" opacity="0.45" transform="rotate(-30 9.6 8.8)" />
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

export function ShotChip({ fga, cap }: { fga: number; cap: number }) {
  return (
    <span className={`bf-shot-chip bf-shot-chip--${shotBudgetTier(fga, cap)}`} title={`Costs ${Math.round(fga)} caps`}>
      <CapIcon size={11} />
      {Math.round(fga)}
    </span>
  );
}

/** 2026-09-11, user-reported live on Szybka 5 ("cap bardziej widoczny"): the plain-text "Cap
 * remaining: N / M shots" label was easy to miss. Same real meter Best Five already has (label +
 * filled track), shared so both modes get one visible, consistent cap readout instead of two
 * different-looking ones. Whole-number display throughout — the underlying cap math stays exact
 * decimal, only what's shown is rounded (same "zaokrąglnijmy shots" ask applied everywhere). */
export function ShotsMeter({ used, cap, label = 'Caps' }: { used: number; cap: number; label?: string }) {
  const over = used > cap;
  return (
    <div className={`bf-shots-meter ${over ? 'bf-shots-meter--over' : ''}`}>
      <span className="bf-shots-label">
        <CapIcon size={16} /> {label}: <b>{Math.round(used)}</b> / {Math.round(cap)}
        {over && ' — over the cap'}
      </span>
      <span className="bf-shots-track">
        <span className="bf-shots-fill" style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} />
      </span>
    </div>
  );
}
