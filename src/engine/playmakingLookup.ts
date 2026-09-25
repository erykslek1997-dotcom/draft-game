import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { resolveSourceName, seasonEndYearOf } from '../data/sourceNameResolver';
import playmakingData from '../data/awards/playmaking.json';

/**
 * The playmaking export (`scripts/buildPlaymaking.ts`) is one row per distinct player — their
 * single best/selected season, not a time series — so this lookup is name-keyed only, unlike
 * `darkoLookup.ts`/`zoneEfficiencyLookup.ts`. It reads as "how real is this player's self-
 * creation/passing gravity, at their peak," applied uniformly across every span of that person.
 * Coarser than a per-span number on purpose — this is an archetype-level synergy signal for
 * `offensiveProfile.ts`, not a talent input, and the user was explicit that precision here
 * matters far less than not letting it anywhere near `computeTalent`.
 */
interface PlaymakingRow {
  name: string;
  score: number;
  tier: string;
  selectedSeason: string;
}
const rows = playmakingData as PlaymakingRow[];

const byName = new Map<string, PlaymakingRow>();
for (const r of rows) {
  const key = resolveSourceName(r.name, seasonEndYearOf(r.selectedSeason));
  // A few players appear more than once across export revisions in principle — keep the
  // higher score if that ever happens, rather than an arbitrary last-write-wins.
  const existing = byName.get(key);
  if (!existing || r.score > existing.score) byName.set(key, r);
}

export function playmakingScoreForPlayer(span: PlayerSpan): number | null {
  const row = byName.get(normalizePlayerName(span.playerName));
  return row ? row.score : null;
}

export function playmakingTierForPlayer(span: PlayerSpan): string | null {
  const row = byName.get(normalizePlayerName(span.playerName));
  return row ? row.tier : null;
}
