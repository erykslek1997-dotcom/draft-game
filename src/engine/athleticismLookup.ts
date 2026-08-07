import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import athleticismData from '../data/awards/athleticism.json';

/**
 * 2026-08-06, user-supplied export (their own model, not scraped — see [[no_scraping_stats_sites]]):
 * `nba_athleticism_score_by_season.xlsx`, "Season Ranking" tab, 16,591 player-seasons 1951-52
 * through 2025-26. A season-level functional-athleticism score (0-100, plus an S-F letter grade)
 * built from box-derived physical-output signals (rebounding rate, dunk rate where tracked,
 * steal/block rate, restricted-area shot volume) — the user's own framing: "not an oracle," but a
 * real, independent physical-tools signal, useful specifically for catching defenders whose good
 * real-plus-minus/DARKO reading might be **team-scheme-driven rather than individual** (the same
 * "Curry's DDPM credits Golden State's shell" problem this project already knows about elsewhere).
 *
 * Motivating check: Kyle Korver's athleticism grade is D or F in EVERY season of his career,
 * including his 2013-15 span (21.0/25.9, both D) — the exact stretch where real DARKO/RAPTOR/BPM2
 * read his defense as neutral-to-positive despite his real-world reputation as one of the era's
 * worse individual defenders. A player that unathletic reading as a plus defender is much more
 * plausibly the Atlanta Hawks' real defensive scheme (Budenholzer-era, a genuinely elite team
 * defense) than Korver's own contribution — this is corroborating evidence for a discount, not
 * proof on its own.
 */
interface AthleticismRow {
  name: string;
  season: string; // "2013-14"
  position: string;
  score: number; // 0-100
  grade: string; // S/A/B/C/D/F
  confidence: string;
  scoreStatus: string;
}
const rows = athleticismData as AthleticismRow[];

interface YearEntry {
  score: number;
  grade: string;
}

const byNameYear = new Map<string, Map<number, YearEntry>>();
for (const r of rows) {
  const key = normalizePlayerName(r.name);
  const endYear = parseInt(r.season.slice(0, 4), 10) + 1;
  let yearMap = byNameYear.get(key);
  if (!yearMap) {
    yearMap = new Map();
    byNameYear.set(key, yearMap);
  }
  yearMap.set(endYear, { score: r.score, grade: r.grade });
}

/**
 * Simple mean over whichever of a span's seasons the export covers (unweighted — unlike makes-
 * weighted self-creation, a season's athleticism reading doesn't have an obvious volume weight).
 * Returns null when there's no overlap at all.
 */
export function athleticismScoreForSpan(span: PlayerSpan): number | null {
  const yearMap = byNameYear.get(normalizePlayerName(span.playerName));
  if (!yearMap) return null;
  const entries = spanEndYears(span.spanLabel)
    .map((y) => yearMap.get(y))
    .filter((e): e is YearEntry => e !== undefined);
  if (entries.length === 0) return null;
  return entries.reduce((sum, e) => sum + e.score, 0) / entries.length;
}
