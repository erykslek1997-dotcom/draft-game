import type { PlayerSpan } from '../data/schema';
import { computeDefensiveImpact } from './defense';
import { ddpmCoverageForSpan, raptorCoverageForSpan, matchupCoverageForSpan, bpm2CoverageForSpan } from './blendedDefenseLookup';
import { spanEndYears } from './era';
import coefficients from '../data/awards/correctionCoefficients.json';

/**
 * Real plus-minus data confirmed a specific, well-evidenced gap: `computeDefensiveImpact` is
 * built entirely from steals/blocks/rebounds, so it structurally can't see the kind of defensive
 * value that shows up in real team-level on/off data but not in counting stats — positioning,
 * rotations, floor coverage, scheme execution. Kevin Garnett (peak real DDPM +4) and Tim Duncan
 * (DDPM +5, sustained 13 seasons) are the clearest cases: both score only 78 from box stats alone
 * despite DARKO showing them among the most valuable real defenders on record. This is a
 * targeted, one-directional correction for exactly that gap — it only ever adds value when real
 * data shows *more* defense than the box score predicts, never subtracts, so players real data
 * confirms are honestly average-or-worse on defense (Curry, Kobe, Durant, Shaq — all checked
 * directly against their own DARKO numbers this session) aren't put at risk of a regression.
 *
 * As of 2026-07-31, reacts to a blend of DARKO ddpm and RAPTOR raptor_defense (see
 * `blendedDefenseLookup.ts`) rather than DARKO alone. Motivated directly: comparing Shane Battier
 * against OG Anunoby found 86% of their TAL gap traced to this correction reacting to a single
 * real source with no independent check — a small, genuinely noisy DARKO read for one span could
 * swing TAL by several points with nothing to catch it. RAPTOR is a second, real, independently-
 * computed defensive estimate (cross-validated at r=0.696 against DARKO on possession-filtered
 * overlapping player-seasons) that makes the signal this correction reacts to more robust.
 *
 * **Blends the two sources' EXCESS values, not their raw inputs.** First version blended the raw
 * ddpm/raptor_defense values into one number and fit a single regression against box defense to
 * that blend. Found empirically that DARKO and RAPTOR have genuinely different relationships with
 * box defense on their own (fit independently: DARKO's own slope 0.087, RAPTOR's own slope
 * 0.114) — not just different noise levels. A regression fit to the raw blend sits awkwardly
 * between the two true relationships, so every span gets judged against a standard neither source
 * actually predicts — this quietly zeroed out real, established defenders: Shaquille O'Neal's
 * 1999-2001 peak has real DARKO +2.0 AND real RAPTOR +2.3, both genuinely plus readings, but
 * blended-then-regressed against the raw-blend line landed at an excess of essentially zero.
 * Fitting each source's OWN regression and taking each source's OWN excess over ITS OWN
 * expectation — then blending the excesses — normalizes away each source's idiosyncratic
 * relationship with box defense before anything gets averaged, so two genuinely-agreeing sources
 * (like Shaq's) correctly produce a genuinely-positive blended excess.
 */
function getRegression(field: 'darkoDefense' | 'raptorDefense' | 'matchupDefense' | 'bpm2Defense'): { slope: number; intercept: number } {
  return coefficients[field];
}

