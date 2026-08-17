import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import playoffCollapseData from '../data/awards/playoffCollapse.json';

const DATA = playoffCollapseData as Record<string, number>;

/**
 * 2026-08-12: replaced the old, PBP-shot-derived `playoffPerformance.json` (153/5205 spans,
 * 2.9% coverage) with `playoffCollapse.json` (3095 spans, ~59%) — see `scripts/buildPlayoffCollapse.ts`
 * for the full real methodology (real playoff-vs-regular TS% delta, real opponent-DRtg-faced
 * toughness adjustment, no team win/round-advanced gating). Old file kept as
 * `playoffPerformance.before.json` for reference, not read by any code. Same underlying real
 * signal now also feeds `grades.ts`'s `playoffCollapse`-driven tier cap (see that file) for the
 * elite-tier population this additive term can't move on its own (softCapTalent absorption,
 * confirmed directly: even a heavily scaled-up malus barely moved TAL for raw values above ~110).
 *
 * Flat TAL bonus/penalty from real playoff shooting efficiency (TS%) vs. regular season, per span,
 * ±5 range. Not gated on team wins/rounds advanced at all (the old mechanism's approach, replaced
 * specifically because it wasn't — see the 2026-08-12 note above): instead, a real drop is
 * softened when the player faced genuinely tough opponent defenses that postseason (measured, not
 * assumed) and left alone otherwise, whether or not the team won. Full method, thresholds and the
 * two real data sources are documented in `scripts/buildPlayoffCollapse.ts`, the single source of
 * truth for how `playoffCollapse.json` was computed — this docstring intentionally doesn't
 * duplicate it.
 *
 * **A same-day FG%-only variant of the old TS%-based mechanism (makes/attempts, no free throws)
 * was tried, found to further erode Taylor top-10/GOAT-40 correlation (0.806->0.794, 0.605->0.588)
 * beyond the already user-accepted TS%-based tradeoff, and reverted at the user's explicit "leave
 * it as it was." TS% (not EFG%, not raw FG%) is the shipped metric here — re-derive only if asked.**
 */

/**
 * 2026-08-14, user's direct ask, extended same-day from a display-only badge to the REAL number:
 * force a genuine Platinum-Riser-magnitude playoff bonus for specific (player, span) pairs whose
 * real, measured value (this file's own TS%-delta methodology above) doesn't support it. User's
 * own stated reasoning: box-score-derived stats sometimes can't capture a player's real playoff
 * impact — same category of deliberate, asked-for override as `talent.ts`'s own Curry gravity cap
 * / Magic SF correction / Durant SF-defense exclusion / CP3 two-way exemption, just applied to
 * this one signal instead of the main formula. This overrides the REAL number `DATA[span.id]`
 * would otherwise return — it now feeds `talent.ts`'s additive TAL term and `grades.ts`'s
 * playoffCollapse-driven tier-cap gate exactly like a real measured value would.
 * `playoffPerformanceTier` below derives its badge from this same overridden number, same as it
 * does for every real span — no separate badge-only override needed anymore.
 *
 * +4.5 (not the literal +5 ceiling) chosen as a clear, comfortably-Platinum-band value, same for
 * all six spans rather than reverse-engineering an individual magnitude per player.
 *
 * Real measured values on record at the time each was added, for the honest paper trail:
 * - Haliburton 2023-25: -0.6 (Bronze Dropper)
 * - Brunson 2024-26: -0.3 (Bronze Dropper)
 * - Anunoby 2024-26: +0.4 (Bronze Riser)
 * - Nowitzki 2009-11: +0.3 (Bronze Riser), 2010-12: -0.1 (Bronze Dropper) — two separate spans,
 *   both asked for in the same request
 * - Towns 2024-26: +0.4 (Bronze Riser)
 */
const NAMED_RISER_OVERRIDE_VALUE = 4.5;
const NAMED_RISER_EXCEPTIONS: ReadonlySet<string> = new Set(
  [
    { name: 'Tyrese Haliburton', spanLabel: '2023-25' },
    { name: 'Jalen Brunson', spanLabel: '2024-26' },
    { name: 'OG Anunoby', spanLabel: '2024-26' },
    { name: 'Dirk Nowitzki', spanLabel: '2009-11' },
    { name: 'Dirk Nowitzki', spanLabel: '2010-12' },
    { name: 'Karl-Anthony Towns', spanLabel: '2024-26' },
  ].map((e) => `${normalizePlayerName(e.name)}|${e.spanLabel}`),
);

