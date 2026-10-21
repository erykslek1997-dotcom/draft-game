import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { headshotUrl } from '../data/headshots';
import { teamColors } from '../data/teamColors';
import { teamsForSpan } from '../engine/spanTeams';
import { isBombMasked, maskName, maskText, maskYears } from '../components/bombMask';
import { cardRoles } from '../components/cardRoles';
import { BRAND_MARK } from '../brand';
import { getSettings } from '../settings';
import { bandInk } from './color';
import './index.css';

/**
 * The night edition's building blocks (approved mockups, docs/mockups/draw-five-night/). Each
 * piece mirrors one helper of the mockups (`mast`, `tally`, `prompt`, `five`, `card`…) and renders
 * the same classes, so `night/*.css` styles them exactly as the mockups do.
 */

export const SLOTS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
export const SLOT_NAME: Record<Position, string> = { PG: 'Point guard', SG: 'Shooting guard', SF: 'Small forward', PF: 'Power forward', C: 'Center' };

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** "1999–01" style label shortened like the mockups' card names: "R. Wallace". */
export function shortName(name: string): string {
  const shown = maskName(name);
  const w = shown.split(' ');
  if (w.length < 2) return shown;
  return `${w[0][0]}. ${w.slice(1).join(' ')}`;
}

export function lastName(name: string): string {
  const shown = maskName(name);
  return shown.split(' ').slice(-1)[0];
}

function initials(name: string): string {
  const p = maskName(name).split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/** A headshot, or the player's initials on a plain disc. The Bomb shows a "?". */
export function NFace({ name, className }: { name: string; className?: string }) {
  const src = headshotUrl(name);
  const [failed, setFailed] = useState<string | null>(null);
  if (isBombMasked(name)) return <span className={cx('ini', className)}>?</span>;
  if (src && failed !== src) return <img className={className} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />;
  return <span className={cx('ini', className)}>{initials(name)}</span>;
}

/** The cap coin in front of a price. */
export const CapI = () => <i className="capi" aria-hidden />;

/** A span's first team, its band colour and the readable ink on it. */
export function spanBand(span: Pick<PlayerSpan, 'playerName' | 'spanLabel'>): { code: string; color: string; ink: string } {
  const first = teamsForSpan(span)[0];
  if (!first) return { code: '', color: '#5B564C', ink: '#FFFFFF' };
  const c = teamColors(first.code, first.seasonEnd);
  return { code: first.code, color: c.primary, ink: bandInk(c.primary) };
}

export const bandStyle = (span: Pick<PlayerSpan, 'playerName' | 'spanLabel'>): CSSProperties => {
  const b = spanBand(span);
  return { '--team': b.color, '--team-ink': b.ink } as CSSProperties;
};

/** A league team's printed swatch (`.tm`). */
export function TeamMark({ code, bg, fg, lg }: { code: string; bg: string; fg: string; lg?: boolean }) {
  return (
    <span className={cx('tm', lg && 'lg')} style={{ background: bg, color: bandInk(bg, fg) }}>
      {code}
    </span>
  );
}

export const fmtCaps = (v: number) => (Number.isInteger(Math.round(v * 10) / 10) ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1));
export const fmt1 = (v: number) => v.toFixed(1);

/* ---------------- page frame ---------------- */

/** The two columns: the aside (masthead, tally, log, actions) and the main stage. An empty aside
 * gives the main stage the full width. */
