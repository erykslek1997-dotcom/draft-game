import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { players } from '../data/players';
import { computeDefensiveImpact } from './defense';
import { ddpmCoverageForSpan, raptorCoverageForSpan, matchupCoverageForSpan, bpm2CoverageForSpan } from './blendedDefenseLookup';
import { spanEndYears } from './era';
import { individualDefenseRate } from './defensiveAccolades';
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
/**
 * Per-source (real − expected) for whichever of DARKO/RAPTOR/matchup cover the span, each against
 * its own `slope * computeDefensiveImpact + intercept` line. Split out of `blendedExcess` so
 * `maximumDefenseBonus` can read the same per-source excesses to decide the agreement cap without
 * recomputing them.
 *
 * A 2026-09-04 experiment (`scripts/trainDefenseModel.ts`) replaced this scalar expectation with
 * a multi-feature model — it predicts real defense materially better out of sample, but wiring it
 * here collapses the excess for the very defenders the correction protects (a good box model
 * leaves no residual), so only the cap raise below shipped.
 */
function coveredExcessParts(span: PlayerSpan): { excess: number; count: number }[] {
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
  return parts;
}

/** Raw, unpooled blend: the count-weighted mean of every tracking source's excess. */
function rawTrackingExcess(span: PlayerSpan): number | null {
  const parts = coveredExcessParts(span);
  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((sum, p) => sum + p.count, 0);
  return parts.reduce((sum, p) => sum + p.excess * p.count, 0) / totalWeight;
}

/**
 * 2026-09-24, user ("niby szum, ale wykazuje pewne wady" — Herro 2023-25 D-TAL 48 vs 26 next door,
 * Tucker 2016-18 12, Durant's late matchup +4.6/+5.75): the single-span excess is a noisy read of a
 * fairly stable trait. Measured on same-player pairs of non-overlapping spans, the blended excess
 * persists (corr 0.70 at a 2-year gap, 0.61 at 4). Predicting a player's NEXT span's excess (MSE):
 * face value 0.759; shrinking toward zero with 0.7 gives 0.674; partial pooling toward the mean of his
 * OTHER non-overlapping spans, weighted 1/gap^2 (nearer spans say more), 0.584; and letting the
 * baseline's pull scale with how much nearby evidence exists (`r = sum(w) / (sum(w) + KAPPA)`) 0.581 —
 * the same accuracy, but a lone far-away span (Jordan 1996-98 against his Wizards years) cannot drag a
 * peak span toward a different career stage. A sudden swing inside one span (a single high-variance
 * matchup source, a couple of bad on/off seasons) is pulled toward the player's own baseline; a
 * sustained one (Garnett, Duncan) is barely touched. Spans without tracking data (the BPM2-only
 * fallback below) are left as they were.
 */
const LAMBDA_NO_HISTORY = 0.7;
const LAMBDA_FULL_HISTORY = 0.55;
const POOL_KAPPA = 0.1;
const MIN_START_GAP_YEARS = 2;

const spanStartYear = (span: PlayerSpan): number => parseInt(span.spanLabel.slice(0, 4), 10);

let excessIndex: Map<string, { id: string; start: number; excess: number }[]> | null = null;
function otherSpanExcesses(span: PlayerSpan): { gap: number; excess: number }[] {
  if (!excessIndex) {
    excessIndex = new Map();
    for (const p of players) {
      const excess = rawTrackingExcess(p);
      if (excess === null) continue;
      const key = normalizePlayerName(p.playerName);
      const list = excessIndex.get(key) ?? [];
      list.push({ id: p.id, start: spanStartYear(p), excess });
      excessIndex.set(key, list);
    }
  }
  const start = spanStartYear(span);
  return (excessIndex.get(normalizePlayerName(span.playerName)) ?? [])
    .filter((e) => e.id !== span.id && Math.abs(e.start - start) >= MIN_START_GAP_YEARS)
    .map((e) => ({ gap: Math.abs(e.start - start), excess: e.excess }));
}

