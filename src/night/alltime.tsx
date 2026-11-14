import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import type { Team } from '../engine/types';
import { teamLabel } from '../engine/teamNames';
import { teamsForSpan } from '../engine/spanTeams';
import { maskName, maskYears } from '../components/bombMask';
import { LeagueMark, snakePicks } from './league';
import { CapI, H3, NFace, SLOTS, Slot, TagChips, fmtCaps, gradeTone, shortName, spanBand } from './ui';

/**
 * The All-Time Draft's own pieces (mockup `alltime.html`): the full draft board as a grid of
 * faces, your nine (five slots and the bench) and the table of a player's stretches.
 */

/* ------------------------------ the board ------------------------------ */

// 2026-11-13, the playtest ("płynny scroll zamiast przełącznika 1–4 / 5–9"): every round in one
// window that scrolls, kept on the round being drafted.
const WINDOWS: Array<[number, number]> = [[0, 9]];

/** The draft board (mockup `#board`): the sixteen teams across in draft order, four rounds at a
 * time, a face in every pick made, the pick on the clock in red, your column marked. */
export function BoardGrid({
  teams,
  rounds,
  picks,
  onClock,
  round,
  codeOf,
  onHide,
  windows = WINDOWS,
  gmOf,
}: {
  /** Multiplayer: the player running a team (by its draft slot), shown over its column. */
  gmOf?: (t: Team) => string | undefined;
  teams: Team[];
  rounds: number;
  /** Round windows the board pages between; one window (the Mini's five rounds) shows no toggle. */
  windows?: Array<[number, number]>;
  /** pick number (1-based) → the span taken there. */
  picks: Map<number, PlayerSpan>;
  /** The pick on the clock, or null once the draft is done. */
  onClock: number | null;
  round: number;
  codeOf: (t: Team) => string;
  onHide?: () => void;
}) {
  const order = [...teams].sort((a, b) => a.draftSlot - b.draftSlot);
  const auto = windows.findIndex(([a, b]) => round >= a && round < b);
  const [win, setWin] = useState<number | null>(null);
  const w = Math.min(win ?? Math.max(0, auto), windows.length - 1);
  const [from, to] = windows[w];
  const other = windows.length > 1 ? windows[1 - w] : null;
  const cols = { '--cols': order.length } as CSSProperties;
  const rowsRef = useRef<HTMLDivElement>(null);
  // The round on the clock slides into view (one round above it stays in sight).
  useEffect(() => {
    const box = rowsRef.current;
    const row = box?.querySelector<HTMLElement>(`[data-r="${Math.max(0, round - 1)}"]`);
    if (box && row) box.scrollTo({ top: row.offsetTop - box.offsetTop, behavior: 'smooth' });
  }, [round]);
  return (
    <section className="bgrid">
      <h3>
        Draft board
        <span>
          rounds {from + 1}–{Math.min(to, rounds)}
          {other && (
            <>
              {' · '}
              <button type="button" className="lk-inline" onClick={() => setWin(1 - w)}>
                rounds {other[0] + 1}–{Math.min(other[1], rounds)} ▾
              </button>
            </>
          )}
          {onHide && (
            <>
              {' · '}
              <button type="button" className="lk-inline" onClick={onHide}>
                hide board
              </button>
            </>
          )}
        </span>
      </h3>
      <div className="bg-scroll">
        <div className="bg-row bg-head" style={cols}>
          <span className="bg-rl" />
          {order.map((t) => (
            <span key={t.id} className={`bg-team${t.isHuman ? ' you' : ''}${gmOf?.(t) && !t.isHuman ? ' gm' : ''}`}>
              <LeagueMark name={t.name} code={codeOf(t)} />
              <b>{t.isHuman ? 'You' : (gmOf?.(t) ?? teamLabel(t).split(' ')[0])}</b>
            </span>
          ))}
        </div>
        <div className="bg-rows" ref={rowsRef}>
        {Array.from({ length: Math.min(to, rounds) - from }, (_, k) => from + k).map((r) => (
          <div key={r} className="bg-row" style={cols} data-r={r}>
            <span className="bg-rl">
              R{r + 1}
              <i>{r % 2 ? '←' : '→'}</i>
            </span>
            {order.map((t) => {
              const n = snakePicks(t.draftSlot, order.length, rounds)[r];
              const s = picks.get(n);
              if (s)
                return (
                  <span key={t.id} className={`bg-cell filled${t.isHuman ? ' you' : ''}`} title={`#${n} · ${maskName(s.playerName)} ${maskYears(s.playerName, s.spanLabel)}`}>
                    <NFace name={s.playerName} span={s} />
                    <small>{s.primaryPosition}</small>
                    <b>{shortName(s.playerName).split(' ').slice(1).join(' ') || shortName(s.playerName)}</b>
                  </span>
                );
              if (n === onClock)
                return (
                  <span key={t.id} className="bg-cell clock">
                    <small>On the clock</small>
                    <b>#{n}</b>
                  </span>
                );
              return (
                <span key={t.id} className={`bg-cell empty${t.isHuman ? ' you' : ''}`}>
                  {n}
                </span>
              );
            })}
          </div>
        ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ your nine ------------------------------ */

/** Your nine (mockup `nine()`): five slots by position, then four bench spots. An open slot
 * shows the list for its position. */
export function NineSlots({
  lineup,
  bench,
  benchSlots,
  note,
  sel,
  onSlot,
  emptyLabel,
}: {
  lineup: Partial<Record<Position, PlayerSpan>>;
  bench: PlayerSpan[];
  benchSlots: number;
  note: ReactNode;
  sel?: Position | null;
  onSlot?: (p: Position) => void;
  emptyLabel?: (p: Position) => ReactNode;
}) {
  return (
    <section>
      <H3 note={note}>Your nine</H3>
      <div className="slots compact">
        {SLOTS.map((p) => {
          const s = lineup[p];
          if (s) return <Slot key={p} pos={p} span={s} />;
          return (
            <button key={p} type="button" className={`slot empty${sel === p ? ' sel' : ''}`} onClick={onSlot ? () => onSlot(p) : undefined} disabled={!onSlot}>
              {p}
              <small>{emptyLabel ? emptyLabel(p) : 'open'}</small>
            </button>
          );
        })}
      </div>
      <div className="bench">
        {Array.from({ length: benchSlots }, (_, i) => {
          const s = bench[i];
          if (!s)
            return (
              <div key={i} className="b empty">
                Bench {i + 1}
              </div>
            );
          const band = spanBand(s);
          return (
            <div key={i} className="b filled" style={{ '--team': band.color } as CSSProperties} title={maskName(s.playerName)}>
              <NFace name={s.playerName} span={s} />
              <div>
                <b>{shortName(s.playerName)}</b>
                <span className="bn-l">
                  <i className="bn-p">{s.primaryPosition}</i>
                  <i className="bn-sep"> · </i>
                  <i className="bn-y">{maskYears(s.playerName, s.spanLabel)}</i>
                  <i className="bn-sep"> · </i>
                  <i className="bn-c">
                    <CapI />
                    {fmtCaps(s.fga)}
                  </i>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------ a player's stretches ------------------------------ */

export interface StretchRow {
  span: PlayerSpan;
  tier: string;
  /** "A · B+ · C · B · A-" (OFF · DEF · SHT · PLY · REB) once scouted, else null. */
  grades: string | null;
  peak: boolean;
  /** The years he plays for you now (the Team view). */
  current?: boolean;
  action: { label: string; disabled: boolean; title?: string; onClick: () => void } | null;
}

const TOP_TIERS = new Set(['GOAT', 'Legend', 'MVP']);

/** His stretches (mockup `#years`): years, team, tier, the line, the grades once scouted, the
 * caps and a button. */
export function StretchTable({ rows }: { rows: StretchRow[] }) {
  return (
    <div className="spans-wrap">
      {/* 2026-11-12 (the user: "zrób tą tabelkę tak, żeby wszystko było tam równo"): fixed widths,
          so every row's columns line up whatever the years, team or tier say */}
      <table className="plist spans">
        <colgroup>
          <col className="w-y" />
          <col className="w-t c-hide" />
          <col className="w-r c-hide" />
          <col className="w-n" />
          <col className="w-g c-hide" />
          <col className="w-c" />
          <col className="w-a" />
        </colgroup>
        <thead>
          <tr>
            <th>Years</th>
            <th className="c-hide">Team</th>
            <th className="c-hide">Tier</th>
            {/* 2026-11-11 (the user: "brzydko to wygląda"): fixed columns, not one dotted string */}
            <th className="r">
              <span className="cols n3"><span>Pts</span><span>Reb</span><span>Ast</span></span>
            </th>
            <th className="g c-hide">
              <span className="cols g5">
                <span title="Offense">Off</span>
                <span title="Defense">Def</span>
                <span title="Shooting: threes, and the midrange that spaces the floor">Sht</span>
                <span title="Playmaking">Ply</span>
                <span title="Rebounding">Reb</span>
              </span>
            </th>
            <th className="r">Caps</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.span.id} className={[r.peak ? 'peak' : '', r.current ? 'pick' : ''].filter(Boolean).join(' ') || undefined}>
              <td className="y">
                {maskYears(r.span.playerName, r.span.spanLabel)}
                {r.current ? <small>plays for you now</small> : r.peak && <small>his best years</small>}
                <TagChips span={r.span} />
              </td>
              <td className="n c-hide">
                {teamsForSpan(r.span)
                  .map((t) => t.code)
                  .join(' · ')}
              </td>
              <td className={`tier c-hide${TOP_TIERS.has(r.tier) ? ' top' : ''}`}>{r.tier}</td>
              <td className="n r">
                <span className="cols n3">
                  <span>{r.span.box.ppg.toFixed(1)}</span>
                  <span>{r.span.box.rpg.toFixed(1)}</span>
                  <span>{r.span.box.apg.toFixed(1)}</span>
                </span>
              </td>
              <td className="n g c-hide">
                {/* one letter a column; before a scout, a dash in each ("–" until we press Scout) */}
                <span className={`cols g5${r.grades ? '' : ' unscouted'}`}>
                  {(r.grades ? r.grades.split(' · ') : ['–', '–', '–', '–', '–']).map((g, i) => (
                    <span key={i} className={r.grades ? gradeTone(g) : undefined}>
                      {g}
                    </span>
                  ))}
                </span>
              </td>
              <td className="cap r">{fmtCaps(r.span.fga)}</td>
              <td className="act r">
                {r.action && (
                  <button type="button" className="draft" disabled={r.action.disabled} title={r.action.title} onClick={r.action.onClick}>
                    {r.action.label}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
