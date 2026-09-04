import type { OffensiveArchetype, PlayerSpan } from '../data/schema';
import { eraBaseline, LEAGUE_PACE_BASELINE } from './era';
import { computeOffensiveProfile } from './offensiveProfile';
import { boxRatesForSpan } from './boxRatesLookup';

/**
 * "Rim pressure" — how much a player forces the defense to send help at the rim / build its game
 * plan around a double every possession. A parallel to floor spacing (arc gravity), which the
 * engine already models via `spacing.ts` / the `gravity` term in `talent.ts`'s `rawComponents`.
 *
 * The gap this closes: `rawComponents.offense`'s `gravity` term only ever credits ARC gravity.
 * Embiid 2023-25 gets +5 (the cap) from 3.4 3PA/game; Shaq 1999-01 gets 0 from his 0.78 rimShare
 * that collapsed defenses every trip. Scoring rate and efficiency are near-equal between the two
 * (Shaq's TS was genuinely dragged by 52% FT shooting), so the whole ~11-point O-TAL gap was the
 * floor-spacing term. A post-centric offense (Twin Towers, Hakeem + A. Davis, peak Shaq/Kareem/
 * Moses) generates real offensive value — rim gravity opens the same kickout/cut geometry arc
 * gravity opens, just initiated from the block — that the engine could not see.
 *
 * Deliberately selective. `rimPressure(span)` is 0 for guards/wings unless they are Slashers /
 * Athletic Finishers, 0 for stretch bigs, 0 for face-up PFs (Garnett), damped for passing hubs
 * (Jokić / Sabonis — a big who draws help via the pass, not raw rim gravity, and is already
 * credited by `centerPlaymakingBonus`), and damped for efficient low-usage lob threats (Capela /
 * Zubac — nobody game-plans a double for them). ~200 spans, all PF/C, read a non-zero term.
 *
 * Ladder rungs are percentiles of the real span distribution (mirrors `spacing.ts`'s
 * `VOLUME_LADDERS`). Regenerate with `scripts/simulateRimPressure.ts` (it prints them) after any
 * pool regeneration or change to `computeOffensiveProfile`.
 */

const paceFactor = (s: PlayerSpan) => LEAGUE_PACE_BASELINE / eraBaseline(s.spanLabel).pace;

// archetype eligibility for rim-pressure credit (0 = never)
const ARCH_ELIGIBILITY: Partial<Record<OffensiveArchetype, number>> = {
  'Post Scorer': 1.0,
  'Roll & Cut Big': 1.0,
  'Versatile Big': 0.85,
  Slasher: 0.5,
  'Athletic Finisher': 0.5,
};
const PROXY_ARCHETYPES = new Set<OffensiveArchetype>(['Post Scorer', 'Roll & Cut Big', 'Versatile Big', 'Slasher']);

// --- baked percentile ladders (see docstring) --- 2026-09-04
const RUNG_Q = [0, 10, 20, 30, 40, 50, 60, 70, 78, 85, 90, 95, 99];
const RIM_VOL_RUNGS = [0.128, 1.564, 2.163, 2.668, 3.154, 3.682, 4.328, 5.002, 5.71, 6.557, 7.402, 8.683, 10.73];
const BIG_PPG_RUNGS = [1.066, 4.764, 5.938, 7.06, 8.261, 9.542, 11.09, 12.905, 14.783, 16.938, 19.163, 22, 27.305];
const BIG_FGPCT_RUNGS = [0.279, 0.418, 0.44, 0.456, 0.469, 0.482, 0.494, 0.507, 0.522, 0.539, 0.557, 0.589, 0.655];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Interpolated percentile (0-100) of `v` against baked rungs. */
function pctileOf(rungs: number[], v: number): number {
  if (v <= rungs[0]) return 0;
  for (let i = 1; i < rungs.length; i++) {
    if (v <= rungs[i]) {
      const w = rungs[i] - rungs[i - 1];
      const f = w === 0 ? 1 : (v - rungs[i - 1]) / w;
      return RUNG_Q[i - 1] + f * (RUNG_Q[i] - RUNG_Q[i - 1]);
    }
  }
  return 100;
}
/** Only the top ~15% of rim volume gets real credit. */
const steep = (p: number) => clamp((p - 78) / 22, 0, 1) * 100;

/** A big who draws help via the pass, not raw rim gravity — already credited by
 * `centerPlaymakingBonus`, so don't double count. Jokić apg~10 -> 0.68 ; A. Davis apg~3 -> 1.0. */
const passingHubDampener = (s: PlayerSpan) => clamp(1.3 - s.box.apg / 16, 0.55, 1.0);

/** A defense only game-plans a double for a real scoring-volume threat, not an efficient
 * low-usage lob threat (Capela ~12 ppg -> 0.4 ; Dwight ~22 -> 0.7 ; Shaq ~29 -> 1.05). */
const scoringVolumeFactor = (s: PlayerSpan) => clamp((s.box.ppg * paceFactor(s) - 12) / 16, 0.4, 1.1);

/**
 * 0-100: how much this player collapses the defense at the rim. Selective — most spans read 0.
 */
