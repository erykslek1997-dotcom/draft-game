/**
 * Precomputes the in-game draft pool from the full players dataset (curated + generated +
 * curated-expanded, ~14,000 span entries across ~2,200 unique players) and writes just the
 * selected subset to src/data/draftPool.json.
 *
 * This runs at generation time rather than in the browser specifically to avoid shipping the
 * entire archive to the client: only ~300 players/~2,000 spans are ever used in-game, so
 * there's no reason for the other ~12,000 entries to be part of the app bundle. Re-run this
 * after regenerating any of the three source files (generatePlayers.ts, expandCuratedSpans.ts,
 * or a hand-edit to players.ts's curated rows).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { players, curatedPlayers } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import type { PlayerSpan, Position } from '../src/data/schema';
import d1d2d3AllowlistData from '../src/data/d1d2d3Allowlist.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_FILE = path.resolve(__dirname, '../src/data/draftPool.json');

/**
 * The full dataset is far more than a realistic 4-team draft needs — at 9 players/team x 4
 * teams that's 36 picks, so a pool in the low hundreds gives plenty of depth and real
 * strategic choice without an unusably long list. This is a filter, not a deletion: the full
 * dataset stays intact and regenerable; this just selects which players are actually offered
 * in-game.
 *
 * Selection is deliberately NOT a straight top-N by talent. A pure talent cut collapses the
 * cheap end of the pool into rim-running centers (low usage + high FG% + rebounds scores well
 * in `computeTalent`), which guts the whole point of an FGA cap: the interesting decision is
 * "which cheap, complementary role player do I pair with my stars," and that needs cheap
 * *wings and guards* on the board too. So the pool is built from three tiers.
 */
/**
 * 2026-08-07, user's explicit ask after diagnosing "weak starter"/"severe backup" complaints
 * (16.3%/7.5% of teams) as a pool-depth problem, not purely an AI-logic one: guarantee at least
 * 100 distinct real players per position (500+ total) rather than continuing to tune drafting
 * heuristics against a thin pool. Raised from the previous 300/38-per-position target.
 */
const TARGET_POOL_SIZE = 560;
/** Star tier: guarantees every position has real top-end talent to compete over, since a
 * global talent cut would otherwise favor bigs and wings over pure point guards. */
const STARS_PER_POSITION = 100;
/** Value tier: the best talent-per-FGA players at each position among genuinely cheap
 * options — the "cap glue" a drafter fills the last roster spots with. */
const VALUE_PER_POSITION = 12;
/** A player's cheapest span must come in under this to count for the value tier. */
const VALUE_FGA_CEILING = 9;
const ALL_POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Specific spans excluded from the in-game pool entirely — not a talent-formula correction
 * (the player's other spans, and their full-dataset TAL for validation purposes, are
 * untouched), but a pool-curation call that a specific stretch isn't a realistic draft option
 * for this format. Originally just Wilt's curated 1961-63 (33.6 FGA/game); superseded below by
 * a broader rule (2026-08-05) once `curatedExpandedSpans.json` turned out to carry several more
 * pre-1966 Wilt seasons (1959-61 through 1965-67, all 19.6-35.3 FGA/game) that this single-entry
 * list never covered — kept here as the general mechanism for any future one-off exclusion. */
const BANNED_SPANS: { player: string; spanLabel: string }[] = [];

/** User's explicit rule (2026-08-05): ANY Wilt Chamberlain span starting before the 1966-67
 * season is excluded — not just the one originally-curated 1961-63 span. His rookie-era usage
 * (19.6-35.3 FGA/game across 1959-61 through 1965-67) has no analogue in any modern roster
 * construction; 1966-68 onward (15.5 FGA/game and dropping) stays eligible. Computed from the
 * spanLabel's own 4-digit start year rather than hardcoding each one, so it also covers any
 * further pre-1966 Wilt span `expandCuratedSpans`/`generatePlayers` might add later. */
function isBannedWiltSpan(p: PlayerSpan): boolean {
  if (normalizePlayerName(p.playerName) !== normalizePlayerName('Wilt Chamberlain')) return false;
  const startYear = parseInt(p.spanLabel.slice(0, 4), 10);
  return Number.isFinite(startYear) && startYear < 1966;
}

