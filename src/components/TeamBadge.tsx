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

/** Badge C ("chip"): two colour bars and "CODE 'YY–'YY" for player stats.
 *
 * 2026-09-28, user-reported ("na górze pokazuje inny span niż niżej"): the chip wrote season END
 * years ("CLE '25–'26") under a span label written the usual way, from the first season's start
 * ("2024-26" = 2024-25 and 2025-26). It now writes the seasons the same way the label does: from
 * the first season's start year to the last season's end year ("CLE '24–'26"; one season "'11–'12").
 * `seasonStart`/`seasonEnd` are still season END years, as `teamsForSpan` gives them. */
export function TeamChip({ code, seasonEnd, seasonStart, label }: BadgeProps & { seasonStart?: number }) {
  const c = teamColors(code, seasonEnd);
  const firstStart = (seasonStart ?? seasonEnd) - 1;
  return (
    <span className="team-chip" title={label ?? `${code} ${firstStart}–${String(seasonEnd).slice(2)}`}>
      <span className="team-chip-bar" style={{ background: c.primary }} aria-hidden />
      <span className="team-chip-bar is-thin" style={{ background: c.secondary }} aria-hidden />
      <span className="team-chip-text">{code} {seasonTag(firstStart)}–{seasonTag(seasonEnd)}</span>
    </span>
  );
}
