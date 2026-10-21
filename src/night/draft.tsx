import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import type { Team } from '../engine/types';
import { franchiseByName } from '../data/franchises';
import { teamHue } from '../components/teamLogoKit';
import { teamLabel } from '../engine/teamNames';
import { naturalPosition } from '../engine/naturalPosition';
import { hadThreePointLine, NOT_YET } from '../components/eraNotes';
import { cardRoles } from '../components/cardRoles';
import { maskName, maskYears } from '../components/bombMask';
import { createLotteryDrum, drumHeight, type LotteryDrum } from '../components/lotteryDrum';
import { ordinal } from '../components/dailyDraftProgress';
import { bandInk } from './color';
import { Actions, Btn, CapI, H3, Kv, Mast, NFace, NightGame, Prompt, SLOTS, Slot, Tally, fmtCaps, shortName, type NavLinks } from './ui';

/**
 * The draft pieces the Mini and the All-Time Draft share (mockups `mini.html`, `alltime.html`,
 * `draft.css`): league team marks, the lottery, position tabs, the caps bar, the player table, the
 * draft board, the ticker of CPU picks and a printed notice.
 */

/** A league franchise's swatch colours: its logo's field and accent; names outside the pool get
 * the old hash hue. */
export function leagueColors(name: string): { bg: string; fg: string } {
  const f = franchiseByName(name);
  if (f) return { bg: f.logo.field, fg: f.logo.accent };
  return { bg: `hsl(${teamHue(name)} 45% 32%)`, fg: '#FFFFFF' };
}

/** A league team's printed mark (`.tm`): dark ink on light colours (AUDIT.md item 2). */
export function LeagueMark({ name, code, lg }: { name: string; code: string; lg?: boolean }) {
  const { bg, fg } = leagueColors(name);
  const ink = bg.startsWith('#') ? bandInk(bg, fg) : fg;
  return (
    <span className={`tm${lg ? ' lg' : ''}`} style={{ background: bg, color: ink }} title={name}>
      {code}
    </span>
  );
}

/** Overall pick numbers (1-based) a team in `slot` makes in a snake draft. */
export function snakePicks(slot: number, teamCount: number, rounds: number): number[] {
  return Array.from({ length: rounds }, (_, r) => r * teamCount + (r % 2 === 0 ? slot - 1 : teamCount - slot) + 1);
}

/* ------------------------------ the lottery ------------------------------ */

/**
 * The draft lottery (mockup `mini.html#lottery`): the drum spins (2026-09-28, the user's
 * "klasyczne kulki"), then the stage shows your pick on a cream ball, the picks it means in a snake
 * draft and the whole draft order with your row in reverse.
 */
