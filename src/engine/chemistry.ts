import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import { primaryStarters } from './rotation';
import type { Team } from './types';
import data from '../data/teammates.json';

/**
 * 2026-11-06, the user ("może jeszcze jakiś bonus jak ktoś grał razem irl i wygrywał?" → "limit +5,
 * pary w piątce, na razie od 1997"): two starters who really played together — the same team in a
 * season both of their drafted windows cover, each with 1,000+ minutes there (scripts/buildTeammates.ts)
 * — add `pair` to Overall; a pair that won the title together that season adds `title` instead. The
 * five's total stops at `max`. Titles are known from 1997 on. Not measurable on real teams (every real
 * team's players played together), so a design choice, kept small.
 */
export const CHEMISTRY = { pair: 0.5, title: 1, max: 5 };
const DATA = data as { seasons: Record<string, Record<string, string>>; champions: Record<string, string> };

function pairBonus(a: PlayerSpan, b: PlayerSpan): number {
  const sa = DATA.seasons[normalizePlayerName(a.playerName)];
  const sb = DATA.seasons[normalizePlayerName(b.playerName)];
  if (!sa || !sb) return 0;
  const years = new Set(spanEndYears(a.spanLabel));
  let best = 0;
  for (const y of spanEndYears(b.spanLabel)) {
    if (!years.has(y)) continue;
    const team = sa[y];
    if (!team || team !== sb[y]) continue;
    best = Math.max(best, DATA.champions[y] === team ? CHEMISTRY.title : CHEMISTRY.pair);
  }
  return best;
}

/** The starting five's pairs who played (and won) together, for the team's report. */
export function chemistryPairs(team: Team): { a: string; b: string; bonus: number }[] {
  const five = primaryStarters(team).map((s) => s.player);
  const out: { a: string; b: string; bonus: number }[] = [];
  for (let i = 0; i < five.length; i++)
    for (let j = i + 1; j < five.length; j++) {
      const bonus = pairBonus(five[i], five[j]);
      if (bonus > 0) out.push({ a: five[i].playerName, b: five[j].playerName, bonus });
    }
  return out;
}

export function chemistryAdjustment(team: Team): number {
  return Math.min(CHEMISTRY.max, chemistryPairs(team).reduce((sum, p) => sum + p.bonus, 0));
}
