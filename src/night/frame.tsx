import { Suspense, createContext, lazy, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { getSettings } from '../settings';
import './index.css';

/**
 * The light half of the night edition's building blocks: the page frame, the masthead, the tally,
 * section heads, buttons, the prompt and the dialog. No player data, so the menu can use them
 * without pulling the engine in (see App.tsx's lazy-loading notes). The player pieces live in
 * `ui.tsx`, which re-exports these.
 */

export const SLOTS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
export const SLOT_NAME: Record<Position, string> = { PG: 'Point guard', SG: 'Shooting guard', SF: 'Small forward', PF: 'Power forward', C: 'Center' };

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** The cap coin in front of a price. */
export const CapI = () => <i className="capi" aria-hidden />;

// Caps always carry one decimal, so a column of them lines up ("19.0" next to "22.5"; playtest 2026-10-22).
export const fmtCaps = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
export const fmt1 = (v: number) => v.toFixed(1);

/* ---------------- page frame ---------------- */

/** The two columns: the aside (masthead, tally, log, actions) and the main stage. An empty aside
 * gives the main stage the full width. */
/**
 * 2026-10-22, playtest ("fajnie jakbym mógł kliknąć"): a face given its span (`NFace span=`) opens
 * that player's window. A screen with more to say provides its own (the draft: his scouting card
 * with Draft; the season: his season card); every other night screen gets his card to read.
 */
export const FaceContext = createContext<((span: PlayerSpan) => void) | null>(null);
// Lazy: the frame stays free of player data for the menu.
const SpanCard = lazy(() => import('../components/PlayerPeekModal').then((m) => ({ default: m.SpanCard })));

export function NightGame({ aside, children, className, overlay }: { aside?: ReactNode; children: ReactNode; className?: string; overlay?: ReactNode }) {
  const outer = useContext(FaceContext);
  const [card, setCard] = useState<PlayerSpan | null>(null);
  return (
    <FaceContext.Provider value={outer ?? setCard}>
      <div className={cx('nt', className)}>
        <div className={cx('game', !aside && 'solo')}>
          {aside && <aside>{aside}</aside>}
          <main>{children}</main>
        </div>
        {overlay}
        {card && (
          <Suspense fallback={null}>
            <SpanCard span={card} onClose={() => setCard(null)} />
          </Suspense>
        )}
      </div>
    </FaceContext.Provider>
  );
}

export function Mast({ title, sub, daily }: { title: ReactNode; sub: ReactNode; daily?: boolean }) {
  return (
    <div className="mast keep">
      <b className={daily ? 'daily' : undefined}>{title}</b>
      <small>{sub}</small>
    </div>
  );
}

export function Tally({
  you,
  mid,
  ai,
  youK = 'You',
  midK = 'Cap',
  aiK = 'AI',
  clock,
  name,
  plain,
  small,
}: {
  you: ReactNode;
  mid: ReactNode;
  ai: ReactNode;
  youK?: string;
  midK?: string;
  aiK?: string;
  /** The middle number is a running game clock (red frame). */
  clock?: boolean;
  /** The right side is a team name, not a number. */
  name?: boolean;
  /** The middle number is not the cap (no gold). */
  plain?: boolean;
  /** Smaller numbers, for records like 52–30 (`.tsm`). */
  small?: boolean;
}) {
  // A word in the middle ("Final", "Tip-off", "Semis") sits on the same baseline, a size down.
  const word = typeof mid === 'string' && /[a-z]{3}/i.test(mid) && mid.length > 3;
  const midCls = cx(clock ? 'clock' : plain || midK !== 'Cap' ? 'plain' : undefined, word && !clock && 'word');
  return (
    <div className={small ? 'tally keep tsm' : 'tally keep'}>
      <div className="t">
        <span className="k">{youK}</span>
        <b>{you}</b>
      </div>
      <div className="t mid">
        <span className="k">{midK}</span>
        <b className={midCls}>{mid}</b>
      </div>
      <div className="t ai">
        <span className="k">{aiK}</span>
        <b className={name ? 'name' : undefined}>{ai}</b>
      </div>
    </div>
  );
}

export function CapBar({ used, cap }: { used: number; cap: number }) {
  const pct = cap > 0 ? Math.max(0, Math.min(100, (used / cap) * 100)) : 0;
  return (
    <div className="capbar keep" aria-hidden>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SubNote({ children }: { children: ReactNode }) {
  return <p className="sub-note keep">{children}</p>;
}

/** A section head: caps over the cream rule, an italic note on the right. */
export function H3({ children, note, tone }: { children: ReactNode; note?: ReactNode; tone?: 'red' | 'gold' }) {
  return (
    <h3 className={tone}>
      {children}
      {note != null && note !== false && <span>{note}</span>}
    </h3>
  );
}

export function Kv({ k, v, gold, children }: { k: ReactNode; v?: ReactNode; gold?: boolean; children?: ReactNode }) {
  return (
    <div className="kv">
      <span>{k}</span>
      {children ?? <b className={gold ? 'g' : undefined}>{v}</b>}
    </div>
  );
}

export function EmptyNote({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p className="empty-note" style={style}>
      {children}
    </p>
  );
}

export interface NavLinks {
  onMenu?: () => void;
  onHowTo?: () => void;
  onSettings?: () => void;
}

export function Links({ onMenu, onHowTo, onSettings }: NavLinks) {
  return (
    <div className="links">
      {onMenu && (
        <button type="button" className="lk" onClick={onMenu}>
          ← Menu
        </button>
      )}
      {onHowTo && (
        <button type="button" className="lk" onClick={onHowTo}>
          How to play
        </button>
      )}
      {onSettings && (
        <button type="button" className="lk" onClick={onSettings}>
          Settings
        </button>
      )}
    </div>
  );
}

/** The aside's foot: the main buttons, then the quiet links. */
export function Actions({ children, links }: { children?: ReactNode; links?: NavLinks }) {
  return (
    <div className="actions">
      {children}
      {links && <Links {...links} />}
    </div>
  );
}

type BtnKind = 'go' | 'line' | 'off';
export function Btn({
  kind = 'go',
  children,
  onClick,
  disabled,
  className,
  title,
}: {
  kind?: BtnKind;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button type="button" className={cx('btn', disabled ? 'off' : kind, className)} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

/** The big prompt over the stage. A red eyebrow only when something happens now. */
export function Prompt({ eb, title, children, now, tone, className }: { eb: ReactNode; title: ReactNode; children?: ReactNode; now?: boolean; tone?: 'gold'; className?: string }) {
  return (
    <div className={cx('prompt', className)}>
      <span className={cx('eb', now && 'now', tone)}>{eb}</span>
      <h2>{title}</h2>
      {children != null && <p>{children}</p>}
    </div>
  );
}

/** A modal over the screen: a dim layer and the dialog (`.dlg` in the mockups). */
export function Dialog({ title, onClose, children, small, className }: { title: ReactNode; onClose?: () => void; children: ReactNode; small?: boolean; className?: string }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-dim" onClick={onClose} aria-hidden />
      <div className={cx('dlg', small && 'sm', className)} role="dialog" aria-modal="true">
        <div className="dlg-head">
          <h2>{title}</h2>
          {onClose && (
            <button type="button" className="x" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </>
  );
}

/** "Tuesday, Oct 21" from "2026-10-21". */
export function dayLabel(day: string, long = false): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: long ? 'long' : 'short', day: 'numeric' });
}

/** Phone vibration (Settings → Vibration). A no-op where the browser can't. */
export function buzz(pattern: number | number[] = 18): void {
  try {
    if (getSettings().vibration === 'off') return;
    navigator.vibrate?.(pattern);
  } catch {
    /* no vibration */
  }
}