export function NightLottery({
  teams,
  rounds,
  title,
  sub,
  codeOf,
  capLimit,
  howItWorks,
  onDone,
  onRevealed,
  links,
}: {
  teams: Team[];
  rounds: number;
  title: string;
  sub: string;
  codeOf: (t: Team) => string;
  capLimit: number;
  howItWorks: [string, ReactNode][];
  onDone: () => void;
  onRevealed?: () => void;
  links: NavLinks;
}) {
  const human = teams.find((t) => t.isHuman) ?? teams[0];
  const teamCount = teams.length;
  const slot = human.draftSlot;
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState('Your ball is the red one.');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drumRef = useRef<LotteryDrum | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drum = createLotteryDrum(canvas, {
      slot,
      teamCount,
      onStatus: (text) => setStatus(text),
      onLanded: () => {
        setStarted(true);
        setDone(true);
      },
    });
    drumRef.current = drum;
    return () => {
      drum.destroy();
      drumRef.current = null;
    };
  }, [slot, teamCount]);
  useEffect(() => {
    if (!done || !onRevealed) return;
    const id = window.setTimeout(onRevealed, 250);
    return () => window.clearTimeout(id);
  }, [done, onRevealed]);
  const picks = useMemo(() => snakePicks(slot, teamCount, rounds), [slot, teamCount, rounds]);
  const gaps = picks.slice(1).map((p, i) => p - picks[i] - 1);
  const order = [...teams].sort((a, b) => a.draftSlot - b.draftSlot);
  const half = Math.ceil(order.length / 2);
  // Two columns read down: 1–8 on the left, 9–16 on the right.
  const columns = [order.slice(0, half), order.slice(half)];
  return (
    <NightGame
      aside={
        <>
          <Mast title={title} sub={sub} />
          <Tally you={fmtCaps(capLimit)} mid={teamCount} ai={rounds} youK="Cap" midK="Teams" aiK="Rounds" plain />
          <section>
            <H3>How it works</H3>
            {howItWorks.map(([k, v]) => (
              <Kv key={k} k={k} v={v} />
            ))}
          </section>
          <Actions links={links}>
            {done ? (
              <Btn onClick={onDone}>Start the draft</Btn>
            ) : !started ? (
              <Btn
                onClick={() => {
                  setStarted(true);
                  drumRef.current?.start();
                }}
              >
                Draw the lottery
              </Btn>
            ) : (
              <Btn kind="line" onClick={() => drumRef.current?.finish()}>
                Skip
              </Btn>
            )}
          </Actions>
        </>
      }
    >
      <Prompt eb="Draft lottery" title={done ? `You pick ${ordinal(slot)}` : started ? 'The balls are out' : 'The lottery'}>
        {done ? (
          <>
            {teamLabel(human)}. In a snake draft that’s picks <b className="w">{picks.join(' · ')}</b>.
          </>
        ) : (
          status
        )}
      </Prompt>
      <canvas
        ref={canvasRef}
        className={`drum${done ? ' is-done' : ''}`}
        width={800}
        height={drumHeight(teamCount) * 2}
        aria-label={`Lottery drum: ${teamCount} team balls, yours in red`}
      />
      {done && (
        <div className="lot">
          <div>
            <div className="ball">
              <div>
                <b>{slot}</b>
                <span>your pick</span>
              </div>
            </div>
            {gaps.length > 0 && (
              <p className="lot-note">
                Between your picks:{' '}
                {gaps.map((g, i) => (
                  <span key={i}>
                    {i > 0 && (i === gaps.length - 1 ? ' and ' : ', ')}
                    <b>{g}</b>
                  </span>
                ))}{' '}
                picks by the CPU teams.
              </p>
            )}
          </div>
          <section>
            <H3 note="round 1 · reverses each round">Draft order</H3>
            <div className="order16-cols">
              {columns.map((col, c) => (
                <ol key={c} className="order16 one">
                  {col.map((t) => (
                    <li key={t.id} className={t.isHuman ? 'you' : undefined}>
                      <span className="n">{t.draftSlot}</span>
                      <LeagueMark name={t.name} code={codeOf(t)} />
                      <b>{teamLabel(t)}</b>
                    </li>
                  ))}
                </ol>
              ))}
            </div>
          </section>
        </div>
      )}
      {done ? (
        <Btn className="phone-only" onClick={onDone}>
          Start the draft
        </Btn>
      ) : !started ? (
        <Btn
          className="phone-only"
          onClick={() => {
            setStarted(true);
            drumRef.current?.start();
          }}
        >
          Draw the lottery
        </Btn>
      ) : (
        <Btn kind="line" className="phone-only" onClick={() => drumRef.current?.finish()}>
          Skip
        </Btn>
      )}
    </NightGame>
  );
}

/* ------------------------------ filters ------------------------------ */

/** Position tabs with counts (mockup `mini.html#posTabs`), tied to your five: a set position reads
 * "set" and is faded, an open one is bright. */
export function PosTabs({
  counts,
  have,
  on,
  onPick,
  search,
  onSearch,
  extra,
}: {
  counts: Record<Position, number>;
  have: Set<Position>;
  on: Position | 'ALL';
  onPick: (p: Position | 'ALL') => void;
  search: string;
  onSearch: (v: string) => void;
  extra?: ReactNode;
}) {
  const all = SLOTS.reduce((s, p) => s + counts[p], 0);
  return (
    <div className="ptabs" role="tablist" aria-label="Position">
      <button type="button" role="tab" aria-selected={on === 'ALL'} className={`pt${on === 'ALL' ? ' on' : ''}`} onClick={() => onPick('ALL')}>
        <b>All</b>
        <span>{all.toLocaleString('en-US')}</span>
      </button>
      {SLOTS.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={on === p}
          className={`pt${on === p ? ' on' : ''} ${have.has(p) ? 'have' : 'need'}`}
          onClick={() => onPick(p)}
        >
          <b>{p}</b>
          <span>{have.has(p) && on !== p ? 'set' : counts[p].toLocaleString('en-US')}</span>
        </button>
      ))}
      {extra}
      <input className="search" placeholder="Search players…" value={search} onChange={(e) => onSearch(e.target.value)} aria-label="Search players" />
    </div>
  );
}