function isBannedSpan(p: PlayerSpan): boolean {
  return (
    isBannedWiltSpan(p) ||
    BANNED_SPANS.some((b) => normalizePlayerName(b.player) === normalizePlayerName(p.playerName) && b.spanLabel === p.spanLabel)
  );
}

const eligiblePlayers = players.filter((p) => !isBannedSpan(p));

/** TEMPORARY: when true, skips the normal talent/value-tier selection below entirely and
 * restricts the pool to exactly `D1_D2_D3_ALLOWLIST` — the 328 real players actually drafted
 * across three past in-person "all-time draft" sessions (see buildD1D2D3Allowlist.ts for
 * provenance), while other systems are being tuned against real play data. Set back to false
 * (the pool build's normal three-tier selection resumes untouched) once that's no longer
 * needed — nothing else in this file depends on this flag. */
const RESTRICT_TO_D1_D2_D3 = false;
const D1_D2_D3_ALLOWLIST: string[] = d1d2d3AllowlistData;

interface PlayerSummary {
  normalizedName: string;
  peakTalent: number;
  peakPosition: Position;
  /** Best talent-per-FGA across this player's spans — the "value" axis. */
  bestEfficiency: number;
  cheapestFga: number;
}

const spansByName = new Map<string, PlayerSpan[]>();
for (const p of eligiblePlayers) {
  const key = normalizePlayerName(p.playerName);
  const existing = spansByName.get(key);
  if (existing) existing.push(p);
  else spansByName.set(key, [p]);
}

const summaries: PlayerSummary[] = [...spansByName.entries()].map(([normalizedName, spans]) => {
  let peakSpan = spans[0];
  let peakTalent = -Infinity;
  let bestEfficiency = -Infinity;
  let cheapestFga = Infinity;
  for (const span of spans) {
    const talent = computeTalent(span);
    if (talent > peakTalent) {
      peakTalent = talent;
      peakSpan = span;
    }
    if (span.fga > 0) bestEfficiency = Math.max(bestEfficiency, talent / span.fga);
    cheapestFga = Math.min(cheapestFga, span.fga);
  }
  return { normalizedName, peakTalent, peakPosition: peakSpan.primaryPosition, bestEfficiency, cheapestFga };
});

const kept = new Set<string>();

if (RESTRICT_TO_D1_D2_D3) {
  for (const name of D1_D2_D3_ALLOWLIST) kept.add(normalizePlayerName(name));
} else {
  // Tier 1 — every hand-curated player. These were picked by hand precisely to cover the
  // archetype/role/era spread the fit rubric grades on (including the deliberate low-usage
  // "cap glue" tier), so a talent-ranked cut must never drop them.
  for (const p of curatedPlayers) kept.add(normalizePlayerName(p.playerName));

  // Tier 2 — star talent, per position.
  for (const slot of ALL_POSITIONS) {
    const inSlot = summaries.filter((s) => s.peakPosition === slot).sort((a, b) => b.peakTalent - a.peakTalent);
    for (const s of inSlot.slice(0, STARS_PER_POSITION)) kept.add(s.normalizedName);
  }

  // Tier 3 — cheap value, per position.
  for (const slot of ALL_POSITIONS) {
    const inSlot = summaries
      .filter((s) => s.peakPosition === slot && s.cheapestFga <= VALUE_FGA_CEILING)
      .sort((a, b) => b.bestEfficiency - a.bestEfficiency);
    let added = 0;
    for (const s of inSlot) {
      if (added >= VALUE_PER_POSITION) break;
      if (kept.has(s.normalizedName)) continue;
      kept.add(s.normalizedName);
      added++;
    }
  }

  // Fill any remaining headroom with the best talent still on the board.
  const remaining = summaries.filter((s) => !kept.has(s.normalizedName)).sort((a, b) => b.peakTalent - a.peakTalent);
  for (const s of remaining) {
    if (kept.size >= TARGET_POOL_SIZE) break;
    kept.add(s.normalizedName);
  }
}

/** Every span (all eras, not just the peak one) for every kept player — a drafter can still
 * choose which stretch of a kept player's career to take. */
const draftPool: PlayerSpan[] = eligiblePlayers.filter((p) => kept.has(normalizePlayerName(p.playerName)));

fs.writeFileSync(JSON_FILE, JSON.stringify(draftPool, null, 2) + '\n');
console.log(`Unique players kept: ${kept.size} | total span entries: ${draftPool.length}`);
console.log(`Wrote ${JSON_FILE}`);
