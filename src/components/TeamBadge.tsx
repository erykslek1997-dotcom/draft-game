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