/** The caps range (mockup `mini.html#pickCaps`): two handles 0–top, the red "your max" line and
 * the value. */
export function CapsBar({ lo, hi, top, maxPick, onChange }: { lo: number; hi: number; top: number; maxPick: number | null; onChange: (lo: number, hi: number) => void }) {
  const pct = (v: number) => `${(Math.max(0, Math.min(top, v)) / top) * 100}%`;
  const ticks = [0, 5, 10, 15, 20, 25, 30, 35, 40].filter((t) => t <= top);
  const any = lo <= 0 && hi >= top;
  return (
    <div className="capsbar">
      <span className="cb-k">Caps</span>
      <div className="cb-track">
        <i className="cb-range" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
        <b className="cb-h" style={{ left: pct(lo) }} />
        <b className="cb-h" style={{ left: pct(hi) }} />
        {maxPick !== null && maxPick < top && (
          <u className="cb-max" style={{ left: pct(maxPick) }}>
            <em>your max {fmtCaps(maxPick)}</em>
          </u>
        )}
        {ticks.map((t) => (
          <s key={t} style={{ left: pct(t) }}>
            {t}
          </s>
        ))}
        <input className="cb-in" type="range" min={0} max={top} step={1} value={lo} aria-label="Lowest caps" onChange={(e) => onChange(Math.min(Number(e.target.value), hi), hi)} />
        <input className="cb-in" type="range" min={0} max={top} step={1} value={hi} aria-label="Highest caps" onChange={(e) => onChange(lo, Math.max(Number(e.target.value), lo))} />
      </div>
      <span className="cb-v">
        <CapI />
        {any ? 'any' : `${lo}–${hi}`}
      </span>
      <button type="button" className="cb-reset" onClick={() => onChange(0, top)} disabled={any}>
        reset
      </button>
    </div>
  );
}