export function NightGame({ aside, children, className, overlay }: { aside?: ReactNode; children: ReactNode; className?: string; overlay?: ReactNode }) {
  return (
    <div className={cx('nt', className)}>
      <div className={cx('game', !aside && 'solo')}>
        {aside && <aside>{aside}</aside>}
        <main>{children}</main>
      </div>
      {overlay}
    </div>
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
}) {
  const midCls = clock ? 'clock' : plain || midK !== 'Cap' ? 'plain' : undefined;
  return (
    <div className="tally keep">
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

/* ---------------- cards ---------------- */

/** The printed player card (`.card`): cream paper, the team band with the cost, face, name,
 * position · years, style, a three-cell stat table. */
export function NCard({
  span,
  cls,
  over,
  took,
  onClick,
  disabled,
  title,
  costLabel,
  bandLabel,
  pos,
  jokerBand,
}: {
  span: PlayerSpan;
  cls?: string;
  /** "Over the cap by 0.9" in place of the stats. */
  over?: string;
  /** The AI's choice tag. */
  took?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  costLabel?: ReactNode;
  bandLabel?: ReactNode;
  pos?: string;
  /** A turned-over Joker: the band reads "JOKER · team" in gold. */
  jokerBand?: boolean;
}) {
  const band = spanBand(span);
  const roles = cardRoles(span);
  const inner = (
    <>
      <div className={cx('top', jokerBand && 'jk')}>
        <span>{bandLabel ?? (jokerBand ? `JOKER · ${band.code}` : band.code)}</span>
        <span className="cost">{costLabel ?? fmtCaps(span.fga)}</span>
      </div>
      <div className="pic">
        <NFace name={span.playerName} />
      </div>
      <div className="nm">{maskName(span.playerName)}</div>
      <div className="sb">
        {pos ?? span.primaryPosition} · {maskYears(span.playerName, span.spanLabel)}
      </div>
      <div className="roles">{roles.length ? roles.join(' · ') : ' '}</div>
      {over ? (
        <div className="over">{over}</div>
      ) : (
        <div className="st">
          <div>
            <b>{span.box.ppg.toFixed(1)}</b>
            <span>PTS</span>
          </div>
          <div>
            <b>{span.box.rpg.toFixed(1)}</b>
            <span>REB</span>
          </div>
          <div>
            <b>{span.box.apg.toFixed(1)}</b>
            <span>AST</span>
          </div>
        </div>
      )}
      {took && <span className="took">{took}</span>}
    </>
  );
  const style = { '--team': band.color, '--team-ink': band.ink } as CSSProperties;
  if (onClick) {
    return (
      <button type="button" className={cx('card', cls)} style={style} onClick={onClick} disabled={disabled} title={title}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cx('card', cls)} style={style} title={title}>
      {inner}
    </div>
  );
}

/** The face-down deck with the brand mark. */
export function CardBack() {
  return (
    <div className="back" aria-hidden>
      <span className="mark">{BRAND_MARK}</span>
    </div>
  );
}

/** A slot of your five: filled (cream card), the active one (red), an empty one. */
export function Slot({
  pos,
  span,
  state,
  small,
  land,
  onClick,
  title,
}: {
  pos: Position;
  span?: PlayerSpan;
  state?: 'active' | 'empty' | 'sel';
  small?: ReactNode;
  land?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  if (span) {
    const band = spanBand(span);
    return (
      <Tag
        {...(onClick ? { type: 'button' as const, onClick } : {})}
        className={cx('slot filled', land && 'land')}
        style={{ '--team': band.color, '--team-ink': band.ink } as CSSProperties}
        title={title ?? maskName(span.playerName)}
      >
        <div className="top">
          <span>{band.code}</span>
          <span>{pos}</span>
        </div>
        <NFace name={span.playerName} />
        <div className="nm">{shortName(span.playerName)}</div>
        <div className="sb">
          {maskYears(span.playerName, span.spanLabel)} · <CapI />
          {fmtCaps(span.fga)}
        </div>
      </Tag>
    );
  }
  return (
    <Tag {...(onClick ? { type: 'button' as const, onClick } : {})} className={cx('slot', state === 'active' ? 'active' : 'empty', state === 'sel' && 'sel')} title={title}>
      {pos}
      {small != null && <small>{small}</small>}
    </Tag>
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

/** The desk's lines as printed voices (mockup `mini.html#results` "The room"). */
export function NightVoices({ voices, cast }: { voices: { who: string; kind: string; text: string; reply?: boolean }[]; cast: Record<string, { name: string; tag: string }> }) {
  return (
    <>
      {voices.map((v, i) => {
        const x = cast[v.who];
        const parts = maskText(v.text)
          .split(/\*(.+?)\*/g)
          .map((part, j) => (j % 2 ? <i key={j} className="cue">{part}</i> : <Fragment key={j}>{part}</Fragment>));
        return (
          <p key={i} className={v.reply ? 'reply' : undefined}>
            {x && v.kind !== 'burst' && <b>{x.name}: </b>}
            {parts}
            {x && v.kind !== 'burst' && <em>{x.tag}</em>}
          </p>
        );
      })}
    </>
  );
}
