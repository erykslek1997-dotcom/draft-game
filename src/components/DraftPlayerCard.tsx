import type { CSSProperties, ReactNode } from 'react';
import type { PlayerSpan } from '../data/schema';
import type { OverallTier } from '../engine/grades';
import { naturalPosition } from '../engine/naturalPosition';
import { CapIcon, Face, ShotChip, shortenName } from './ShotChip';
import { EraYears } from './EraYears';
import { cardRoles } from './cardRoles';
import { MagnifierIcon } from './MagnifierIcon';
import { TeamBand, spanTeamColor } from './TeamBand';

/** Card frame colour per tier (the All-Time Draft's "wariant A" tier frame), shared by every draft
 * mode's player cards and the Draft tab's tier key. */
export const TIER_FRAME_COLOR: Record<OverallTier | 'Salary Glue', string> = {
  'Salary Glue': '#82b5ea',
  'Cigarette Butt': '#b3b0a8',
  'Bench Warmer': '#f0a868',
  'Role Player': '#e8d461',
  'Sixth Man': '#c1440e',
  Starter: '#7fd68a',
  'All-star': '#6fd9e6',
  'All-NBA': '#8b9bf7',
  MVP: '#ec8ecb',
  'Greatest peak': '#ffdc9b',
  // 2026-09-24: was '#ffd479', a near-twin of Greatest peak's gold right above it — the two top
  // rungs were indistinguishable on the card frames and the tier key. Platinum reads as "above
  // gold" without colliding with any other tier's hue.
  GOAT: '#f2f4f8',
};

interface DraftPlayerCardProps {
  span: PlayerSpan;
  /** The mode's cap, for the cost chip's colour scale. */
  cap: number;
  tier: OverallTier | 'Salary Glue';
  legal: boolean;
  draftTitle?: string;
  onDraft: () => void;
  /** Omitted in modes with a single season per player (Quick 5): no Scouting button. */
  onScouting?: () => void;
  scoutingTitle?: string;
  /** Draw Five's blind card: no tier frame, no TAL, no position, no buttons — the whole card is
   * the pick. */
  blind?: boolean;
  className?: string;
  title?: string;
  style?: CSSProperties;
  /** Overlays a mode lays on the card (Draw Five: sheen, glare, the over-the-cap tag). */
  children?: ReactNode;
}

/**
 * The player card of the All-Time Draft grid, shared with Quick 5 (2026-09-26, the user: "quick 5
 * może bardziej przypominać normalny draft"). 2026-10-07, the UI simplification (approved mockup):
 * team band, face, name, position · years, the tier and the cost, one or two style labels (see
 * cardRoles), one box line and a single Draft button; a tap on the card opens Scouting. Every row
 * has a fixed height so the cards line up across the grid. Draw Five deals its own
 * blind layout (`blind`: no tier, TAL, position or buttons — the whole card is the pick).
 */
export function DraftPlayerCard({ span, cap, tier, legal, draftTitle, onDraft, onScouting, scoutingTitle, blind, className, title, style, children }: DraftPlayerCardProps) {
  const ring = spanTeamColor(span);
  const vars = { ...(blind ? {} : { '--tier-frame': TIER_FRAME_COLOR[tier] }), ...(ring ? { '--ring': ring } : {}), ...style } as CSSProperties;
  const cls = `at-player-card${blind ? ' at-player-card--blind' : ''}${className ? ` ${className}` : ''}`;
  if (!blind) {
    return (
      <div
        className={`${cls} at-pc${onScouting ? ' is-clickable' : ''}`}
        style={vars}
        title={title ?? (onScouting ? scoutingTitle : undefined)}
        onClick={onScouting}
      >
        <TeamBand span={span} />
        {children}
        <div className="at-pc-head">
          <Face name={span.playerName} size="md" />
          <span className="at-pc-id">
            {onScouting ? (
              <button
                type="button"
                className="at-pc-name at-player-card-name"
                title={scoutingTitle}
                onClick={(e) => {
                  e.stopPropagation();
                  onScouting();
                }}
              >
                {span.playerName}
              </button>
            ) : (
              <span className="at-pc-name at-player-card-name">{span.playerName}</span>
            )}
            <span className="at-pc-meta">
              {naturalPosition(span.playerName)} · {span.spanLabel}
            </span>
          </span>
        </div>
        <div className="at-pc-numbers">
          <span className="at-pc-tier" title="Tier of the years this card drafts">
            {tier}
          </span>
          <span className="at-pc-cost" title={`Costs ${Math.round(span.fga)} caps`}>
            <CapIcon size={11} />
            {Math.round(span.fga)}
          </span>
        </div>
        <span className="at-pc-roles">
          {cardRoles(span).map((role) => (
            <span key={role}>{role}</span>
          ))}
        </span>
        <div className="at-pc-statrow">
          <span className="at-pc-line" title="Points · rebounds · assists a game">
            {span.box.ppg.toFixed(1)} · {span.box.rpg.toFixed(1)} · {span.box.apg.toFixed(1)}
          </span>
          {onScouting && (
            <button
              type="button"
              className="at-pc-scout"
              aria-label={`Scouting: ${span.playerName}`}
              title="Scouting — every stretch of his career"
              onClick={(e) => {
                e.stopPropagation();
                onScouting();
              }}
            >
              <MagnifierIcon />
            </button>
          )}
        </div>
        <button
          type="button"
          className="at-pc-draft at-player-card-draft"
          disabled={!legal}
          title={draftTitle}
          onClick={(e) => {
            e.stopPropagation();
            onDraft();
          }}
        >
          Draft
        </button>
      </div>
    );
  }
  return (
    <button type="button" className={cls} style={vars} title={title ?? draftTitle} disabled={!legal} onClick={onDraft}>
      <TeamBand span={span} />
      {children}
      <div className="at-player-card-top">
        <Face name={span.playerName} size="md" />
        <ShotChip fga={span.fga} cap={cap} />
      </div>
      <span className="at-player-card-name" title={span.playerName}>
        {shortenName(span.playerName, 18)}
      </span>
      <span className="at-player-card-season">
        <EraYears span={span} suffix="averages" />
      </span>
      <span className="at-player-card-stats">
        <span><b>{span.box.ppg.toFixed(1)}</b>PTS</span>
        <span><b>{span.box.rpg.toFixed(1)}</b>REB</span>
        <span><b>{span.box.apg.toFixed(1)}</b>AST</span>
      </span>
    </button>
  );
}