function blendedExcess(span: PlayerSpan): number | null {
  const own = rawTrackingExcess(span);
  if (own !== null) {
    let weightSum = 0;
    let weighted = 0;
    for (const { gap, excess } of otherSpanExcesses(span)) {
      const w = 1 / (gap * gap);
      weightSum += w;
      weighted += w * excess;
    }
    const reliability = weightSum / (weightSum + POOL_KAPPA);
    const lambda = LAMBDA_NO_HISTORY - (LAMBDA_NO_HISTORY - LAMBDA_FULL_HISTORY) * reliability;
    const baseline = weightSum > 0 ? (weighted / weightSum) * reliability : 0;
    return lambda * own + (1 - lambda) * baseline;
  }

  // No existing real-data coverage at all — fall back to BPM2 alone, never blended.
  const bpm2Cov = bpm2CoverageForSpan(span);
  if (bpm2Cov) {
    const { slope, intercept } = getRegression('bpm2Defense');
    return bpm2Cov.avg - (slope * computeDefensiveImpact(span) + intercept);
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

/**
 * 2026-09-04, pool audit vs `peakRapm.json`: a class of low-event interior anchors (Chuck Hayes
 * peakDef 4.1 / D-TAL 68, Tiago Splitter, undersized rim protectors) reads far below their real
 * defensive impact because `computeDefensiveImpact` is block-count-driven and they don't rack up
 * blocks — yet DARKO, RAPTOR **and** matchup all independently read them well above the box. They
 * sit pinned at the +9 cap: raising the cap for them is the only lever, since the excess itself
 * is already large. Gated on **≥2** covered sources each showing a materially positive excess so
 * one noisy source can't unlock the wider ceiling; a single-source strong read still caps at 9.
 * Deliberately below the pre-stocks widening (25) — this is "the box misses your job," not "whole
 * stat categories didn't exist." Taylor/GOAT re-validated after (this feeds `talent.ts` via
 * `darkoDefenseBonus`).
 */
const AGREEMENT_BONUS_CAP = 16;
const AGREEMENT_MIN_SOURCES = 2;
const AGREEMENT_MIN_EXCESS = 0.6;

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
  if (!hasRealTrackingCoverage(span)) return UNCONFIRMED_BPM2_ONLY_MAX_BONUS;
  const agreeingSources = coveredExcessParts(span).filter((p) => p.excess >= AGREEMENT_MIN_EXCESS).length;
  return agreeingSources >= AGREEMENT_MIN_SOURCES ? AGREEMENT_BONUS_CAP : MAX_DARKO_BONUS;
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

/**
 * Coverage-weighted blend of the RAW real values themselves (not excess-over-expectation) —
 * same shape as `blendedExcess`, minus the BPM2 fallback (that population is a different scale
 * this floor was never validated against, see `realValueBonusFloorFactor`'s own docstring).
 */
function blendedRealValue(span: PlayerSpan): number | null {
  const parts: { value: number; count: number }[] = [];
  const ddpmCov = ddpmCoverageForSpan(span);
  if (ddpmCov) parts.push({ value: ddpmCov.avg, count: ddpmCov.count });
  const raptorCov = raptorCoverageForSpan(span);
  if (raptorCov) parts.push({ value: raptorCov.avg, count: raptorCov.count });
  const matchupCov = matchupCoverageForSpan(span);
  if (matchupCov) parts.push({ value: matchupCov.avg, count: matchupCov.count });
  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((sum, p) => sum + p.count, 0);
  return parts.reduce((sum, p) => sum + p.value * p.count, 0) / totalWeight;
}

/**
 * 2026-09-23, user-reported live (Curry reads D-TAL 74-85 off a `darkoDefenseBonus` of 9-12,
 * near/at cap): `blendedExcess` rewards a real value merely beating box-score EXPECTATION, and
 * `computeDefensiveImpact` sits at the low end for a low-activity guard, so its own predicted
 * baseline is close to zero — meaning a real value that is only mildly positive (Curry's ddpm 1 /
 * raptor 2.27, blended ~1.6; the project's own reference point for "average" is DDPM ~0, Chris
 * Paul's case above) reads as a huge relative surprise and nearly saturates the same cap Kevin
 * Garnett's real +3/+4.27 and Tim Duncan's +5/+3.86 earn. Those two motivating cases are not
 * ambiguous on any absolute scale; Curry's is. Confirmed this is a real, structural coupling, not
 * a one-off: reducing ANY box-formula component (roleWeight, rebounding) to fix a DIFFERENT
 * over-crediting problem lowers `computeDefensiveImpact`, which lowers the expectation, which
 * INCREASES this bonus for anyone with real coverage — the two mechanisms fight each other by
 * construction. This floor breaks that coupling by gating on the blended REAL value directly
 * (ramped, not a cliff): the bonus phases out below `REAL_VALUE_BONUS_FLOOR` regardless of how
 * large the box-relative excess reads, and is completely unaffected by any future box-formula
 * change. Scoped to real-tracking sources only (DARKO/RAPTOR/matchup) — BPM2-only spans need
 * their own floor on BPM2's own scale, see `BPM2_ONLY_BONUS_FLOOR`/`BPM2_ONLY_BONUS_FULL` below.
 * (An earlier same-day note comparing Barkley's raw BPM2 2.35 against Duncan's 2.24 to argue this
 * couldn't separate deserving from questionable cases was comparing the wrong players — Duncan
 * has real ddpm/raptor coverage and never actually uses BPM2 for his own bonus at all. Against
 * players who genuinely rely on BPM2 alone, the separation is clean: see below.)
 */
const REAL_VALUE_BONUS_FLOOR = 1.0;
const REAL_VALUE_BONUS_FULL = 2.5;

/**
 * 2026-09-23, "teraz dziadków" — the same coupling fix for the BPM2-only (mostly pre-1997)
 * population `REAL_VALUE_BONUS_FLOOR` explicitly doesn't cover. Checked directly against players
 * who genuinely have zero DARKO/RAPTOR/matchup coverage (not Duncan, who has real coverage and
 * never touches BPM2 for his own bonus): Magic Johnson 2.10, Charles Barkley 2.35 — both clearly
 * below Kareem Abdul-Jabbar's 4.31 (real, corroborated by a genuine 0.45 All-Defensive accolade
 * rate) on the identical scale. A floor here separates them cleanly. Scoped to spans fully WITHIN
 * the stocks-tracked era (`missingStocksShare === 0`) only, same scoping `UNCONFIRMED_BPM2_ONLY_MAX_BONUS`
 * already uses — pre-1974 spans (Russell, Wilt) run through the separate pre-stocks evidence-floor
 * widening instead, and both have their own named D-TAL floors regardless (99, 84), so this can
 * never touch them either way.
 */
const BPM2_ONLY_BONUS_FLOOR = 1.0;
const BPM2_ONLY_BONUS_FULL = 4.0;
/**
 * 2026-09-23, follow-up same day: the floor above, checked directly against the reference suite,
 * cost Jrue Holiday's real 2017-19 peak (blended real ~1.6, same modest range as Curry's — real
 * defense across many sources that each individually read unremarkable) despite his genuine
 * All-Defensive selections in that window. Curry (accoladeRate 0 on every span) and Jrue
 * (accoladeRate 0.6) have near-identical raw blended values, so the raw number alone can't
 * separate a real, independently-recognized plus defender whose per-source excess is modest from
 * a player with no such recognition at all — accoladeRate is exactly that missing signal.
 * Whichever is more generous wins, same one-directional shape as every other floor in this file:
 * real accolade recognition can rescue a modest raw reading, but a raw reading already above
 * `REAL_VALUE_BONUS_FULL` never needs it.
 */
function ramp(value: number, floor: number, full: number): number {
  if (value >= full) return 1;
  return Math.max(0, (value - floor) / (full - floor));
}

function realValueBonusFactor(span: PlayerSpan): number {
  const real = blendedRealValue(span);
  if (real !== null) {
    return Math.max(ramp(real, REAL_VALUE_BONUS_FLOOR, REAL_VALUE_BONUS_FULL), individualDefenseRate(span));
  }
  // No DARKO/RAPTOR/matchup coverage at all. Pre-1974 spans keep their own separate evidence-
  // floor widening (`maximumDefenseBonus`) untouched — this only gates the stocks-tracked-era
  // BPM2-only population.
  const years = spanEndYears(span.spanLabel);
  const missingStocksShare = years.length === 0 ? 0 : years.filter((year) => year < FIRST_OFFICIAL_STOCKS_END_YEAR).length / years.length;
  if (missingStocksShare > 0) return 1;
  const bpm2Cov = bpm2CoverageForSpan(span);
  if (!bpm2Cov) return 1;
  return Math.max(ramp(bpm2Cov.avg, BPM2_ONLY_BONUS_FLOOR, BPM2_ONLY_BONUS_FULL), individualDefenseRate(span));
}

/** Extra defense-component points for `span`, given real defense data — 0 if neither DARKO nor
 * RAPTOR covers this player/span, or if real defense doesn't exceed the box-score expectation
 * (this correction never subtracts). */
export function darkoDefenseBonus(span: PlayerSpan): number {
  const excess = blendedExcess(span);
  if (excess === null) return 0;
  return excess > 0 ? Math.min(maximumDefenseBonus(span), excess * EXCESS_TO_BONUS_SCALE) * realValueBonusFactor(span) : 0;
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

/** Per-source excess of at least this much counts as a "strong" corroborating source for the
 * display-side extra credit in `defensiveTalent.ts` (a higher bar than `AGREEMENT_MIN_EXCESS`
 * 0.6, which only governs the additive cap). */
const DISPLAY_STRONG_SOURCE_EXCESS = 1.0;

/**
 * Raw ingredients of the real-defense correction, exposed for the DISPLAY-only D-TAL extra credit
 * in `defensiveTalent.ts` (`displayExtraDefenseBonus`). Deliberately NOT consumed by
 * `computeTalent` — `talent.ts` stays on the capped `darkoDefenseBonus` above so the raw TAL
 * blend is unchanged. `strongPositiveSourceCount` counts tracking sources (DARKO/RAPTOR/matchup)
 * whose own excess clears `DISPLAY_STRONG_SOURCE_EXCESS`; `hasTrackingCoverage` is false for a
 * BPM2-only span (which must never unlock the display release).
 */
export function realDefenseExcessDetail(span: PlayerSpan):
  | {
      blendedExcess: number;
      strongPositiveSourceCount: number;
      hasTrackingCoverage: boolean;
      onOffDdpm: number | null;
      raptorDefense: number | null;
      matchupDefense: number | null;
      bpm2Defense: number | null;
    }
  | null {
  const blended = blendedExcess(span);
  if (blended === null) return null;
  const strongPositiveSourceCount = coveredExcessParts(span).filter(
    (part) => part.excess >= DISPLAY_STRONG_SOURCE_EXCESS,
  ).length;
  return {
    blendedExcess: blended,
    strongPositiveSourceCount,
    hasTrackingCoverage: hasRealTrackingCoverage(span),
    onOffDdpm: ddpmCoverageForSpan(span)?.avg ?? null,
    raptorDefense: raptorCoverageForSpan(span)?.avg ?? null,
    matchupDefense: matchupCoverageForSpan(span)?.avg ?? null,
    bpm2Defense: bpm2CoverageForSpan(span)?.avg ?? null,
  };
}
