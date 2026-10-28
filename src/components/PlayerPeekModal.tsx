import { computeFinishing } from '../engine/finishing';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { PlayerSpan } from '../data/schema';
import { isPickLegal, type DraftState } from '../engine/draft';
import { computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { computeSpacing } from '../engine/spacing';
import type { Team } from '../engine/types';
import { CapI, NFace, fmtCaps } from '../night/ui';
import { NOT_YET, STEALS_BLOCKS_NOTE, THREE_POINT_LINE_NOTE, hadStealsBlocksRecorded, hadThreePointLine } from './eraNotes';
import { teamsForSpan } from '../engine/spanTeams';
import { draftPool as fullDraftPool } from '../data/draftPool';
import { offensiveGrade, defensiveGrade, portabilityGrade, spacingGrade, durabilityGrade, finishingGrade, overallTierForSpan, type Grade } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { computeDurability } from '../engine/durability';
import { naturalPosition } from '../engine/naturalPosition';
import { spacingUngraded, type GradeKey } from './gradeHelp';
import { draftButtonTitle } from './DraftBoard';
import { spanAwards } from '../engine/spanAwards';

/** Every career window the database has for a player, including the ones this draft's lean pool
 * leaves out (a star keeps only his peak windows there). Built once, on first open. */
let fullCareerByPlayer: Map<string, PlayerSpan[]> | null = null;
function fullCareerFor(playerName: string): PlayerSpan[] {
  if (!fullCareerByPlayer) {
    fullCareerByPlayer = new Map();
    for (const span of fullDraftPool) {
      const list = fullCareerByPlayer.get(span.playerName);
      if (list) list.push(span);
      else fullCareerByPlayer.set(span.playerName, [span]);
    }
  }
  return fullCareerByPlayer.get(playerName) ?? [];
}

/** First and last calendar year of a "1996-98" stretch label. */
function spanYears(label: string): [number, number] {
  const start = Number.parseInt(label.slice(0, 4), 10);
  const tail = Number.parseInt(label.slice(5), 10);
  const end = Number.isFinite(tail) ? start - (start % 100) + tail + (tail < start % 100 ? 100 : 0) : start;
  return [start, end];
}

/** 2026-10-07: the windows overlap year by year (1999-01, 2000-02, …), so the list starts with
 * stretches that don't share a season with each other or with the card's own; "Show all" lists
 * the rest. */
function distinctStretches(rows: PlayerSpan[], cardSpan: PlayerSpan): PlayerSpan[] {
  const taken: Array<[number, number]> = [spanYears(cardSpan.spanLabel)];
  const out: PlayerSpan[] = [];
  for (const span of rows) {
    if (span.id === cardSpan.id) continue;
    const [start, end] = spanYears(span.spanLabel);
    if (taken.some(([s, e]) => start <= e && end >= s)) continue;
    taken.push([start, end]);
    out.push(span);
  }
  return out;
}

const pct = (v: number) => (v * 100).toFixed(1);

function gradeList(span: PlayerSpan): Array<[string, Grade, GradeKey]> {
  return [
    ['Offense', offensiveGrade(computeOffensiveTalent(span), computeUncappedOffensiveTalent(span)), 'OFF'],
    ['Defense', defensiveGrade(computeDefensiveTalent(span)), 'DEF'],
    ['Spacing', spacingGrade(computeSpacing(span), span), '3PT'],
    ['Portability', portabilityGrade(span), 'POR'],
    ['Finishing', finishingGrade(computeFinishing(span), span), 'FIN'],
    ['Durability', durabilityGrade(computeDurability(span)), 'DUR'],
  ];
}

/** The six grades as printed marks: an A in green, a C or lower in red (mockup `#peekScouted`).
 * 2026-10-28 (mockup `draft-grades-phone.html`): equal tiles, 3×2 on a phone and one row on a
 * desktop; before a scouting report the tiles show "?" so it is clear what the report opens. */
function Grades({ span, locked = false }: { span: PlayerSpan; locked?: boolean }) {
  return (
    <div className={`pk2-g6${locked ? ' lock' : ''}`}>
      {gradeList(span).map(([label, grade, key]) => {
        const shown = locked ? '?' : key === '3PT' && spacingUngraded(span) ? NOT_YET : grade;
        const tone = shown.startsWith('A') ? 'hi' : /^[CDF]/.test(shown) ? 'lo' : undefined;
        return (
          <span key={label} className="gr">
            <b className={tone}>{shown}</b>
            {label}
          </span>
        );
      })}
    </div>
  );
}

/** The real awards of a stretch — public record, so shown before any scouting report. */
function Awards({ span }: { span: PlayerSpan }) {
  const list = spanAwards(span.playerName, span.spanLabel);
  return list.length ? <span className="pk2-aw">{list.join(' · ')}</span> : null;
}

const tierOf = (span: PlayerSpan) => overallTierForSpan(tierContextFor(span));

/**
 * A player's scouting window. 2026-10-07, the UI simplification (approved mockup, the user: "tam
 * też jest wszystkiego dużo"): it used to be one table of every career window × 12 box columns,
 * plus 8 grade columns after a scouting report. Now the stretch the card drafts sits on top with
 * one Draft button; the other stretches are one line each (years, box line, cost, and the tier
 * once scouted) and open in place for the rest of the numbers and their own Draft button. Grades:
 * Offense, Defense, Spacing and Portability (one grade for O-POR and D-POR) on top, Finishing and
 * Durability behind "All grades". The
 * full career is still there behind "Show all".
 */
export function PlayerPeekModal({
  group,
  cardSpanId,
  state,
  canPick,
  currentTeam,
  onClose,
  onPick,
  scouted,
  scoutsLeft,
  onScout,
}: {
  group: { playerName: string; spans: PlayerSpan[]; spansByAiValue: PlayerSpan[] };
  /** The stretch the player's card drafts. */
  cardSpanId: string;
  /** Without a draft (the results, a mode's end): his card to read — no Draft or Scout buttons. */
  state?: DraftState;
  canPick: boolean;
  currentTeam?: Team;
  onClose: () => void;
  onPick?: (id: string) => void;
  scouted: boolean;
  scoutsLeft?: number;
  onScout?: () => void;
}) {
  const readOnly = !state || !currentTeam || !onPick;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const byId = new Map<string, PlayerSpan>();
    for (const span of fullCareerFor(group.playerName)) byId.set(span.id, span);
    for (const span of group.spans) byId.set(span.id, span);
    return [...byId.values()].sort((a, b) => a.spanLabel.localeCompare(b.spanLabel));
  }, [group.playerName, group.spans]);
  const cardSpan = rows.find((s) => s.id === cardSpanId) ?? group.spans[0];
  const shortList = useMemo(() => distinctStretches(rows, cardSpan), [rows, cardSpan]);
  const others = showAll ? rows.filter((s) => s.id !== cardSpan.id) : shortList;
  const hiddenCount = rows.length - 1 - shortList.length;
  const teamCodes = useMemo(() => [...new Set(rows.flatMap((s) => teamsForSpan(s).map((t) => t.code)))], [rows]);
  const careerYears = `${spanYears(rows[0].spanLabel)[0]}–${spanYears(rows[rows.length - 1].spanLabel)[1]}`;
  const legal = (span: PlayerSpan) => canPick && !!state && isPickLegal(state, span.id);

  const nums: Array<[string, string, string?]> = [
    [cardSpan.box.ppg.toFixed(1), 'PTS'],
    [cardSpan.box.rpg.toFixed(1), 'REB'],
    [cardSpan.box.apg.toFixed(1), 'AST'],
    [pct(cardSpan.box.fgPct), 'FG%'],
    [hadThreePointLine(cardSpan) ? pct(cardSpan.box.threePct) : NOT_YET, '3P%', hadThreePointLine(cardSpan) ? undefined : THREE_POINT_LINE_NOTE],
  ];

  return (
    <>
      <div className="drawer-dim" onClick={onClose} aria-hidden />
      <div className="modal" role="dialog" aria-modal="true" aria-label={`${group.playerName}, scouting`}>
        <div className="pk2">
          <div className="pk2-head">
            <NFace name={group.playerName} />
            <div>
              <h2>{group.playerName}</h2>
              <span>
                {naturalPosition(group.playerName)} · {teamCodes.slice(0, 4).join(' · ')}
                {teamCodes.length > 4 && ` +${teamCodes.length - 4}`} · {careerYears}
              </span>
            </div>
            <button type="button" className="x" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <section className="pk2-card">
            <div className="pk2-top">
              <span className="eb">On the card</span>
              <b>{cardSpan.spanLabel}</b>
              <span className="coin2">
                <CapI />
                {fmtCaps(cardSpan.fga)} caps
              </span>
            </div>
            <div className="pk2-nums">
              {nums.map(([v, l, tip]) => (
                <div key={l} title={tip}>
                  <b>{v}</b>
                  <span>{l}</span>
                </div>
              ))}
            </div>
            <div className="pk2-grades">
              <Awards span={cardSpan} />
              {scouted && <span className="pk2-tier">{tierOf(cardSpan)}</span>}
              {(scouted || !readOnly) && <Grades span={cardSpan} locked={!scouted} />}
            </div>
            {!readOnly && (
              <button
                type="button"
                className={`btn ${legal(cardSpan) ? 'go' : 'off'}`}
                style={{ marginTop: 14 }}
                disabled={!legal(cardSpan)}
                title={draftButtonTitle(state, cardSpan.id, canPick, currentTeam)}
                onClick={() => onPick(cardSpan.id)}
              >
                Draft {cardSpan.spanLabel}
              </button>
            )}
          </section>

          {!scouted && !readOnly && onScout && scoutsLeft !== undefined && (
            <div className="pk2-scout">
              <button
                type="button"
                className={`btn ${scoutsLeft > 0 ? 'line' : 'off'}`}
                disabled={scoutsLeft <= 0}
                onClick={onScout}
                title={scoutsLeft > 0 ? undefined : 'You have used all your scouting reports for this draft.'}
              >
                {scoutsLeft > 0 ? `Scout him · ${scoutsLeft} left` : 'No reports left'}
              </button>
            </div>
          )}

          {others.length > 0 && (
            <>
              <h3>
                Other years
              </h3>
              <table className="pk2-rows">
                <tbody>
                  {others.map((span) => {
                    const open = openId === span.id;
                    return (
                      <Fragment key={span.id}>
                        <tr className="pk2-r" onClick={() => setOpenId(open ? null : span.id)} aria-expanded={open}>
                          <td className="y">{span.spanLabel}</td>
                          <td>
                            <span className="pk2-bx">{span.box.ppg.toFixed(1)} · {span.box.rpg.toFixed(1)} · {span.box.apg.toFixed(1)}</span>
                            <Awards span={span} />
                          </td>
                          <td className="t">{scouted ? tierOf(span) : ''}</td>
                          <td className="cap">
                            <CapI />
                            {fmtCaps(span.fga)}
                          </td>
                          <td className="car">{open ? '▾' : '▸'}</td>
                        </tr>
                        {open && (
                          <tr className="pk2-open">
                            <td colSpan={5}>
                              {scouted && (
                                <div className="pk2-grades">
                                  <Grades span={span} />
                                </div>
                              )}
                              <div className="pk2-more">
                                <span>
                                  FG% <b>{pct(span.box.fgPct)}</b>
                                </span>
                                <span title={hadThreePointLine(span) ? undefined : THREE_POINT_LINE_NOTE}>
                                  3P% <b>{hadThreePointLine(span) ? pct(span.box.threePct) : NOT_YET}</b>
                                </span>
                                <span>
                                  FT% <b>{pct(span.box.ftPct)}</b>
                                </span>
                                <span title={hadStealsBlocksRecorded(span) ? undefined : STEALS_BLOCKS_NOTE}>
                                  STL <b>{hadStealsBlocksRecorded(span) ? span.box.spg.toFixed(1) : NOT_YET}</b>
                                </span>
                                <span title={hadStealsBlocksRecorded(span) ? undefined : STEALS_BLOCKS_NOTE}>
                                  BLK <b>{hadStealsBlocksRecorded(span) ? span.box.bpg.toFixed(1) : NOT_YET}</b>
                                </span>
                                <span>
                                  {teamsForSpan(span)
                                    .map((t) => t.code)
                                    .join(' · ')}{' '}
                                  · plays {span.primaryPosition}
                                </span>
                              </div>
                              {!readOnly && (
                                <button
                                  type="button"
                                  className={`btn ${legal(span) ? 'line' : 'off'}`}
                                  disabled={!legal(span)}
                                  title={draftButtonTitle(state, span.id, canPick, currentTeam)}
                                  onClick={() => onPick(span.id)}
                                >
                                  Draft {span.spanLabel} instead
                                </button>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
          {hiddenCount > 0 && (
            <button type="button" className="pk2-all" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer ▴' : `Show every season ▾`}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** A player's card to read, from one span (the results, the season, a mode's end). */
export function SpanCard({ span, onClose }: { span: PlayerSpan; onClose: () => void }) {
  return <PlayerPeekModal group={{ playerName: span.playerName, spans: [span], spansByAiValue: [span] }} cardSpanId={span.id} canPick={false} scouted onClose={onClose} />;
}
