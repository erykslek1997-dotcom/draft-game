import type { CSSProperties, ReactNode } from 'react';
import type { PlayerSpan } from '../data/schema';
import type { OverallTier } from '../engine/grades';
import { displayTalentForSpan, formatTal } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { naturalPosition } from '../engine/naturalPosition';
import { Face, ShotChip, shortenName } from './ShotChip';
import { EraYears } from './EraYears';
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
 * może bardziej przypominać normalny draft"): tier frame, face, cost, name with position, team
 * band (see TeamBand), TAL, the season's box line and the actions. Draw Five deals the same card
 * face up but blind (`blind`).
 */
export function DraftPlayerCard({ span, cap, tier, legal, draftTitle, onDraft, onScouting, scoutingTitle, blind, className, title, style, children }: DraftPlayerCardProps) {
  const ring = spanTeamColor(span);
  const vars = { ...(blind ? {} : { '--tier-frame': TIER_FRAME_COLOR[tier] }), ...(ring ? { '--ring': ring } : {}), ...style } as CSSProperties;
  const body = (
    <>
      <TeamBand span={span} />
      {children}
      {!blind && (
        <>
          <span className="at-player-card-corner" title={tier} aria-hidden />
          <span className="at-sr-only">{tier} tier</span>
        </>
      )}
      <div className="at-player-card-top">
        <Face name={span.playerName} size="md" />
        <ShotChip fga={span.fga} cap={cap} />
      </div>
      <span className="at-player-card-name" title={span.playerName}>
        {shortenName(span.playerName, 18)}
        {!blind && (
          <>
            {' '}
            <span className="at-player-card-pos-inline">{naturalPosition(span.playerName)}</span>
          </>
        )}
      </span>
      {!blind && (
        <span className="at-player-card-meta">
          <span className="at-player-card-tal" title="Talent rating of the season this card drafts">
            TAL <b>{formatTal(displayTalentForSpan(tierContextFor(span)))}</b>
          </span>
        </span>
      )}
      <span className="at-player-card-season">
        <EraYears span={span} suffix="averages" />
      </span>
      <span className="at-player-card-stats">
        <span><b>{span.box.ppg.toFixed(1)}</b>PTS</span>
        <span><b>{span.box.rpg.toFixed(1)}</b>REB</span>
        <span><b>{span.box.apg.toFixed(1)}</b>AST</span>
      </span>
      {!blind && (
        <div className="at-player-card-foot">
          <span className={`at-player-card-actions${onScouting ? '' : ' is-single'}`}>
            {onScouting && (
              <button type="button" className="at-player-card-peek" title={scoutingTitle} onClick={onScouting}>
                Scouting
              </button>
            )}
            <button type="button" className="at-player-card-draft" disabled={!legal} title={draftTitle} onClick={onDraft}>
              Draft
            </button>
          </span>
        </div>
      )}
    </>
  );
  const cls = `at-player-card${blind ? ' at-player-card--blind' : ''}${className ? ` ${className}` : ''}`;
  if (blind) {
    return (
      <button type="button" className={cls} style={vars} title={title ?? draftTitle} disabled={!legal} onClick={onDraft}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} style={vars} title={title}>
      {body}
    </div>
  );
}
