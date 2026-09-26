import type { PlayerSpan } from '../data/schema';
import careerData from '../data/cardCareerMetadata.json';
import { spanEndYears } from './era';

const career = careerData as Record<string, { seasons: { seasonEnd: number; team: string }[] }>;

export interface SpanTeam {
  code: string;
  /** The last season of the window the player spent with this team. */
  seasonEnd: number;
}

/** The teams a player's window was spent with, in order, for the team chips on player stats. */
export function teamsForSpan(span: Pick<PlayerSpan, 'playerName' | 'spanLabel'>): SpanTeam[] {
  const years = new Set(spanEndYears(span.spanLabel));
  const seasons = (career[span.playerName]?.seasons ?? []).filter((s) => years.has(s.seasonEnd)).sort((a, b) => a.seasonEnd - b.seasonEnd);
  const out: SpanTeam[] = [];
  for (const s of seasons) {
    const last = out[out.length - 1];
    if (last?.code === s.team) last.seasonEnd = s.seasonEnd;
    else out.push({ code: s.team, seasonEnd: s.seasonEnd });
  }
  return out;
}
