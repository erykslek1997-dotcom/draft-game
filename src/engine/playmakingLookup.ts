import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { resolveSourceName, seasonEndYearOf } from '../data/sourceNameResolver';
import playmakingData from '../data/awards/playmaking.json';
import { envVar } from './env';
import { skill } from './skills';

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

/**
 * 2026-11-27 (the user: Jokic's passing should carry a role five; the export read him 90.5, under
 * Draymond 90.9, and Embiid 85.7 with half his AST%): the export is one number per career. `PM_SKILL`
 * moves it that share of the way to the window's own handling skill (AST% × √(AST%/USG%) − ½ TOV%,
 * era percentile), put on the export's scale (median 49 → 58.5, p90 89 → 87.8). 0 = off.
 */
const PM_SKILL = Number(envVar('PM_SKILL') ?? 0);
export function playmakingScoreForPlayer(span: PlayerSpan): number | null {
  const row = byName.get(normalizePlayerName(span.playerName));
  const old = row ? row.score : null;
  if (!PM_SKILL) return old;
  const h = skill(span, 'handling');
  if (h === null) return old;
  const fromSkill = 22.7 + 0.733 * h;
  return old === null ? fromSkill : old + PM_SKILL * (fromSkill - old);
}
