import type { CSSProperties } from 'react';
import type { PlayerSpan } from '../data/schema';
import { teamColors } from '../data/teamColors';
import { teamsForSpan } from '../engine/spanTeams';

/** "BOS 1980–92" — the band segment's hover text. */
function yearsLabel(code: string, seasonStart: number, seasonEnd: number): string {
  return `${code} ${seasonStart - 1}–${String(seasonEnd).slice(2)}`;
}

/** The team colour a card rings its face in: the team the span began with. */
export function spanTeamColor(span: Pick<PlayerSpan, 'playerName' | 'spanLabel'>): string | undefined {
  const first = teamsForSpan(span)[0];
  return first ? teamColors(first.code, first.seasonEnd).primary : undefined;
}

/**
 * 2026-09-30, the user's "wariant A" card: a band across the top of every player card in the
 * team's colours — split per team when the span moved clubs, each segment as wide as the seasons
 * spent there, the code on it and the exact years on hover. The only place a card names teams.
 */
export function TeamBand({ span }: { span: Pick<PlayerSpan, 'playerName' | 'spanLabel'> }) {
  const teams = teamsForSpan(span);
  if (teams.length === 0) return <span className="at-team-band is-empty" aria-hidden />;
  return (
    <span className="at-team-band at-cond" aria-label={`Teams: ${teams.map((t) => yearsLabel(t.code, t.seasonStart, t.seasonEnd)).join(', ')}`}>
      {teams.map((t) => {
        const c = teamColors(t.code, t.seasonEnd);
        return (
          <span
            key={`${t.code}-${t.seasonStart}`}
            className="at-team-band-seg"
            title={yearsLabel(t.code, t.seasonStart, t.seasonEnd)}
            style={{ flexGrow: t.seasonEnd - t.seasonStart + 1, '--tc': c.primary, '--tc-ink': c.primaryInk, '--tc2': c.secondary } as CSSProperties}
          >
            {t.code}
          </span>
        );
      })}
    </span>
  );
}
