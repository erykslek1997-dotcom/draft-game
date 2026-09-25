import { normalizePlayerName } from '../data/schema';
import { resolveSourceName } from '../data/sourceNameResolver';
import careerAveragesData from '../data/careerAverages.json';

/** Mirrors `scripts/buildCareerAverages.ts`'s own `CareerAverageRow` shape — duplicated rather
 * than imported (same pattern `availabilityLookup.ts` uses for `AvailabilityRow`) since `scripts/`
 * sits outside `src`'s TypeScript project boundary. */
export interface CareerAverageRow {
  name: string;
  games: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  fgPct: number;
  threePct: number;
}

/**
 * Real, whole-career per-game averages (`scripts/buildCareerAverages.ts`) — 2026-08-13, the
 * user's own follow-up right after the box-stat redesign shipped: the player-mode Draft table's
 * PTS/AST/REB/STL/BLK/FG%/3PT% columns should read as this player's actual career, not the
 * specific span row they happen to sit on (a span-level number swings a lot span to span, e.g.
 * LeBron's rookie-year span vs. his 2009-11 peak, and isn't what "career averages" means).
 *
 * Same lookup pattern as `availabilityLookup.ts`/`darkoLookup.ts`: name-keyed, returns null for
 * an unmatched player rather than substituting a neutral value, so callers can fall back
 * explicitly (`DraftBoard.tsx` falls back to the span's own box line) instead of silently
 * showing a wrong number.
 */
const rows = careerAveragesData as CareerAverageRow[];

const byName = new Map<string, CareerAverageRow>();
for (const r of rows) byName.set(resolveSourceName(r.name), r);


export function careerAveragesFor(playerName: string): CareerAverageRow | null {
  return byName.get(normalizePlayerName(playerName)) ?? null;
}