/**
 * Each covered source's own excess (real value minus what ITS OWN regression predicts for this
 * span's box defImpact), coverage-weighted by how many of the span's years each source actually
 * covers — same coverage-weighting philosophy `blendedRealValueLookup.ts` already uses for total
 * value. Returns null only if NEITHER source covers the span at all.
 *
 * Precomputed regressions come from `scripts/precomputeCorrectionCoefficients.ts` (the full
 * ~13,145-span dataset, 2026-07-30) rather than fit live in the browser — see that script's own
 * header for why. Re-run it after any change to `computeDefensiveImpact`, the DARKO/RAPTOR
 * source data, or the dataset itself.
 *
 * **BPM2 (2026-08-05) is a deliberate exception to the coverage-weighted blend above — it is
 * NEVER blended in alongside DARKO/RAPTOR/matchup, only consulted as a last-resort fallback when
 * `parts` is empty.** Per the user's explicit call ("use BPM where we have no stats at all, leave
 * the current model where it already stands"): population-wide validation found BPM2's `dbpm`
 * reads systematically lower than both RAPTOR and DARKO for rim-protecting bigs (a clean
 * PG→C position gradient, mean delta vs RAPTOR -0.91 at C) — a real property of that model, not
 * noise. Blending it into spans that already have real coverage would quietly reintroduce the
 * single-uncorroborated-source risk the RAPTOR/matchup additions were built to fix. Gating it to
 * genuinely uncovered spans means it can only ever ADD a real number where today there is none —
 * in practice this is the **pre-1997-98** population: `raptor.json` was deliberately restricted
 * to `season >= 1998` (see this file's own Bug 1 note above), so despite RAPTOR's source data
 * nominally reaching back to 1977, DARKO and RAPTOR effectively share the same 1997-98 start line
 * in this codebase today. A handful of post-1998 spans also fall through (e.g. Terry Porter,
 * Dennis Rodman's earlier peak) when a player's specific years predate their own DARKO/RAPTOR
 * row coverage. Confirmed directly (2026-08-05): Bill Russell's peak span TAL 50->65, Magic
 * Johnson 93->98, Isiah Thomas 78->87, Terry Porter 78->89 — all previously-zero-coverage spans
 * gaining real credit for the first time. Two real, opposite-direction confirmations that this
 * isn't just "more bonus everywhere": Charles Barkley 92->91 and Chris Mullin 87->83 both DROP —
 * BPM2's own regression against box defense reads their real dbpm as a shortfall relative to
 * what their box stats predict, not an excess, so `darkoDefenseMalus` fires instead. That matches
 * Taylor's own real-world read of Barkley ("never a positive on D") that this project already had
 * on file but had no numeric lever to act on before now.
 */
function blendedExcess(span: PlayerSpan): number | null {
  const defImpact = computeDefensiveImpact(span);
  const parts: { excess: number; count: number }[] = [];

  const ddpmCov = ddpmCoverageForSpan(span);
  if (ddpmCov) {
    const { slope, intercept } = getRegression('darkoDefense');
    parts.push({ excess: ddpmCov.avg - (slope * defImpact + intercept), count: ddpmCov.count });
  }
  const raptorCov = raptorCoverageForSpan(span);
  if (raptorCov) {
    const { slope, intercept } = getRegression('raptorDefense');
    parts.push({ excess: raptorCov.avg - (slope * defImpact + intercept), count: raptorCov.count });
  }
  const matchupCov = matchupCoverageForSpan(span);
  if (matchupCov) {
    const { slope, intercept } = getRegression('matchupDefense');
    parts.push({ excess: matchupCov.avg - (slope * defImpact + intercept), count: matchupCov.count });
  }

  if (parts.length > 0) {
    const totalWeight = parts.reduce((sum, p) => sum + p.count, 0);
    return parts.reduce((sum, p) => sum + p.excess * p.count, 0) / totalWeight;
  }

  // No existing real-data coverage at all — fall back to BPM2 alone, never blended.
  const bpm2Cov = bpm2CoverageForSpan(span);
  if (bpm2Cov) {
    const { slope, intercept } = getRegression('bpm2Defense');
    return bpm2Cov.avg - (slope * defImpact + intercept);
  }

  return null;
}

/** How much of a DDPM-vs-expectation excess turns into extra defense-component points, and a
 * cap on the bonus itself. Both calibrated against the two clearest real cases of hidden
 * defensive value: Duncan's excess is real DDPM +5 sustained across 13 seasons vs. Garnett's
 * single-season peak of +4, so a pure linear scale (with no cap) blows Duncan's score well
 * past Garnett's and past the top of the scale entirely — the cap keeps a truly sustained
 * outlier like Duncan's from running away while still meaningfully lifting Garnett into the
 * same target band (both land in the low-to-mid 90s once the final scale is applied). */
const EXCESS_TO_BONUS_SCALE = 6;
const MAX_DARKO_BONUS = 9;

