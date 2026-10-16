import type { PlayerSpan } from '../data/schema';
import careers from '../data/cardCareerMetadata.json';
import type { DailyRule } from '../dailyDraftDay';
import { overallTierForSpan, tierRank } from './grades';
import { tierContextWithSixthMan } from './sixthMan';

/**
 * 2026-10-16, the daily drafts: whether today's rule keeps a player from you. The player's only —
 * the CPU teams draft from the whole pool (the user's decision, 2026-10-15).
 *
 * A franchise block reads each player's teams from the card career data (every player of TAL 70+
 * but a handful); a player without it is never blocked. An era block reads the window's own years
 * (seasons ending in the decade). "At most one MVP-tier" counts the tier the list shows.
 */
const teamsOf = careers as Record<string, { teams?: string[] }>;

const tierCache = new Map<string, boolean>();
export function isMvpTier(span: PlayerSpan): boolean {
  let hit = tierCache.get(span.id);
  if (hit === undefined) {
    hit = tierRank(overallTierForSpan(tierContextWithSixthMan(span))) >= tierRank('MVP');
    tierCache.set(span.id, hit);
  }
  return hit;
}

/** First and last season (by the year it ends) of a window like "1999-01". */
export function windowYears(spanLabel: string): [number, number] {
  const [a, b] = spanLabel.split('-');
  const first = Number(a);
  let last = Number(a.slice(0, 2) + b);
  if (last < first) last += 100;
  return [first, last];
}

/** Whether today's rule keeps `span` from a roster that already holds `roster`. */
export function dailyRuleBlocks(rule: DailyRule | undefined, span: PlayerSpan, roster: readonly PlayerSpan[]): boolean {
  if (!rule) return false;
  switch (rule.kind) {
    case 'team':
      return teamsOf[span.playerName]?.teams?.includes(rule.code) ?? false;
    case 'era': {
      const [first, last] = windowYears(span.spanLabel);
      return last >= rule.decade && first <= rule.decade + 9;
    }
    case 'stars':
      return isMvpTier(span) && roster.filter(isMvpTier).length >= rule.max;
    default:
      return false;
  }
}
