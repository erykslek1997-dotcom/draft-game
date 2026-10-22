import { Fragment, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { headshotUrl } from '../data/headshots';
import { teamColors } from '../data/teamColors';
import { teamsForSpan } from '../engine/spanTeams';
import { isBombMasked, maskName, maskText, maskYears } from '../components/bombMask';
import { cardRoles } from '../components/cardRoles';
import { BRAND_MARK } from '../brand';
import { bandInk } from './color';
import { CapI, FaceContext, fmtCaps, cx } from './frame';
export * from './frame';

/**
 * The night edition's building blocks (approved mockups, docs/mockups/draw-five-night/). Each
 * piece mirrors one helper of the mockups (`mast`, `tally`, `prompt`, `five`, `card`…) and renders
 * the same classes, so `night/*.css` styles them exactly as the mockups do.
 */


/** "1999–01" style label shortened like the mockups' card names: "R. Wallace". */
/** An open slot's hint: "tap" on a touch screen, a plain word with a mouse (playtest 2026-10-22). */
export const TAP_TO_SHOW = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'tap to show' : 'show list';

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
export function NFace({ name, className, span }: { name: string; className?: string; span?: PlayerSpan }) {
  const src = headshotUrl(name);
  const [failed, setFailed] = useState<string | null>(null);
  const open = useContext(FaceContext);
  if (isBombMasked(name)) return <span className={cx('ini', className)}>?</span>;
  const face = src && failed !== src ? <img className={className} src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} /> : <span className={cx('ini', className)}>{initials(name)}</span>;
  if (!span || !open) return face;
  return (
    <button
      type="button"
      className="face-btn"
      title={`${span.playerName}: open his card`}
      aria-label={`${span.playerName}: open his card`}
      onClick={(e) => {
        e.stopPropagation();
        open(span);
      }}
    >
      {face}
    </button>
  );
}


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

/** The desk's lines as printed voices (mockup `mini.html#results` "The room"). */
export function NightVoices({ voices, cast, fold }: { voices: { who: string; kind: string; text: string; reply?: boolean }[]; cast: Record<string, { name: string; tag: string }>; fold?: number }) {
  // 2026-10-22 (playtest): a long room ran far past the column beside it; the first few voices show,
  // the rest open on request (never cutting a reply off from what it answers).
  const [open, setOpen] = useState(false);
  let cut = voices.length;
  if (fold && !open && voices.length > fold + 1) {
    cut = fold;
    while (cut < voices.length && voices[cut].reply) cut += 1;
  }
  const rest = voices.length - cut;
  return (
    <>
      {voices.slice(0, cut).map((v, i) => {
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
      {rest > 0 && (
        <button type="button" className="lk-inline voices-more" onClick={() => setOpen(true)}>
          Read the rest · {rest} more ▾
        </button>
      )}
    </>
  );
}