/** A printed notice: the red mark for a problem, one sentence, one action. */
export function Notice({ children, action, onAction }: { children: ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="notice">
      <i>!</i>
      <p>{children}</p>
      {action && (
        <button type="button" className="na" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

/* ------------------------------ the player table ------------------------------ */

export interface NightRow {
  key: string;
  span: PlayerSpan;
  tier: string;
  legal: boolean;
  hot?: boolean;
  title?: string;
  /** A daily rule's tag ("Lakers · not today"). */
  ruleNote?: string;
  /** "taken #33" while a just-taken player keeps his place. */
  taken?: string;
  starred?: boolean;
  /** Scouted grades (All-Time): OFF / DEF / 3PT. */
  grades?: { off: string; def: string; tp: string };
  /** His other stretches, for the years button (All-Time). */
  spans?: number;
}

const TOP_TIERS = new Set(['GOAT', 'Greatest peak', 'MVP']);

/**
 * The player list (mockups `mini.html#pick` `plist`, `alltime.html#draft` `plist2`): fixed columns,
 * one number per cell. Mini: tier, pts, reb, ast, 3PA, caps, Draft. All-Time adds the years, the
 * scouting report and the Big Board star.
 */
export function PlayerTable({
  rows,
  variant,
  onDraft,
  onOpen,
  onYears,
  onStar,
  scoutsLeft = 0,
}: {
  rows: NightRow[];
  variant: 'mini' | 'alltime';
  onDraft: (span: PlayerSpan) => void;
  onOpen?: (playerName: string) => void;
  onYears?: (playerName: string) => void;
  onStar?: (playerName: string) => void;
  scoutsLeft?: number;
}) {
  const at = variant === 'alltime';
  return (
    <table className="plist">
      <colgroup>
        <col style={{ width: 52 }} />
        <col />
        {at && <col className="c-hide" style={{ width: 96 }} />}
        <col className="c-hide" style={{ width: 118 }} />
        <col className="c-hide" style={{ width: 58 }} />
        <col className="c-hide" style={{ width: 58 }} />
        <col className="c-hide" style={{ width: 58 }} />
        {!at && <col className="c-hide" style={{ width: 58 }} />}
        <col style={{ width: 84 }} />
        {at && <col className="c-hide" style={{ width: 84 }} />}
        {at && <col className="c-hide" style={{ width: 34 }} />}
        <col style={{ width: 96 }} />
      </colgroup>
      <thead>
        <tr>
          <th />
          <th>Player</th>
          {at && <th className="c-hide">Years</th>}
          <th className="c-hide">Tier</th>
          <th className="num c-hide">Pts</th>
          <th className="num c-hide">Reb</th>
          <th className="num c-hide">Ast</th>
          {!at && <th className="num c-hide">3PA</th>}
          <th className="num">Caps</th>
          {at && (
            <th className="c-hide" style={{ textAlign: 'center' }}>
              Report
            </th>
          )}
          {at && <th className="c-hide" />}
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const s = r.span;
          const roles = cardRoles(s);
          const name = maskName(s.playerName);
          return (
            <tr key={r.key} className={[r.hot && r.legal ? 'hot' : '', !r.legal ? 'no' : '', r.taken ? 'taken' : ''].filter(Boolean).join(' ') || undefined} title={r.title}>
              <td className="f">
                <NFace name={s.playerName} />
              </td>
              <td>
                {onOpen ? (
                  <button type="button" className="nm nm-btn" onClick={() => onOpen(s.playerName)} title="Open his scouting window">
                    {name}
                  </button>
                ) : (
                  <div className="nm">{name}</div>
                )}
                <div className="mt">
                  <b>
                    {naturalPosition(s.playerName)}
                    {!at && ` · ${maskYears(s.playerName, s.spanLabel)}`}
                  </b>{' '}
                  {r.ruleNote ? <i className="rule-tag">· {r.ruleNote}</i> : r.taken ? <i className="rule-tag">· {r.taken}</i> : roles.length > 0 && <i>· {roles.join(' · ')}</i>}
                  <span className="mst">
                    {at && (
                      <>
                        {maskYears(s.playerName, s.spanLabel)}
                        <br />
                      </>
                    )}
                    {s.box.ppg.toFixed(1)} / {s.box.rpg.toFixed(1)} / {s.box.apg.toFixed(1)}
                  </span>
                </div>
              </td>
              {at && (
                <td className="yrs c-hide">
                  {onYears && (r.spans ?? 0) > 1 ? (
                    <button type="button" className="yrs-btn" onClick={() => onYears(s.playerName)}>
                      {maskYears(s.playerName, s.spanLabel)}
                      <small>▾</small>
                    </button>
                  ) : (
                    <span className="yrs-plain">{maskYears(s.playerName, s.spanLabel)}</span>
                  )}
                </td>
              )}
              <td className={`tier c-hide${TOP_TIERS.has(r.tier) ? ' top' : ''}`}>{r.tier}</td>
              <td className="num c-hide">{s.box.ppg.toFixed(1)}</td>
              <td className="num c-hide">{s.box.rpg.toFixed(1)}</td>
              <td className="num c-hide">{s.box.apg.toFixed(1)}</td>
              {!at && <td className="num c-hide">{hadThreePointLine(s) ? s.box.threePA.toFixed(1) : NOT_YET}</td>}
              <td className="cap num">{fmtCaps(s.fga)}</td>
              {at && (
                <td className="c c-hide">
                  {r.grades ? (
                    <span className="grades">
                      {r.grades.off} · {r.grades.def} · {r.grades.tp}
                    </span>
                  ) : onOpen ? (
                    <button type="button" className="scout" onClick={() => onOpen(s.playerName)} disabled={scoutsLeft <= 0}>
                      Scout
                    </button>
                  ) : null}
                </td>
              )}
              {at && (
                <td className="c c-hide">
                  {onStar && !r.taken && (
                    <button
                      type="button"
                      className={`star${r.starred ? ' on' : ''}`}
                      aria-pressed={!!r.starred}
                      aria-label={r.starred ? `Remove ${name} from your Big Board` : `Add ${name} to your Big Board`}
                      onClick={() => onStar(s.playerName)}
                    >
                      ★
                    </button>
                  )}
                </td>
              )}
              <td className="act">
                {!r.taken && (
                  <button type="button" className="draft" disabled={!r.legal} onClick={() => onDraft(s)} aria-label={`Draft ${name}`}>
                    Draft
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ------------------------------ the board and the ticker ------------------------------ */

export interface BoardPick {
  pickNumber: number;
  teamId: string;
  span: PlayerSpan;
}

/** The draft board (mockup `mini.html#board`): one row per team in draft order, one column per
 * round, your row in reverse, "on the clock" in red. */
export function DraftBoardTable({ teams, rounds, picks, onClockTeamId, codeOf, wide }: { teams: Team[]; rounds: number; picks: BoardPick[]; onClockTeamId?: string; codeOf: (t: Team) => string; wide?: boolean }) {
  const order = [...teams].sort((a, b) => a.draftSlot - b.draftSlot);
  const byTeam = new Map<string, PlayerSpan[]>();
  for (const p of [...picks].sort((a, b) => a.pickNumber - b.pickNumber)) byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), p.span]);
  return (
    <div className="dboard-wrap">
      <table className={`dboard${wide ? ' dboard9' : ''}`}>
        <thead>
          <tr>
            <th>Team</th>
            {Array.from({ length: rounds }, (_, r) => (
              <th key={r}>{wide ? `R${r + 1}` : `Round ${r + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((t) => {
            const got = byTeam.get(t.id) ?? [];
            return (
              <tr key={t.id} className={t.isHuman ? 'you' : undefined}>
                <td className="tn">
                  <LeagueMark name={t.name} code={codeOf(t)} />
                  <span className="nk">{teamLabel(t).split(' ').slice(-1)[0]}</span>
                </td>
                {Array.from({ length: rounds }, (_, r) => {
                  const p = got[r];
                  if (p)
                    return (
                      <td key={r} title={`${maskName(p.playerName)} ${maskYears(p.playerName, p.spanLabel)}`}>
                        {shortName(p.playerName)}
                        <small>{p.primaryPosition}</small>
                      </td>
                    );
                  if (r === got.length && t.id === onClockTeamId)
                    return (
                      <td key={r} className="clk">
                        on the clock
                      </td>
                    );
                  return (
                    <td key={r} className="e">
                      —
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export interface TickerRow {
  n: number;
  team: Team;
  code: string;
  span: PlayerSpan;
}

/** The CPU picks as they come (mockup `mini.html#wait`): newest last, your rows in reverse, the
 * team on the clock in red. */
export function Ticker({ rows, now }: { rows: TickerRow[]; now?: { n: number; team: Team; code: string } | null }) {
  return (
    <ul className="ticker">
      {rows.map((r) => (
        <li key={r.n} className={r.team.isHuman ? 'you' : undefined}>
          <span className="n">{r.n}</span>
          <LeagueMark name={r.team.name} code={r.code} />
          <span>
            <b>{maskName(r.span.playerName)}</b>
          </span>
          <span className="ps">{r.span.primaryPosition}</span>
          <span className="c">{fmtCaps(r.span.fga)}</span>
        </li>
      ))}
      {now && (
        <li className="now">
          <span className="n">{now.n}</span>
          <LeagueMark name={now.team.name} code={now.code} />
          <span>
            <i>on the clock…</i>
          </span>
          <span />
          <span />
        </li>
      )}
    </ul>
  );
}

/** The aside's log of the latest picks around the league (`.log` with team codes). */
export function PickLog({ rows, title = 'The draft so far', note, newestFirst }: { rows: TickerRow[]; title?: string; note?: string; newestFirst?: boolean }) {
  const shown = newestFirst ? [...rows].reverse() : rows;
  return (
    <section className={newestFirst ? 'latest-picks' : undefined}>
      <H3 note={note}>{title}</H3>
      <table className="log">
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.n} className={`${r.team.isHuman ? 'y' : 'a'}${(newestFirst ? i === 0 : i === shown.length - 1) ? ' latest' : ''}`}>
              <td className="n">{r.n}</td>
              <td className="w">{r.code}</td>
              <td className="p">
                {maskName(r.span.playerName)}, {r.span.primaryPosition}
              </td>
              <td className="c">{fmtCaps(r.span.fga)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Your five as slots: filled cards by position, open ones; `sel` marks the open slot the list
 * shows (tap one to filter). */
export function FiveSlots({
  title = 'Your five',
  note,
  lineup,
  sel,
  onSlot,
  compact = true,
  emptyLabel,
}: {
  title?: string;
  note?: ReactNode;
  lineup: Partial<Record<Position, PlayerSpan>>;
  sel?: Position | null;
  onSlot?: (p: Position) => void;
  compact?: boolean;
  emptyLabel?: (p: Position) => ReactNode;
}) {
  return (
    <section>
      <H3 note={note}>{title}</H3>
      <div className={`slots${compact ? ' compact' : ''}`}>
        {SLOTS.map((p) => {
          const s = lineup[p];
          if (s)
            return <Slot key={p} pos={p} span={s} />;
          return (
            <button key={p} type="button" className={`slot empty${sel === p ? ' sel' : ''}`} onClick={onSlot ? () => onSlot(p) : undefined} disabled={!onSlot}>
              {p}
              <small>{emptyLabel ? emptyLabel(p) : 'open'}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