/**
 * Steals and blocks became official NBA box-score fields in 1973-74. For earlier seasons,
 * `computeDefensiveImpact` is structurally missing two of its three defensive-activity inputs,
 * while BPM2 is the only source in this project that supplies an era-adjusted defensive signal.
 * Applying the modern +9 residual cap to those spans throws away most of that signal: across
 * the full pre-1974 population with positive BPM2 residuals, the uncapped bonus distribution is
 * p90=19.8, p95=22.7 and p99=25.3 component points (`scripts/auditHistoricalTalent.ts`).
 *
 * The wider cap is also gated by the surviving box-score evidence: it begins to open above 15
 * defImpact and reaches its full width at 30. That preserves Russell-level defensive evidence
 * while preventing an ordinary rebound/role profile from receiving a historic rating solely
 * because the span predates official stocks. Mixed spans also interpolate by their missing-
 * stocks share, avoiding a cliff at 1973-74. This remains source/profile based, not a named-
 * player boost; BPM2 is still a last resort behind DARKO/RAPTOR/matchup coverage.
 */
const FIRST_OFFICIAL_STOCKS_END_YEAR = 1974;
const MAX_PRE_STOCKS_BPM2_BONUS = 25;
const PRE_STOCKS_EVIDENCE_FLOOR = 15;
const PRE_STOCKS_FULL_EVIDENCE = 30;

/**
 * 2026-08-14, user's own proposal (Kareem-vs-Duncan comparison): a span with real DARKO/RAPTOR/
 * matchup tracking-data confirmation and a span backed by BPM2 alone (a historical box-score
 * estimate, not real plus-minus) were hitting the exact same +9 cap — Duncan's 2002-04 excess is
 * confirmed by TWO independent real sources (DDPM +5, RAPTOR +4.35); Kareem's 1975-77 excess is
 * BPM2-only (no DARKO/RAPTOR/matchup coverage exists that far back) yet saturated the identical
 * ceiling. User's framing: "a small minus for lacking precise stats" is fair. Scoped to spans
 * fully WITHIN the stocks-tracked era (`missingStocksShare === 0`) only — a pre-1974 span is
 * ALSO BPM2-only, but that's the pre-stocks widening case just below (a genuinely different
 * problem: whole stat categories never existed, not just no modern plus-minus confirmation), so
 * this reduction and that widening are mutually exclusive, never both applied to the same span.
 * Full-archive blast radius checked before shipping (162 spans capped between the new 7.5 and the
 * old 9, some already below 7.5 so genuinely unaffected) — real Taylor top-10/GOAT-40 validation
 * re-run after, not just eyeballed on the two motivating names.
 */
const UNCONFIRMED_BPM2_ONLY_MAX_BONUS = 7.5;

function hasRealTrackingCoverage(span: PlayerSpan): boolean {
  return Boolean(ddpmCoverageForSpan(span) || raptorCoverageForSpan(span) || matchupCoverageForSpan(span));
}

function maximumDefenseBonus(span: PlayerSpan): number {
  const years = spanEndYears(span.spanLabel);
  if (years.length === 0) return MAX_DARKO_BONUS;
  const missingStocksShare = years.filter((year) => year < FIRST_OFFICIAL_STOCKS_END_YEAR).length / years.length;
  if (missingStocksShare > 0) {
    const evidenceRange = PRE_STOCKS_FULL_EVIDENCE - PRE_STOCKS_EVIDENCE_FLOOR;
    const evidenceFactor = Math.max(
      0,
      Math.min(1, (computeDefensiveImpact(span) - PRE_STOCKS_EVIDENCE_FLOOR) / evidenceRange),
    );
    return (
      MAX_DARKO_BONUS +
      missingStocksShare * evidenceFactor * (MAX_PRE_STOCKS_BPM2_BONUS - MAX_DARKO_BONUS)
    );
  }
  return hasRealTrackingCoverage(span) ? MAX_DARKO_BONUS : UNCONFIRMED_BPM2_ONLY_MAX_BONUS;
}