function hasNamedRiserException(span: PlayerSpan): boolean {
  return NAMED_RISER_EXCEPTIONS.has(`${normalizePlayerName(span.playerName)}|${span.spanLabel}`);
}

/**
 * 2026-08-15, user's explicit ask, a different shape from the full-override exceptions above:
 * Shai Gilgeous-Alexander's 2024-26 span (raw TAL 97, would read "Greatest peak" on the number
 * alone) carries a real, measured -4.3 (Platinum Dropper) — which clears `grades.ts`'s
 * `PLAYOFF_COLLAPSE_ALL_NBA_CAP_THRESHOLD` (-4) and caps his tier at All-NBA despite the raw
 * number. User's stated reasoning: a real 2x MVP with a championship shouldn't be tier-capped out
 * of "Greatest peak" the same way a genuine, uncontested collapse would — but explicitly asked
 * for a LIGHTER multiplier, not the full override the riser exceptions above use (this isn't
 * "the real number is wrong," it's "the real number is too severe a READ given who this is").
 * Scales the real measured value down instead of replacing it — a real, non-zero playoff-collapse
 * signal survives, it just no longer clears either tier-cap threshold. -4.3 * 0.3 = -1.29,
 * comfortably clear of the -2 MVP-cap threshold (which would ALSO block "Greatest peak," since
 * MVP sits below it in tier order) with real margin, not sitting right at the edge — same
 * "don't just barely clear it" philosophy `ELITE_TALENT_FGA_PENALTY_DAMPENING` (aiDrafter.ts)
 * already uses for an analogous problem.
 */
const NAMED_DAMPENING_SCALE = 0.3;
const NAMED_DAMPENING_EXCEPTIONS: ReadonlyMap<string, number> = new Map(
  [{ name: 'Shai Gilgeous-Alexander', spanLabel: '2024-26' }].map((e) => [
    `${normalizePlayerName(e.name)}|${e.spanLabel}`,
    NAMED_DAMPENING_SCALE,
  ]),
);

function namedDampeningScale(span: PlayerSpan): number | undefined {
  return NAMED_DAMPENING_EXCEPTIONS.get(`${normalizePlayerName(span.playerName)}|${span.spanLabel}`);
}

export function playoffPerformanceBonus(span: PlayerSpan): number {
  if (hasNamedRiserException(span)) return NAMED_RISER_OVERRIDE_VALUE;
  const raw = DATA[span.id] ?? 0;
  const dampening = namedDampeningScale(span);
  return dampening !== undefined ? raw * dampening : raw;
}

export type PlayoffPerformanceTier =
  | 'Platinum Dropper'
  | 'Gold Dropper'
  | 'Silver Dropper'
  | 'Bronze Dropper'
  | 'Bronze Riser'
  | 'Silver Riser'
  | 'Gold Riser'
  | 'Platinum Riser';

/** 2026-08-12: `playoffCollapse.json`'s values are continuous (±5 range, 0.1 resolution), not the
 * old file's exact 8-value set — banded by magnitude instead of exact-matched. Bands split the
 * real ±5 range into even quarters (≤1 / ≤2.5 / ≤4 / ≤5), same 4-tier-per-direction shape as
 * before. */
function tierForMagnitude(bonus: number): PlayoffPerformanceTier {
  const dropper: PlayoffPerformanceTier[] = ['Bronze Dropper', 'Silver Dropper', 'Gold Dropper', 'Platinum Dropper'];
  const riser: PlayoffPerformanceTier[] = ['Bronze Riser', 'Silver Riser', 'Gold Riser', 'Platinum Riser'];
  const bands = bonus < 0 ? dropper : riser;
  const mag = Math.abs(bonus);
  if (mag <= 1) return bands[0];
  if (mag <= 2.5) return bands[1];
  if (mag <= 4) return bands[2];
  return bands[3];
}

export function playoffPerformanceTier(span: PlayerSpan): PlayoffPerformanceTier | null {
  const bonus = playoffPerformanceBonus(span);
  return bonus ? tierForMagnitude(bonus) : null;
}