export function rimPressure(span: PlayerSpan): number {
  const elig = ARCH_ELIGIBILITY[span.offensiveArchetype];
  if (!elig) return 0;

  const prof = computeOffensiveProfile(span);
  if (prof.hasZoneData) {
    const shareRamp = clamp((prof.rimShare - 0.3) / 0.2, 0, 1); // sags off <0.30, doubles >0.50
    if (shareRamp <= 0) return 0;
    const accFactor = clamp((prof.rimAccuracy - 52) / 20, 0.35, 1.2); // 52% floor, 72%+ = full
    const shareFactor = clamp(0.7 + prof.rimShare * 0.6, 0.7, 1.25);
    const volScore = steep(pctileOf(RIM_VOL_RUNGS, prof.rimShare * span.fga * paceFactor(span)));
    return clamp(
      elig * volScore * accFactor * shareFactor * shareRamp * passingHubDampener(span) * scoringVolumeFactor(span),
      0,
      100,
    );
  }

  // pre-1996-97 box proxy — no zone data. Always a big here (gated to C/PF).
  if (span.primaryPosition !== 'C' && span.primaryPosition !== 'PF') return 0;
  if (!PROXY_ARCHETYPES.has(span.offensiveArchetype)) return 0;
  if (span.box.threePA / Math.max(1, span.fga) > 0.15) return 0; // a stretch four fails
  const proxyElig = span.offensiveArchetype === 'Slasher' ? 0.75 : elig; // a slashing big IS rim gravity
  const volScore = steep(pctileOf(BIG_PPG_RUNGS, span.box.ppg * paceFactor(span)));
  const fgFactor = clamp((pctileOf(BIG_FGPCT_RUNGS, span.box.fgPct) - 30) / 50, 0.4, 1.15);
  return clamp(proxyElig * volScore * fgFactor * passingHubDampener(span), 0, 100);
}

/**
 * Extra `rawComponents.offense` points for rim pressure, on the same additive scale as the
 * `gravity` (arc-spacing) term next to it. Cap 5; baseline 60 so an above-average interior
 * finisher who is not a genuine focal point contributes nothing.
 *
 * The zone-data path (1997+, real rim volume/accuracy/share) uses `K = 8`, so the Shaq/Giannis
 * tier (`rimPressure` ~100) hits the ceiling. The pre-1996-97 box PROXY path is coarser — no zone
 * data, so it can't tell a devastating low-volume finisher (McHale, a #3 option shooting 60% on
 * 15 FGA) from a true 20-FGA focal point — so it gets a gentler `K = 12`: Kareem / Karl Malone /
 * Moses / Ewing land ~+3-4 instead of maxing the cap.
 */
const RIM_PRESSURE_BASELINE = 60;
const RIM_PRESSURE_K_ZONE = 8;
const RIM_PRESSURE_K_PROXY = 12;
const RIM_PRESSURE_CAP = 5;

export function rimPressureOffenseTerm(span: PlayerSpan): number {
  const rp = rimPressure(span);
  if (rp <= 0) return 0;
  const k = computeOffensiveProfile(span).hasZoneData ? RIM_PRESSURE_K_ZONE : RIM_PRESSURE_K_PROXY;
  return clamp((rp - RIM_PRESSURE_BASELINE) / k, 0, RIM_PRESSURE_CAP);
}

/**
 * Team-level rim pressure, 0-100 — how much a starting five collapses the defense in the paint,
 * the offensive-geometry complement to `spacing.ts` (arc gravity). The `scoreTeam` refactor's
 * `fitScore` reads this: a post-centric build (Twin Towers, Hakeem + A. Davis, Shaq-and-shooters)
 * generates real offensive value — forced help, drawn fouls, second-chance possessions — that a
 * spacing-only geometry model reads as pure negative.
 *
 * Three signals, `rimPressure(span)` the anchor and the two box rates additive on top (both from
 * `boxRatesLookup.ts`, the user-supplied per-game export):
 *  - starters-mean `rimPressure(span)` — only PF/C ever score, so a real interior five means ~20-28
 *  - the frontcourt's best free-throw rate (FTA/FGA) — Shaq/Embiid/Barkley/Moses ~0.5-0.6 force
 *    the defense to foul; a stretch big ~0.2 does not. Full 1946-present coverage.
 *  - team offensive rebounds per game across starters, but only where the export's OREB split is
 *    reliable (1983-84+); pre-1983 spans get the neutral midpoint rather than a halved count.
 */
const RIM_TEAM_BASE_ANCHOR = 26; // starters-mean rimPressure that reads as a full interior five
const RIM_TEAM_FT_BONUS_MAX = 16;
const RIM_TEAM_OREB_BONUS_MAX = 12;

export function rimPressureTeam(starters: PlayerSpan[]): number {
  if (starters.length === 0) return 0;
  const base = starters.reduce((sum, p) => sum + rimPressure(p), 0) / starters.length;
  const baseComponent = clamp((base / RIM_TEAM_BASE_ANCHOR) * 100, 0, 100);

  const frontcourt = starters.filter((p) => p.primaryPosition === 'C' || p.primaryPosition === 'PF');
  const maxFtRate = frontcourt.reduce((best, p) => {
    const r = boxRatesForSpan(p);
    return r ? Math.max(best, r.ftRate) : best;
  }, 0);
  // 0.28 FTA/FGA is a middling interior rate; 0.55+ is a genuine foul magnet.
  const ftBonus = clamp((maxFtRate - 0.28) / 0.27, 0, 1) * RIM_TEAM_FT_BONUS_MAX;

  const reliableOreb = starters
    .map((p) => boxRatesForSpan(p))
    .filter((r): r is NonNullable<typeof r> => r !== null && r.orebReliable);
  let orebBonus = RIM_TEAM_OREB_BONUS_MAX * 0.5; // neutral when the era's split isn't trustworthy
  if (reliableOreb.length >= 3) {
    const teamOreb = reliableOreb.reduce((sum, r) => sum + r.orebPerGame, 0);
    // a weak offensive-rebounding five totals ~4-5 OREB/g, a dominant one (Rodman/Barkley/Oakley
    // era, or Shaq + role bigs) ~11-13.
    orebBonus = clamp((teamOreb - 5) / 7, 0, 1) * RIM_TEAM_OREB_BONUS_MAX;
  }

  return clamp(baseComponent + ftBonus + orebBonus, 0, 100);
}
