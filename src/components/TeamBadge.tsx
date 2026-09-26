import { seasonTag, teamColors } from '../data/teamColors';

interface BadgeProps {
  /** Franchise code as in `cardCareerMetadata.json` (e.g. "DET"). */
  code: string;
  seasonEnd: number;
  /** Accessible name, e.g. "2004 Detroit Pistons"; defaults to code and season. */
  label?: string;
}

/** Badge A ("tile"): code over a season strip, in that era's colours. Our own design — no logos. */
export function TeamTile({ code, seasonEnd, label }: BadgeProps) {
  const c = teamColors(code, seasonEnd);
  return (
    <span
      className="team-tile"
      role="img"
      aria-label={label ?? `${code} ${seasonEnd}`}
      style={{ background: c.primary, color: c.primaryInk }}
    >
      <span className="team-tile-code">{code}</span>
      <span className="team-tile-season" style={{ background: c.secondary, color: c.secondaryInk }}>{seasonTag(seasonEnd)}</span>
    </span>
  );
}

/** Badge C ("chip"): two colour bars and "CODE 'YY" — or "CODE 'YY–'YY" when the window spent
 * more than one season with the team — for player stats. */
export function TeamChip({ code, seasonEnd, seasonStart, label }: BadgeProps & { seasonStart?: number }) {
  const c = teamColors(code, seasonEnd);
  const range = seasonStart !== undefined && seasonStart < seasonEnd;
  return (
    <span className="team-chip" title={label ?? `${code} ${range ? `${seasonStart}–` : ''}${seasonEnd}`}>
      <span className="team-chip-bar" style={{ background: c.primary }} aria-hidden />
      <span className="team-chip-bar is-thin" style={{ background: c.secondary }} aria-hidden />
      <span className="team-chip-text">{code} {range ? `${seasonTag(seasonStart!)}–` : ''}{seasonTag(seasonEnd)}</span>
    </span>
  );
}
