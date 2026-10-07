import { computeFinishing } from '../engine/finishing';
import { useEffect, useMemo, useState } from 'react';
import type { PlayerSpan } from '../data/schema';
import { isPickLegal, type DraftState } from '../engine/draft';
import { computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { computeSpacing } from '../engine/spacing';
import type { Team } from '../engine/types';
import { CapIcon, Face } from './ShotChip';
import { TIER_FRAME_COLOR } from './DraftPlayerCard';
import { NOT_YET, STEALS_BLOCKS_NOTE, THREE_POINT_LINE_NOTE, hadStealsBlocksRecorded, hadThreePointLine } from './eraNotes';
import { TeamChip } from './TeamBadge';
import { teamsForSpan } from '../engine/spanTeams';
import { draftPool as fullDraftPool } from '../data/draftPool';
import { offensiveGrade, defensiveGrade, portabilityGrade, spacingGrade, durabilityGrade, finishingGrade, overallTierForSpan, type Grade } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { computeDurability } from '../engine/durability';
import { naturalPosition } from '../engine/naturalPosition';
import { AtGrade, draftButtonTitle } from './DraftBoard';

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

function Grades({ span, all }: { span: PlayerSpan; all: boolean }) {
  const items: Array<[string, Grade, string]> = [
    ['Offense', offensiveGrade(computeOffensiveTalent(span), computeUncappedOffensiveTalent(span)), 'How good his offense is'],
    ['Defense', defensiveGrade(computeDefensiveTalent(span)), 'How good his defense is'],
    ['Spacing', spacingGrade(computeSpacing(span), span), 'How much room his shooting gives teammates'],
    ['Portability', portabilityGrade(span), 'How well his game travels next to other stars, on both ends'],
    ...(all
      ? ([
          ['Finishing', finishingGrade(computeFinishing(span), span), 'Scoring at the rim'],
          ['Durability', durabilityGrade(computeDurability(span)), 'Games played'],
        ] as Array<[string, Grade, string]>)
      : []),
  ];
  return (
    <span className="pk-grades">
      {items.map(([label, grade, title]) => (
        <span key={label} className="pk-grade" title={title}>
          <AtGrade grade={grade} />
          {label}
        </span>
      ))}
    </span>
  );
}

function StatLine({ span }: { span: PlayerSpan }) {
  return (
    <span className="pk-more">
      <span>FG% <b>{pct(span.box.fgPct)}</b></span>
      <span title={hadThreePointLine(span) ? undefined : THREE_POINT_LINE_NOTE}>3P% <b>{hadThreePointLine(span) ? pct(span.box.threePct) : NOT_YET}</b></span>
      <span>FT% <b>{pct(span.box.ftPct)}</b></span>
      <span title={hadStealsBlocksRecorded(span) ? undefined : STEALS_BLOCKS_NOTE}>STL <b>{hadStealsBlocksRecorded(span) ? span.box.spg.toFixed(1) : NOT_YET}</b></span>
      <span title={hadStealsBlocksRecorded(span) ? undefined : STEALS_BLOCKS_NOTE}>BLK <b>{hadStealsBlocksRecorded(span) ? span.box.bpg.toFixed(1) : NOT_YET}</b></span>
    </span>
  );
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
  state: DraftState;
  canPick: boolean;
  currentTeam: Team;
  onClose: () => void;
  onPick: (id: string) => void;
  scouted: boolean;
  scoutsLeft: number;
  onScout: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [allGrades, setAllGrades] = useState(false);

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
  const legal = (span: PlayerSpan) => canPick && isPickLegal(state, span.id);

  return (
    <div className="player-peek-overlay pk-overlay" onClick={onClose}>
      <div className="pk-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${group.playerName}, scouting`}>
        <div className="pk-head">
          <Face name={group.playerName} size="md" />
          <div className="pk-who">
            <h2>{group.playerName}</h2>
            <span>
              {naturalPosition(group.playerName)} · {teamCodes.slice(0, 4).join(' · ')}
              {teamCodes.length > 4 && ` +${teamCodes.length - 4}`} · {careerYears}
            </span>
          </div>
          <button type="button" className="at-calm-icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <section className="pk-pick">
          <div className="pk-pick-top">
            <span className="pk-label">On the card</span>
            <span className="pk-years">{cardSpan.spanLabel}</span>
            <span className="pk-cost">
              <CapIcon size={12} />
              {cardSpan.fga.toFixed(1)}
            </span>
          </div>
          <div className="pk-nums">
            <span><b>{cardSpan.box.ppg.toFixed(1)}</b>PTS</span>
            <span><b>{cardSpan.box.rpg.toFixed(1)}</b>REB</span>
            <span><b>{cardSpan.box.apg.toFixed(1)}</b>AST</span>
            <span><b>{pct(cardSpan.box.fgPct)}</b>FG%</span>
            <span title={hadThreePointLine(cardSpan) ? undefined : THREE_POINT_LINE_NOTE}>
              <b>{hadThreePointLine(cardSpan) ? pct(cardSpan.box.threePct) : NOT_YET}</b>3P%
            </span>
          </div>
          {scouted && (
            <div className="pk-scouted">
              <span className="pk-tier" style={{ ['--tier-frame' as string]: TIER_FRAME_COLOR[tierOf(cardSpan)] }}>{tierOf(cardSpan)}</span>
              <Grades span={cardSpan} all={allGrades} />
              <button type="button" className="pk-link" onClick={() => setAllGrades((v) => !v)}>
                {allGrades ? 'Fewer grades' : 'All grades'}
              </button>
            </div>
          )}
          <button
            type="button"
            className="pk-draft"
            disabled={!legal(cardSpan)}
            title={draftButtonTitle(state, cardSpan.id, canPick, currentTeam)}
            onClick={() => onPick(cardSpan.id)}
          >
            Draft {cardSpan.spanLabel}
          </button>
        </section>

        {!scouted && (
          <div className="pk-scout">
            <span>🔍 A scouting report shows his tier and grades for every stretch.</span>
            <button
              type="button"
              className="at-calm-btn player-peek-scout-btn"
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
            <div className="pk-sec">
              Other years<span>tap to compare</span>
            </div>
            {others.map((span) => {
              const open = openId === span.id;
              return (
                <div key={span.id} className={`pk-row-wrap${open ? ' is-open' : ''}`}>
                  <button type="button" className="pk-row" aria-expanded={open} onClick={() => setOpenId(open ? null : span.id)}>
                    <span className="pk-row-years">{span.spanLabel}</span>
                    <span className="pk-row-line">
                      {span.box.ppg.toFixed(1)} · {span.box.rpg.toFixed(1)} · {span.box.apg.toFixed(1)}
                    </span>
                    <span className="pk-row-tier">
                      {scouted && (
                        <>
                          <span className="pk-dot" style={{ background: TIER_FRAME_COLOR[tierOf(span)] }} aria-hidden />
                          {tierOf(span)}
                        </>
                      )}
                    </span>
                    <span className="pk-row-cost">
                      <CapIcon size={11} />
                      {span.fga.toFixed(1)}
                    </span>
                    <span className="pk-caret" aria-hidden>{open ? '▾' : '▸'}</span>
                  </button>
                  {open && (
                    <div className="pk-detail">
                      {scouted && <Grades span={span} all />}
                      <StatLine span={span} />
                      <span className="pk-teams">
                        {teamsForSpan(span).map((t) => (
                          <TeamChip key={t.code} code={t.code} seasonStart={t.seasonStart} seasonEnd={t.seasonEnd} />
                        ))}
                        <span className="pk-pos">plays {span.primaryPosition}</span>
                      </span>
                      <button
                        type="button"
                        className="at-calm-btn pk-draft-alt"
                        disabled={!legal(span)}
                        title={draftButtonTitle(state, span.id, canPick, currentTeam)}
                        onClick={() => onPick(span.id)}
                      >
                        Draft {span.spanLabel} instead
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
        {hiddenCount > 0 && (
          <button type="button" className="pk-all" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${rows.length} stretches`}
          </button>
        )}
      </div>
    </div>
  );
}