/**
 * 2026-07-31, user comparison of Shane Battier (real DDPM excess +1.92, TAL 65) against OG
 * Anunoby (excess +0.33, TAL 58): checked directly and confirmed **86% of their entire 7-point
 * TAL gap** came from this one linear scale alone (6.04 of 7 points, `excess * 0.4 blend * 2.15
 * scale`) — a real, well-evidenced finding.
 *
 * Tried subtracting a flat noise floor (0.5) from the excess before scaling, to require a
 * confirmed minimum real signal before any credit counts (calibrated to be a no-op for Duncan
 * 4.03/Garnett 4.25/Ben Wallace 3.59/Battier 2.34, all still exactly or effectively at the cap
 * afterward — the anchors this correction was built around were correctly preserved). But the
 * blast radius was much broader than the two players it was aimed at: it clawed back real signal
 * from a whole tier of legitimately-good-but-not-legendary defenders across the board (Jimmy
 * Butler -8, Dirk Nowitzki -7, Doncic -3, Dwight Howard -3, Kyle Lowry -3), several of them
 * fixes from *earlier this same session*. Worst of all, **Anunoby himself ended up at 52** —
 * below his original 54 baseline from before any of today's work — the exact opposite of what
 * the whole investigation was trying to accomplish. Taylor top-10 (0.830 -> 0.782), GOAT-40
 * (0.608 -> 0.603), and defensive grades (7/46 -> 8/46 out of band) all moved the wrong way too.
 * Reverted — a flat floor is too blunt an instrument for this; it suppresses real signal across
 * the whole middle of the distribution, not just the small residuals it was meant to target.
 *
 * The underlying proportionality question (should a +0.33 excess and a +4 excess really move TAL
 * at the same linear rate?) is still real, but the actual fix ended up being a different shape
 * of change: rather than reshaping DARKO's own curve, the user supplied a second real data
 * source (RAPTOR) immediately after this revert, and blending it in (see `blendedExcess` above
 * and `blendedDefenseLookup.ts`) makes the input to this exact mechanism more robust instead —
 * a small single-source residual now has to agree with a second independent source before it can
 * swing TAL, rather than the shape of the reaction curve being changed.
 */

/** Extra defense-component points for `span`, given real defense data — 0 if neither DARKO nor
 * RAPTOR covers this player/span, or if real defense doesn't exceed the box-score expectation
 * (this correction never subtracts). */
export function darkoDefenseBonus(span: PlayerSpan): number {
  const excess = blendedExcess(span);
  if (excess === null) return 0;
  return excess > 0 ? Math.min(maximumDefenseBonus(span), excess * EXCESS_TO_BONUS_SCALE) : 0;
}

/** The mirror-image case: real DARKO data confirming the box score *overestimates* defensive
 * value. Chris Paul's 2007-09 peak is the clearest evidence — box-only defImpact (steals-heavy
 * activity + Point-of-Attack role weight) reads as one of the best-ever PG defensive spans, but
 * his real DDPM for those seasons is ~0 (average), not the plus-defender read the box score
 * implies. Capped noticeably lower than the bonus's own cap (5 vs 9): subtracting confirmed
 * value carries more downside risk than adding it (a false negative here visibly undersells a
 * real defender; the bonus side already accepts that asymmetry deliberately), so this stays the
 * more conservative half of the pair. Same never-both-directions-at-once shape as the bonus:
 * only fires on a confirmed real shortfall, never on a tiny/noisy residual since `excess`/
 * `shortfall` scale by the same regression slope either way. */
const SHORTFALL_TO_MALUS_SCALE = 6;
const MAX_DARKO_MALUS = 5;

/** The uncapped malus, exposed so a caller that isn't feeding `computeTalent` can pick its own
 * cap. `MAX_DARKO_MALUS = 5` is conservative *because* it feeds TAL, but it saturates hard:
 * 1,477 spans sit exactly at it, which flattens a mildly-negative defender (Chauncey Billups,
 * real DDPM -1.0) into the same reading as a genuinely bottom-decile one (Damian Lillard, -2.0).
 * `defensiveTalent.ts` — display only — caps this higher to recover that separation. */
export function darkoDefenseShortfall(span: PlayerSpan): number {
  const excess = blendedExcess(span);
  if (excess === null) return 0;
  const shortfall = -excess;
  return shortfall > 0 ? shortfall * SHORTFALL_TO_MALUS_SCALE : 0;
}

export function darkoDefenseMalus(span: PlayerSpan): number {
  return Math.min(MAX_DARKO_MALUS, darkoDefenseShortfall(span));
}
