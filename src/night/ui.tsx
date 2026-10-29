import { useContext, useState, type CSSProperties, type ReactNode } from 'react';
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
  const w = shown.split(' ');
  // "Otto Porter Jr." is "Porter Jr.", never just "Jr." (playtest 2026-10-23)
  if (w.length > 2 && /^(Jr\.?|Sr\.?|II|III|IV)$/i.test(w[w.length - 1])) return w.slice(-2).join(' ');
  return w[w.length - 1];
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
/**
 * A results card for one starter (2026-10-22, playtest: "mini wygląda tak samo jak all-time, po
 * prostu jest krótszy"): band with team and slot, face, name, years and caps; the line under it is
 * the mode's (All-Time: who comes in for him; Mini: what he does).
 */
/** A bench player's line on a results card: surname, his window (short), minutes (2026-10-29, the
 * user: "nie widzę lat w rotacji"). */
export function BenchRow({ span, minutes }: { span: PlayerSpan; minutes: number }) {
  return (
    <span className="bn-row">
      <span className="bn-f">
        <NFace name={span.playerName} />
      </span>
      <i>
        {lastName(maskText(span.playerName))} <em className="bn-y">{shortYears(maskYears(span.playerName, span.spanLabel))}</em>
      </i>
      <b>{Math.round(minutes)}m</b>
    </span>
  );
}
const shortYears = (label: string) => label.replace(/^(\d\d)(\d\d)-(\d\d)$/, '$2-$3');

/**
 * 2026-10-29 (the user, on the results roster on a phone: five narrow cards with truncated bench
 * names): the roster as a list — a row a slot, split in half: the starter (face, name, years,
 * minutes) on the left, who comes in for him on the right in the same form, smaller when two share
 * the slot; the starter's team colour is the row's edge.
 */
