import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import availabilityData from '../data/awards/availability.json';

/**
 * Shared name/year matching against the availability extract (`scripts/buildAvailability.ts`),
 * factored out on the same pattern as `darkoLookup.ts` / `selfCreationLookup.ts` so nothing
 * downstream reimplements it.
 *
 * Matching is on normalized name + the span's first and last season-end year, because the three
 * span sources in `players.ts` use three incompatible id schemes but all agree on name and years.
 * An exact year match is tried first; failing that, the span with the largest year overlap is
 * used, which is what makes the hand-typed curated rows (whose windows don't always line up
 * exactly with a source span) resolvable at all.
 */
interface AvailabilityRow {
  name: string;
  startYear: number;
  endYear: number;
  games: number;
  possibleGames: number;
  availability: number;
}
const rows = availabilityData as AvailabilityRow[];

/**
 * Players the hand-typed curated rows in `players.ts` name differently from the source export.
 * `normalizePlayerName` only strips accents and case, so a legal name change is invisible to it.
 *
 * This is the complete list, not a sample: the generated and curated-expanded spans are built
 * *from* this same source so they match by construction, leaving only the ~120 hand-typed rows
 * able to disagree — and a full sweep found exactly one (`scripts/checkDurabilityTargets.ts`
 * reports any that appear later as unrated spans).
 */
const NAME_ALIASES: Record<string, string> = {
  'ron artest': 'Metta World Peace',
};

const byName = new Map<string, AvailabilityRow[]>();
for (const r of rows) {
  const key = normalizePlayerName(r.name);
  const list = byName.get(key);
  if (list) list.push(r);
  else byName.set(key, [r]);
}
for (const [from, to] of Object.entries(NAME_ALIASES)) {
  const target = byName.get(normalizePlayerName(to));
  if (target) byName.set(normalizePlayerName(from), target);
}

export interface AvailabilityEntry {
  /** Percent of their teams' games the player actually played, across the span. */
  availability: number;
  games: number;
  possibleGames: number;
  /** True when the matched source span's years are exactly the span's own. */
  exact: boolean;
}

/**
 * Returns null when the player isn't in the source export at all, or has no span overlapping
 * these years — same contract as `avgDarkoFieldForSpan`. Callers must handle null rather than
 * substituting a neutral value, so an unmatched span is visibly unrated instead of quietly
 * scored as average.
 */
export function availabilityForSpan(span: PlayerSpan): AvailabilityEntry | null {
  const list = byName.get(normalizePlayerName(span.playerName));
  if (!list) return null;
  const years = spanEndYears(span.spanLabel);
  if (years.length === 0) return null;
  const first = years[0];
  const last = years[years.length - 1];

  const exact = list.find((r) => r.startYear === first && r.endYear === last);
  if (exact) {
    return { availability: exact.availability, games: exact.games, possibleGames: exact.possibleGames, exact: true };
  }

  let best: AvailabilityRow | null = null;
  let bestOverlap = 0;
  for (const r of list) {
    const overlap = Math.min(last, r.endYear) - Math.max(first, r.startYear) + 1;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = r;
    }
  }
  if (!best || bestOverlap <= 0) return null;
  return { availability: best.availability, games: best.games, possibleGames: best.possibleGames, exact: false };
}
