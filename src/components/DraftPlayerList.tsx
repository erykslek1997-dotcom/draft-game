import type { CSSProperties } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { offensiveGrade, defensiveGrade, spacingGrade, type Grade } from '../engine/grades';
import { computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { computeSpacing } from '../engine/spacing';
import { naturalPosition } from '../engine/naturalPosition';
import { CapIcon, Face } from './ShotChip';
import { cardRoles } from './cardRoles';
import { spanTeamColor } from './TeamBand';
import { hadThreePointLine, NOT_YET } from './eraNotes';

/**
 * 2026-10-14, the draft list redesign (approved mockups "v2 Desktop"/"v2 Phone", the user: "taki
 * widok zamiast kart jest bardziej czytelny"): one row per player instead of a card. On a laptop a
 * table — player, tier, points · rebounds · assists, threes attempted, caps, the scouting report,
 * Draft; on a phone the same row folds to two lines. A tap on the player opens his scouting window,
 * as the card did. A scouted player shows his OFF/DEF/3PT grades; the rest offer the report.
 */

export interface PlayerListRow {
  key: string;
  span: PlayerSpan;
  tier: string;
  tierColor: string;
  legal: boolean;
  draftTitle?: string;
  scouted: boolean;
  /** "Taken #18 · BAL" while a just-taken player still holds his place. */
  taken?: string;
}

function GradeCell({ label, grade, color }: { label: string; grade: Grade; color: (g: Grade) => string }) {
  return (
    <span className="pl-grade">
      {label} <b style={{ color: color(grade) }}>{grade}</b>
    </span>
  );
}

export function DraftPlayerList({
  rows,
  scoutsLeft = 0,
  leaving = false,
  gradeColor,
  onDraft,
  onOpen,
}: {
  rows: PlayerListRow[];
  scoutsLeft?: number;
  /** The taken rows are folding away. */
  leaving?: boolean;
  gradeColor: (g: Grade) => string;
  onDraft: (span: PlayerSpan) => void;
  /** Opens the player's scouting window; without it (Mini Draft: one season per player) there is
   * no scouting column. */
  onOpen?: (playerName: string) => void;
}) {
  const scouting = onOpen !== undefined;
  return (
    <div className={`pl-table${scouting ? '' : ' pl-table--noscout'}`} role="table" aria-label="Available players">
      <div className="pl-row pl-row--head" role="row">
        <span role="columnheader">Player</span>
        <span role="columnheader">Tier</span>
        <span role="columnheader">Pts · Reb · Ast</span>
        <span role="columnheader">3PA</span>
        <span role="columnheader">Caps</span>
        {scouting && <span role="columnheader">Scouting report</span>}
        <span role="columnheader" aria-label="Draft" />
      </div>
      {rows.map(({ key, span, tier, tierColor, legal, draftTitle, scouted, taken }) => {
        const ring = spanTeamColor(span);
        const box = span.box;
        return (
          <div
            key={key}
            role="row"
            className={`pl-row${taken ? ' is-taken' : ''}${taken && leaving ? ' is-leaving' : ''}`}
            style={{ '--tier': tierColor, ...(ring ? { '--ring': ring } : {}) } as CSSProperties}
          >
            <button
              type="button"
              role="cell"
              className="pl-player"
              onClick={onOpen ? () => onOpen(span.playerName) : undefined}
              disabled={!onOpen}
              title={onOpen ? 'Open his scouting window' : undefined}
            >
              <Face name={span.playerName} size="md" />
              <span className="pl-id">
                <span className="pl-name">
                  {span.playerName}{' '}
                  <span className="pl-meta">
                    {naturalPosition(span.playerName)} · {span.spanLabel}
                  </span>
                </span>
                <span className="pl-roles">{cardRoles(span).join(' · ')}</span>
              </span>
            </button>
            <span role="cell" className="pl-tier">
              <span className="pl-tier-pill">{tier}</span>
            </span>
            <span role="cell" className="pl-box" title="Points · rebounds · assists a game">
              {box.ppg.toFixed(1)} · {box.rpg.toFixed(1)} · {box.apg.toFixed(1)}
            </span>
            <span role="cell" className="pl-3pa" title="Threes attempted a game">
              {hadThreePointLine(span) ? box.threePA.toFixed(1) : NOT_YET}
            </span>
            <span role="cell" className="pl-caps" title={`Costs ${span.fga.toFixed(1)} caps`}>
              <CapIcon size={11} /> {Math.round(span.fga)}
            </span>
            {scouting && (
            <span role="cell" className="pl-scout">
              {taken ? (
                <span className="pl-taken">{taken}</span>
              ) : scouted ? (
                <span className="pl-grades">
                  <GradeCell label="OFF" grade={offensiveGrade(computeOffensiveTalent(span), computeUncappedOffensiveTalent(span))} color={gradeColor} />
                  <GradeCell label="DEF" grade={defensiveGrade(computeDefensiveTalent(span))} color={gradeColor} />
                  <GradeCell label="3PT" grade={spacingGrade(computeSpacing(span), span)} color={gradeColor} />
                </span>
              ) : (
                <button type="button" className="pl-scout-btn" onClick={() => onOpen?.(span.playerName)} disabled={scoutsLeft <= 0}>
                  Scout · {scoutsLeft} left
                </button>
              )}
            </span>
            )}
            <span role="cell" className="pl-act">
              <button
                type="button"
                className="pl-draft"
                aria-label={`Draft ${span.playerName}`}
                title={draftTitle}
                disabled={!legal || !!taken}
                onClick={() => onDraft(span)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** "Show" toggles: tick the positions the list shows. */
export function PositionToggles({
  positions,
  hidden,
  onToggle,
}: {
  positions: readonly Position[];
  hidden: ReadonlySet<Position>;
  onToggle: (pos: Position) => void;
}) {
  return (
    <div className="pl-toggles" role="group" aria-label="Show positions">
      <span className="pl-toggles-label">Show</span>
      {positions.map((pos) => {
        const on = !hidden.has(pos);
        return (
          <button key={pos} type="button" aria-pressed={on} className={`pl-toggle${on ? ' is-on' : ''}`} onClick={() => onToggle(pos)}>
            <span className="pl-toggle-box" aria-hidden>
              {on ? '✓' : ''}
            </span>
            {pos}
          </button>
        );
      })}
    </div>
  );
}