export function RosterList({ rows, compact }: { rows: { slot: string; starter?: { span: PlayerSpan; minutes: number }; bench: { span: PlayerSpan; minutes: number }[] }[]; compact?: boolean }) {
  // 2026-10-29 (the user: a rival's roster inside the standings "looks squeezed"; option b): a rival
  // reads as one line a slot — small face, surname, years and minutes, his bench as text after it.
  if (compact)
    return (
      <div className="rlist compact">
        {rows.map(({ slot, starter, bench }) => (
          <div key={slot} className="rc-row" style={starter ? bandStyle(starter.span) : undefined}>
            <span className="rl-slot">{slot}</span>
            {starter ? (
              <>
                <span className="rl-face">
                  <NFace name={starter.span.playerName} span={starter.span} />
                </span>
                <span className="rc-main">
                  <b>{maskName(starter.span.playerName)}</b> <em>{shortYears(maskYears(starter.span.playerName, starter.span.spanLabel))}</em> {Math.round(starter.minutes)}m
                </span>
                <span className="rc-bench">
                  {bench.map((b) => (
                    // Full name and years (the user: surnames repeat across the league's history — which Hill?); a face on desktop.
                    <span key={b.span.id} className="rc-sub">
                      <span className="rl-face rc-bf">
                        <NFace name={b.span.playerName} span={b.span} />
                      </span>
                      <span className="rc-bt">
                        <span className="rc-bn">{maskName(b.span.playerName)}</span> <em>{shortYears(maskYears(b.span.playerName, b.span.spanLabel))}</em> {Math.round(b.minutes)}m
                      </span>
                    </span>
                  ))}
                </span>
              </>
            ) : (
              <span className="rl-none">empty</span>
            )}
          </div>
        ))}
      </div>
    );
  return (
    <div className="rlist">
      {rows.map(({ slot, starter, bench }) => (
        <div key={slot} className="rl-row" style={starter ? bandStyle(starter.span) : undefined}>
          <span className="rl-slot">{slot}</span>
          {starter ? (
            <>
              <span className="rl-sub rl-start">
                <span className="rl-face">
                  <NFace name={starter.span.playerName} span={starter.span} />
                </span>
                <span className="rl-main">
                  <b>{shortName(starter.span.playerName)}</b>
                  <span>
                    {maskYears(starter.span.playerName, starter.span.spanLabel)} · {Math.round(starter.minutes)}m
                  </span>
                </span>
              </span>
              <span className={cx('rl-bench', bench.length > 1 && 'many')}>
                {bench.length ? (
                  bench.map((b) => (
                    <span key={b.span.id} className="rl-sub">
                      <span className="rl-face">
                        <NFace name={b.span.playerName} span={b.span} />
                      </span>
                      <span className="rl-main">
                        <b>{shortName(b.span.playerName)}</b>
                        <span>
                          {maskYears(b.span.playerName, b.span.spanLabel)} · {Math.round(b.minutes)}m
                        </span>
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="rl-none">no one else here</span>
                )}
              </span>
            </>
          ) : (
            <span className="rl-none">empty</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function RosterCard({ span, slot, extra, foot }: { span: PlayerSpan; slot: string; extra?: ReactNode; foot: ReactNode }) {
  return (
    <div className="card" style={bandStyle(span)}>
      <div className="top">
        <span>{spanBand(span).code}</span>
        <span>{slot}</span>
      </div>
      <div className="pic">
        <NFace name={span.playerName} span={span} />
      </div>
      <div className="nm">{shortName(span.playerName)}</div>
      <div className="sb">
        <span className="sb-yc">
          <span className="sb-yr">{maskYears(span.playerName, span.spanLabel)}</span>
          <span className="sb-cp">
            {' · '}
            <CapI />
            {fmtCaps(span.fga)}
          </span>
        </span>
        {extra}
      </div>
      <div className="roles" style={{ paddingBottom: 10 }}>
        {foot}
      </div>
    </div>
  );
}

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
        <div className="nm">
          <span className="sl-l">{shortName(span.playerName)}</span>
          <span className="sl-s">{lastName(span.playerName)}</span>
        </div>
        <div className="sb">
          <span className="sb-y">{maskYears(span.playerName, span.spanLabel)}</span>
          <span className="sb-sep"> · </span>
          <span className="sb-c">
            <CapI />
            {fmtCaps(span.fga)}
          </span>
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
/** A stable small number from a string (the room's reply / like counts and post ages). */
function seeded(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}
const countLabel = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));
const handleOf = (name: string) => `@${name.toLowerCase().replace(/[^a-z]+/g, '')}`;
/** 2026-10-29 (the user: "the room looks uninviting — drop the odd asides, make it a discussion
 * straight off X"): stage cues (*nods*) are dropped, the tag line goes, and each voice is a post —
 * avatar, name, handle, age, text, reply / repost / like counts; a reply hangs off the post above. */
const withoutCues = (text: string) =>
  text.replace(/\*[^*]+\*/g, ' ').replace(/\s+([.,!?…])/g, '$1').replace(/\s{2,}/g, ' ').trim();

export function NightVoices({ voices, cast, fold }: { voices: { who: string; kind: string; text: string; reply?: boolean }[]; cast: Record<string, { name: string; mono?: string; hue?: number }>; fold?: number }) {
  // 2026-10-22 (playtest): a long room ran far past the column beside it; the first few voices show,
  // the rest open on request (never cutting a reply off from what it answers).
  const [open, setOpen] = useState(false);
  const posts = voices.map((v) => ({ ...v, text: withoutCues(maskText(v.text)) })).filter((v) => v.text);
  let cut = posts.length;
  if (fold && !open && posts.length > fold + 1) {
    cut = fold;
    while (cut < posts.length && posts[cut].reply) cut += 1;
  }
  const rest = posts.length - cut;
  return (
    <div className="xfeed">
      {posts.slice(0, cut).map((v, i) => {
        const x = cast[v.who];
        const name = x?.name ?? v.who;
        const next = posts[i + 1];
        const likes = Math.round(4 + 1800 * seeded(v.text, 1) ** 3);
        return (
          <article key={i} className={cx('xpost', v.reply && 'reply', next?.reply && i + 1 < cut && 'thread')}>
            <span className="xav" style={{ background: `hsl(${x?.hue ?? 210} 42% 36%)` }} aria-hidden="true">
              {x?.mono ?? name.slice(0, 2).toUpperCase()}
            </span>
            <div className="xbody">
              <div className="xhead">
                <b>{name}</b>
                <span>
                  {handleOf(name)} · {1 + Math.floor(58 * seeded(v.text, 2))}m
                </span>
              </div>
              <p>{v.text}</p>
              <div className="xact" aria-hidden="true">
                <span>💬 {countLabel(Math.round(likes * (0.05 + 0.1 * seeded(v.text, 3))))}</span>
                <span>⟲ {countLabel(Math.round(likes * (0.08 + 0.2 * seeded(v.text, 4))))}</span>
                {/* A post praising the roster is one you liked (the user, 2026-10-29). */}
                <span className={v.kind === 'praise' ? 'liked' : undefined}>{v.kind === 'praise' ? '♥' : '♡'} {countLabel(likes + (v.kind === 'praise' ? 1 : 0))}</span>
              </div>
            </div>
          </article>
        );
      })}
      {rest > 0 && (
        <button type="button" className="lk-inline voices-more" onClick={() => setOpen(true)}>
          Show {rest} more {rest === 1 ? 'post' : 'posts'} ▾
        </button>
      )}
    </div>
  );
}
