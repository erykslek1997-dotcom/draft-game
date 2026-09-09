import type { PlayerSpan, Position } from '../data/schema';
import { HIGH_USAGE_ARCHETYPE_WEIGHT, RIM_PROTECTOR_ROLES, PERIMETER_DEFENDER_ROLES, normalizePlayerName } from '../data/schema';
import {
  STARTER_SLOTS,
  ROSTER_SIZE,
  CAP_LIMIT,
  TEAM_COUNT,
  isPickCapLegal,
  isRealPositionFit,
  isPositionEligible,
  buildCheapestLookup,
  canFillFromLookup,
} from './positions';
import { computeOffensiveTalent, computeDefensiveTalent } from './talent';
// 2026-08-19: every real-talent read below uses `effectiveTalent` (tier-capped, the same number
// the displayed badge shows), not raw `computeTalent` — see that function's own docstring
// (grades.ts) for why.
import { effectiveTalent } from './grades';
import { autoAssignRotation, projectedStarterValue, totalMinutesForPlayer, MAX_MINUTES_PER_PLAYER, GAME_MINUTES } from './rotation';
import { maxSustainableMinutes } from './durability';
import { computeOffensivePortability, computeDefensivePortability } from './portability';
import { computeSpacing } from './spacing';
import { isRimGravityScorer, isSelfSufficientEngine } from './offensiveProfile';
import { isD1D2D3Player } from './d1d2d3Lookup';
import { isSixthManProfile } from './sixthMan';
import { draftPool } from '../data/draftPool';
import { DRAFT_EXPERIMENT } from './draftExperiment';
import { madeAllNbaInSpan } from './allNbaLookup';
import { playoffBpm2ForSpan } from './playoffBpm2Lookup';

// ---------------------------------------------------------------------------
// dev debug — off by default, no cost on the hot path. `draft.ts` flips it on from a dev-only
// `window.draftDebug()` console hook (see GameShell). When on, every `pickForAi` call prints the
// finalists' full value breakdown and the lottery roll that chose between them, so a surprising
// AI pick can be traced to the exact term that inflated (or sank) its score.
// ---------------------------------------------------------------------------
let aiDraftDebug = false;
export function setAiDraftDebug(on: boolean): void {
  aiDraftDebug = on;
}

type ScoredEntry = { player: PlayerSpan; value: number; talent: number; debug?: Record<string, number> };

function logDraftDebug(
  roster: PlayerSpan[],
  pickNumber: number | undefined,
  top: ScoredEntry[],
  weights: number[],
  roll: number,
  totalWeight: number,
  chosenIndex: number,
): void {
  const label = pickNumber != null ? `pick #${pickNumber}` : 'pick';
  // eslint-disable-next-line no-console
  console.groupCollapsed(
    `%c[draft] ${label} — roster ${roster.length}/${ROSTER_SIZE} → ${top[chosenIndex]?.player.playerName} ${top[chosenIndex]?.player.spanLabel}`,
    'color:#4f8cff',
  );
  // eslint-disable-next-line no-console
  console.log(
    `lottery roll ${roll.toFixed(2)} / ${totalWeight} (weights ${weights.join(':')}) → index ${chosenIndex}`,
  );
  // eslint-disable-next-line no-console
  console.table(
    top.map((entry, i) => ({
      '': i === chosenIndex ? '►' : '',
      player: `${entry.player.playerName} ${entry.player.spanLabel}`,
      value: Number(entry.value.toFixed(1)),
      ...(entry.debug
        ? Object.fromEntries(
            Object.entries(entry.debug)
              .filter(([, v]) => Math.abs(v) > 0.05)
              .map(([k, v]) => [k, Number(v.toFixed(1))]),
          )
        : {}),
    })),
  );
  // eslint-disable-next-line no-console
  console.groupEnd();
}

/** A player this good is a generational, top-of-history peak (Jordan/LeBron/Curry/Hakeem
 * tier) that a real GM drafts regardless of roster redundancy — the "already have two
 * high-usage guys" discount below is real and correct for ordinary stars (a second shot-heavy
 * wing does genuinely compete for touches), but it was firing the same way on LeBron and Curry
 * as it does on a merely-good third scorer, sliding max-or-near-max talent (TAL 96-100) many
 * picks past where the peak-value principle says it should go. Scoped narrowly to the very top
 * of the talent scale so ordinary redundancy logic is untouched for everyone else. */
const ELITE_TALENT_REDUNDANCY_EXEMPTION = 95;

/**
 * 2026-08-14, user-diagnosed (real draft export: Dwyane Wade 2008-10, TAL97/FGA20.8, fell to
 * pick #42 — well past Terry Porter 1989-91, TAL90/FGA11.9, picked #20). Root-caused, not
 * guessed: `value = talent*rampedNeed - fga*fgaPenalty - ...` treats FGA cost identically for
 * every talent level, but `fgaPenalty` itself rises with pressure (BASE_FGA_PENALTY 0.4 up to
 * MAX_FGA_PENALTY 1.3 — see those constants below). Solving `talent_A - talent_B = (fga_A -
 * fga_B) * fgaPenalty` for Wade vs Porter: the crossover sits at fgaPenalty≈0.79 — comfortably
 * inside the real 0.4-1.3 range, so at ordinary late-draft pressure a cheaper very-good player
 * mechanically outvalues a more expensive true peak on this term alone, the exact same shape of
 * problem `ELITE_TALENT_REDUNDANCY_EXEMPTION` above already exists to fix for the redundancy
 * discount ("a real GM drafts [him] regardless of X") — just via a different term. Same
 * philosophy, same threshold, applied to `fgaPenalty` instead: SOFTENED (not waived, unlike the
 * redundancy exemption) — a true peak still has to fit under the cap at all (`isPickCapLegal`
 * governs that separately and is untouched), this only stops the soft cost term from
 * mechanically discounting him below a cheaper merely-very-good alternative. 0.5 keeps a real
 * peak (talent 7 above a candidate, Wade vs Porter's exact gap) ahead across the ENTIRE real
 * pressure range 0.4-1.3, not just at one end — solved directly: 7 >= (fga_A-fga_B) *
 * MAX_FGA_PENALTY * dampening requires dampening <= ~0.6; 0.5 leaves real margin rather than
 * sitting right at the edge.
 *
 * 2026-09-09: a hard gate at `ELITE_TALENT_REDUNDANCY_EXEMPTION` (95) meant a genuine high-usage
 * star just below it ate the FULL FGA penalty — measured directly, T-Mac 2000-02 (eTAL 92, FGA
 * 21.6) fell past pick 96 (round 7) in the AI order across 4 seeds while zero of 29 real human
 * rosters left him that late. The 0.5 endpoint and the >=95 behaviour are unchanged; the gate is
 * now a linear ramp so a star at eTAL 88 gets nothing and one at 92 gets ~0.71 dampening —
 * partial relief proportional to how elite the peak actually is, the same "softened not waived"
 * shape the 0.5 was chosen for.
 */
const ELITE_TALENT_FGA_PENALTY_DAMPENING = 0.5;
/** Below this eTAL the FGA-penalty dampening does not apply at all; from here it ramps linearly
 * down to `ELITE_TALENT_FGA_PENALTY_DAMPENING` at `ELITE_TALENT_REDUNDANCY_EXEMPTION`. */
const ELITE_TALENT_FGA_DAMPENING_RAMP_START = 88;

function eliteTalentFgaPenaltyDampening(talent: number): number {
  if (talent <= ELITE_TALENT_FGA_DAMPENING_RAMP_START) return 1;
  if (talent >= ELITE_TALENT_REDUNDANCY_EXEMPTION) return ELITE_TALENT_FGA_PENALTY_DAMPENING;
  const progress =
    (talent - ELITE_TALENT_FGA_DAMPENING_RAMP_START) /
    (ELITE_TALENT_REDUNDANCY_EXEMPTION - ELITE_TALENT_FGA_DAMPENING_RAMP_START);
  return 1 - progress * (1 - ELITE_TALENT_FGA_PENALTY_DAMPENING);
}

/**
 * User-diagnosed (2026-08-05, playtest: "Howard top4, skąd to się bierze?"): the draft VALUE
 * formula's flat `- fga * fgaPenalty` term doesn't distinguish a genuine top-of-history peak
 * from a merely-very-good player who's simply cheap because he's not an offensive engine — a
 * player with real elite TAL but unusually low FGA gets the SAME dollar-amount cost credit as
 * one with equally low FGA but earned it by being a true low-usage floor-spacer, and that credit
 * is proportionally decisive exactly at the tier where a handful of points separates "legendary
 * peak" from "very good, cheap." Confirmed directly: Dwight Howard's 2009-11 peak (TAL94,
 * FGA11.7 — the lowest FGA of any TAL90+ span in the whole pool by a wide margin) computes to
 * value 89.3, **rank #7 of 328** in the deterministic round-1 ranking, ahead of Hakeem, Shaq,
 * and just behind Kareem — not because his TAL rivals theirs, but because his FGA is roughly
 * half of theirs (Hakeem 20.4, Shaq 18.2, Kareem 19.0) at a similar TAL.
 *
 * Root-caused, not guessed: checked every TAL>=85 center against real per-position-band FGA
 * percentiles (`scripts` — temp, not kept) before picking a threshold. **Scoped to exactly the
 * population that's actually cheap because it isn't an offense** — `primaryPosition === 'C'`
 * (this pattern doesn't occur at PF at all in this dataset, checked directly) AND
 * `computeOffensiveTalent(p) < LOW_OFFENSE_BIG_OTAL_CEILING` AND
 * `p.fga < LOW_USAGE_BIG_FGA_CEILING`. Both conditions matter: OTAL alone would also catch real
 * high-volume post scorers whose O-TAL reads low on the ladder despite taking 18-21 shots a game
 * (peak Hakeem, Ewing, DeMarcus Cousins) — adding the FGA<15 condition leaves every one of those
 * genuinely untouched (checked directly: zero false positives among TAL>=85 centers with FGA>=15
 * regardless of how low their OTAL reads) and narrows the population to exactly 6 span entries
 * in the whole ~3100-span pool: three Dwight Howard spans, Alonzo Mourning 1998-00, David
 * Robinson's declining-usage 1997-99, and Shaq's declining-usage 2003-05 — real "cheap because
 * genuinely low-usage defensive anchor" cases, not a broad rim-protector penalty. Elite
 * playmaking guards with similarly low FGA (Magic, Stockton, Chris Paul, Nash) are structurally
 * excluded by the position check alone — they earn their low FGA through real, high O-TAL
 * playmaking value, which this malus was never meant to touch.
 *
 * Proportional to the actual shortfall (not a cliff) and capped low — this should nudge a real
 * outlier down a handful of ranks, not erase a genuine talent edge the way an uncapped penalty
 * risked doing for e.g. the old MAX_FGA_PENALTY before it was lowered (see that constant's own
 * history above).
 */
const LOW_OFFENSE_BIG_OTAL_CEILING = 75;
const LOW_USAGE_BIG_FGA_CEILING = 15;
const LOW_USAGE_BIG_MALUS_SCALE = 1;
const MAX_LOW_USAGE_BIG_MALUS = 5;

function lowUsageBigMalus(p: PlayerSpan): number {
  if (p.primaryPosition !== 'C') return 0;
  if (computeOffensiveTalent(p) >= LOW_OFFENSE_BIG_OTAL_CEILING) return 0;
  if (p.fga >= LOW_USAGE_BIG_FGA_CEILING) return 0;
  const shortfall = LOW_USAGE_BIG_FGA_CEILING - p.fga;
  return Math.min(MAX_LOW_USAGE_BIG_MALUS, shortfall * LOW_USAGE_BIG_MALUS_SCALE);
}

/**
 * 2026-08-05, user explicit ask (John Stockton: "drafted too fast"): the same underlying dynamic
 * `lowUsageBigMalus` exists to fix — a real elite TAL at a very low FGA cost dominates the draft
 * VALUE formula regardless of whether a real GM would actually take him that early — but that
 * malus is deliberately gated to `primaryPosition === 'C'` AND excludes high-O-TAL players by
 * design, specifically so Magic/Stockton/Chris Paul/Nash-type elite playmakers (who genuinely
 * earn their low FGA through real, high-O-TAL playmaking value) are untouched. The user is now
 * explicitly asking to touch exactly that excluded population anyway — a real, considered
 * decision to reopen, not a bug fix, so scoped as its own smaller, separate malus rather than
 * loosening the original's gates (which would also affect Dwight Howard/Mourning/etc. in ways
 * never asked for).
 *
 * No O-TAL gate at all (the whole point), no position restriction, but **capped much lower**
 * than Howard's (3 vs 5) and requires a much higher TAL floor (85) — this population (elite
 * low-usage playmakers) does earn real value through their game, just apparently not enough for
 * a real GM to draft them quite this fast on cap efficiency alone. Excludes C entirely to avoid
 * double-counting with `lowUsageBigMalus`, which already covers that population with its own
 * larger, purpose-built cap.
 */
const ELITE_LOW_USAGE_TAL_FLOOR = 85;
const ELITE_LOW_USAGE_FGA_CEILING = 15;
const ELITE_LOW_USAGE_MALUS_SCALE = 0.4;
const MAX_ELITE_LOW_USAGE_MALUS = 3;

function eliteLowUsageDraftMalus(p: PlayerSpan): number {
  if (p.primaryPosition === 'C') return 0;
  if (p.fga >= ELITE_LOW_USAGE_FGA_CEILING) return 0;
  if (effectiveTalent(p) < ELITE_LOW_USAGE_TAL_FLOOR) return 0;
  const shortfall = ELITE_LOW_USAGE_FGA_CEILING - p.fga;
  return Math.min(MAX_ELITE_LOW_USAGE_MALUS, shortfall * ELITE_LOW_USAGE_MALUS_SCALE);
}

/**
 * 2026-08-06, user's own hand-graded sub-ranking within the "Greatest peak" tier (the CSV export
 * this file's own value formula doesn't otherwise distinguish — every one of these 16 sits at
 * TAL94-98, close enough that ordinary need/FGA-penalty noise can and does flip their relative
 * draft order).
 *
 * Keyed by (name, spanLabel) — same shape as `POSITION_OVERRIDES` in players.ts — not name
 * alone: a flat per-player bonus would apply identically to every span of that person the AI
 * might ever see, including a real decline-era Jordan span far below his actual "Greatest peak"
 * one. The user's tier list is about these specific peak seasons, not a blanket "always prefer
 * this person" rule, so only the exact span from the Greatest Peak export gets the bonus
 * (`greatestPeakTierBonus` below actually matches by name + TAL-equality — see its own
 * docstring for why, a separate real bug fix, not a reopening of this scoping decision).
 *
 * **2026-08-07 follow-up, magnitude softened, user's own explicit ask**: the original bonus
 * (1000/600/200, "twardy priorytet" — hard priority, confirmed to mean dominates need/talent/FGA
 * entirely) was working exactly as designed once the name-matching bug above was fixed — but
 * fixing that bug made a real side effect fully visible for the first time: these 16 names now
 * drafted in literally 30/30 simulated games (measured directly), which reads as scripted/boring
 * over a longer play session, the user's own follow-up complaint. Rather than reopen the
 * "should legends get a real, permanent priority" decision itself, softened the MAGNITUDE from an
 * absolute lock to a strong-but-beatable nudge: 60/35/15, chosen empirically (grid-tested via a
 * temp simulation script, not guessed) to land these 16 in the pick-1-8 range the large majority
 * of the time while leaving real headroom for an unusually cheap/high-need non-tiered elite
 * (TAL 90+) to occasionally win the pick outright — measured: tier-1 names' average pick moved
 * from a locked ~1-3 to ~2-5 with real spread, still comfortably early, no longer deterministic.
 */
const GREATEST_PEAK_DRAFT_TIERS: Record<string, 1 | 2 | 3> = {
  'michael jordan|1988-90': 1,
  'lebron james|2008-10': 1,
  'stephen curry|2014-16': 1,
  'larry bird|1985-87': 2,
  'hakeem olajuwon|1992-94': 2,
  'nikola jokic|2023-25': 2,
  'magic johnson|1988-90': 2,
  'david robinson|1990-92': 2,
  'tim duncan|2001-03': 2,
  'kevin garnett|2002-04': 2,
  'kevin durant|2012-14': 2,
  'giannis antetokounmpo|2020-22': 2,
  'shai gilgeous-alexander|2024-26': 3,
  'anthony davis|2018-20': 3,
  'victor wembanyama|2024-26': 3,
  // 2026-08-06 fix: the '2023-25' span (his raw-highest-TAL one, TAL96) has
  // `maxSustainableMinutes === 0` — enough real missed games in that stretch that
  // `isDraftableDurability` in this same file excludes it from the AI's candidate pool
  // entirely, so a tier bonus keyed to it would never fire (confirmed directly: he sat
  // undrafted through a full auto-finished draft). '2021-23' is the closest actually-
  // draftable equivalent — same TAL96, same "Greatest peak" tier per grades.ts.
  'joel embiid|2021-23': 3,
};
const GREATEST_PEAK_TIER_BONUS: Record<1 | 2 | 3, number> = { 1: 60, 2: 35, 3: 15 };

/**
 * 2026-08-07, real bug found from live-game reports ("Jordan spadł 4 razy + raz LeBron" — Jordan
 * and LeBron sliding to picks 25-27 despite this exact tier-1 bonus existing to prevent it).
 * Root-caused precisely, not guessed: the real game (`draft.ts`) never hands `pickForAi` the
 * full multi-span `draftPool` this map was written against — it uses `peakDraftPool.ts`, which
 * keeps exactly ONE span per real player (their single highest-`computeTalent` one), with ties
 * broken by first-in-array-order, which is arbitrary/unrelated to which span this hardcoded list
 * happens to name. Checked directly: Jordan has FIVE separate spans tied at his own max (TAL 98:
 * 1986-88, 1987-89, 1988-90, 1989-91, 1990-92) and `peakDraftPool` happened to keep `1987-89` —
 * not the `1988-90` this map names, so the exact-span key match failed and Jordan got ZERO of
 * his +1000 bonus in every real game, falling back to ordinary need/talent scoring like anyone
 * else. LeBron has EIGHT ties at TAL 98 and landed on `2010-12` in the peak pool, not this map's
 * `2008-10` — same failure. Curry (`2014-16`) and Wembanyama (`2024-26`) happened to match by
 * coincidence, which is exactly why only Jordan/LeBron showed the symptom in the user's reports.
 *
 * Fix: match by NAME, and require the candidate's own `computeTalent` to equal the TAL of the
 * exact span this map names (precomputed once below from the real `draftPool`, not re-derived
 * per call) — any span TIED at that same real peak value counts as "this player's greatest
 * peak," which `peakDraftPool`'s own selection logic already guarantees is the only span of
 * that person pickForAi ever sees in the real game anyway. This does NOT reopen the original
 * "must be a specific named peak span, not just any span of this person" protection this map's
 * own docstring describes (e.g. never letting a real decline-era Jordan span qualify) — a
 * lower-TAL span still fails the equality check outright, exactly as before.
 */
const GREATEST_PEAK_TIER_BY_NAME: Map<string, { tier: 1 | 2 | 3; tal: number }> = new Map();
for (const [key, tier] of Object.entries(GREATEST_PEAK_DRAFT_TIERS)) {
  const separatorIndex = key.indexOf('|');
  const name = key.slice(0, separatorIndex);
  const spanLabel = key.slice(separatorIndex + 1);
  const span = draftPool.find((p) => normalizePlayerName(p.playerName) === name && p.spanLabel === spanLabel);
  if (span) GREATEST_PEAK_TIER_BY_NAME.set(name, { tier, tal: effectiveTalent(span) });
}

function greatestPeakTierBonus(p: PlayerSpan): number {
  if (!DRAFT_EXPERIMENT.greatestPeakBonus) return 0;
  const entry = GREATEST_PEAK_TIER_BY_NAME.get(normalizePlayerName(p.playerName));
  if (!entry || effectiveTalent(p) < entry.tal) return 0;
  return GREATEST_PEAK_TIER_BONUS[entry.tier];
}

/** See the "steal" safety-net's own comment on its one use site (`pickForAi`) for the full case.
 * Measured against Kevin Garnett 2002-04's own real observed range (picks 9-15 across 15 fresh
 * drafts, `scripts` — temp, not kept) — comfortably past the worst legitimate lottery outcome
 * seen, so this only ever fires on a genuine tail case, never on ordinary variance. */
const STEAL_PICK_THRESHOLD = 20;

/**
 * 2026-08-06, user-reported (playtest: "centers playing at other positions... może brakuje
 * graczy na innych pozycjach w bazie?"). Root-caused, not guessed — measured directly
 * (`scripts/checkOffPositionBreakdown.ts`, `scripts/checkCenterOverdraft.ts`,
 * `scripts/checkTalentByPosition.ts`): it's NOT a database shortage (PF actually has slightly
 * *more* distinct players than C, 64 vs 65 — essentially even). Two real formula-level causes
 * instead: (1) the top-16 average raw TAL for centers (92.2) is higher than every other
 * position, PF included (83.1) — so pure best-player-available keeps grabbing centers even once
 * a team's real need is met; (2) nearly 2x as many centers as PFs carry the `RIM_PROTECTOR_ROLES`
 * tag (60 vs 39), so the existing `lacksRimProtection` need-bonus above gets satisfied by another
 * center almost twice as often as by a real PF. Net effect measured directly: teams draft 2.5
 * centers per roster on average vs only 1.4 PFs, so the leftover centers get stuffed into the PF
 * starter slot by `autoAssignRotation`'s fallback tiers — exactly the "centers playing at other
 * positions" pattern reported (`PF<-C` was 64 of 177 total off-position starter cases, by far the
 * single largest pattern, more than triple the next-largest).
 *
 * Fix: extend the SAME discount mechanism already used for high-usage offensive redundancy
 * (`needs.usageWeight` above) to same-PRIMARY-POSITION redundancy generally — not center-
 * specific, so it also softens the smaller SF/SG/PG echoes of the same pattern in the data. Once
 * a roster already has real depth at a position (starter + 1 real backup, i.e. 2 real fits),
 * further same-position picks get discounted, scaling with how far past that the roster already
 * is. Same `ELITE_TALENT_REDUNDANCY_EXEMPTION` gate as the usage-weight discount — a genuine
 * top-of-history peak still gets drafted regardless of how many same-position players a team
 * already has, this only discourages piling up ordinary/good-but-not-legendary same-position
 * depth past what the roster can actually use.
 */
const REAL_FIT_REDUNDANCY_THRESHOLD = 2;
const REAL_FIT_REDUNDANCY_DISCOUNT = 0.4;
const MAX_REAL_FIT_REDUNDANCY_DISCOUNT = 1.5;

/**
 * 2026-08-16, user's explicit strategic principle ("centra i tak się znajdą" — teams should
 * prioritize backup PG/SG/SF/PF first, since a real backup center can always be found later):
 * root-caused via a direct diagnostic (`scripts/_checkZeroMinutePlayers.ts`, deleted after use,
 * 4x16 teams) that a THIRD real-fit C (past the general redundancy threshold above) drafted onto a
 * roster still ends up at literally ZERO real minutes ~3% of the time (Marcus Camby drafted behind
 * an already-covered Rudy Gobert, matching the user's own screenshot exactly) — real cap spent for
 * nothing. The general `samePositionRedundancyDiscount` above already exists for exactly this and
 * fires the same way at every position, but its 1.5-point cap on `need` isn't enough to outweigh a
 * genuinely high-TAL redundant center's own raw talent edge (the same "need is a MULTIPLIER on
 * structurally higher big-man TAL" dynamic already root-caused twice this session, for PG bench
 * share and for bench self-creators).
 *
 * Deliberately position-SPECIFIC this time, not a reopening of the general mechanism's own
 * "not center-specific" design choice — every measurement this session (cheap-tier pool inclusion,
 * zero-real-fit-depth rate, this zero-minute check) consistently shows C as the one position that's
 * genuinely, structurally deep and recoverable late, unlike PG/SF's real scarcity. A flat
 * ACROSS-THE-BOARD "prefer non-C" bonus was already tried once this session and reverted for
 * overcorrecting (severe-backup rate 18.8%->23.4%, guards forced into a newly-EMPTY C slot) — this
 * is narrower: it only strengthens the EXISTING redundancy discount specifically for C, still gated
 * on the same `REAL_FIT_REDUNDANCY_THRESHOLD`, so it can never fire on a roster that doesn't
 * already have 2 real C fits (i.e., it can never cause C to go empty — the exact failure mode of
 * the reverted attempt).
 *
 * Measured (`scripts/_checkCRedundancyEffect.ts`, deleted after use, 4x16 teams): zero-total-
 * minute drafted players dropped 0.39%->0.20% (halved), while C's own zero-real-fit-depth rate
 * stayed at 0.0% — confirming the exact failure mode of the earlier flat attempt did NOT
 * reproduce here. Severe-backup rate held in the same healthy band (7.8%->9.4%, within this
 * session's run-to-run noise). `npx tsc -b`/`npm test` clean.
 */
const C_REDUNDANCY_EXTRA_DISCOUNT_SCALE = 1.5;
const MAX_C_REDUNDANCY_EXTRA_DISCOUNT = 4;

function samePositionRedundancyDiscount(roster: PlayerSpan[], p: PlayerSpan): number {
  const realFits = roster.filter((r) => isRealPositionFit(r, p.primaryPosition)).length;
  if (realFits < REAL_FIT_REDUNDANCY_THRESHOLD) return 0;
  const excess = realFits - REAL_FIT_REDUNDANCY_THRESHOLD + 1;
  const base = Math.min(MAX_REAL_FIT_REDUNDANCY_DISCOUNT, excess * REAL_FIT_REDUNDANCY_DISCOUNT);
  if (p.primaryPosition !== 'C') return base;
  const extra = Math.min(MAX_C_REDUNDANCY_EXTRA_DISCOUNT, excess * C_REDUNDANCY_EXTRA_DISCOUNT_SCALE);
  return base + extra;
}

interface NeedContext {
  emptySlots: Position[];
  /** Has a real starter, but no realistic backup at all yet — distinct from `emptySlots`
   * (no starter) so bench-round picks still have a positional signal to follow once the
   * starting five is set, instead of going position-blind for the remaining 3-4 rounds. */
  thinSlots: Position[];
  /** 2026-08-15, user-reported (draft exports: Amir Johnson drafted as a duplicate PF while
   * Gerald Wallace — already on the roster, SF primary — was already realistically covering PF
   * minutes; same pattern with Dāvis Bertāns drafted over an already-rostered Wally Szczerbiak).
   * Subset of `thinSlots` above where the roster already has at least one player who reaches the
   * slot via the SAME adjacent-fallback tier `autoAssignRotation`'s own `REALISTIC_TIERS` uses to
   * fill real bench minutes there (`isPositionEligible` true, `isRealPositionFit` false — a
   * one-spot-away stretch, not a true primary/secondary fit). `thinSlots` itself stays untouched
   * (it still needs to answer "does this slot have 2 REAL fits," a real roster-construction
   * question independent of this), but the draft-time need bonus built from it was treating a
   * slot backed by nothing beyond a loose fallback player exactly the same as one with genuinely
   * nobody at all — routinely spending a late pick on a fully duplicate real-fit specialist
   * instead of the team's actual biggest remaining gap (both real examples above: the redundant
   * pick's FGA should have gone to a genuinely uncovered bench PG/PG-thin slot instead). */
  looselyBackedThinSlots: Position[];
  /** Starters' minutes-weighted-equivalent average `computeSpacing` (0-100), 50 (neutral) for
   * an empty roster. 2026-08-07, user-reported (6 independent playtest teams: spacing scores
   * of ~40, including at least one — Detroit — with an otherwise well-chosen starting five,
   * ruling out "just bad talent picks" as the explanation). The previous signal,
   * `lacksSpacing` (`!starterPlayers.some(isPlusShooter)`), was purely binary — satisfied
   * permanently by a SINGLE plus-shooter (SPACING>=65) anywhere in the five, after which the
   * AI had zero further incentive to draft anyone else who shoots, even though the team's real
   * `spacingScore` (`scoring.ts`) is a minutes-weighted average across all five, not a "do we
   * have at least one" check — a team can clear the binary gate while still averaging well
   * below a good real-game spacing number. Same continuous, deficit-scaled shape as
   * `avgDefensivePortability` below (which replaced an analogous binary defense signal
   * earlier), not a second copy of the same idea under a new name — spacing had no continuous
   * equivalent yet, unlike defense. */
  avgSpacing: number;
  lacksRimProtection: boolean;
  /** How many current STARTERS carry a real perimeter-defender role (`PERIMETER_DEFENDER_ROLES`).
   * 2026-09-09: replaced a binary `lacksPerimeterDefense` — the AI-vs-human draft comparison
   * (D1 + D1S2) showed the AI takes exactly ONE 3-and-D wing and then never values another, so
   * Iguodala / OG Anunoby / Danny Green-tier connectors real humans stack 2-3 of never came off
   * the board. The `need` bonus below now tapers over the first two rather than vanishing after
   * the first. */
  perimeterDefenderStarterCount: number;
  usageWeight: number;
  /** Starters' average D-POR (`computeDefensivePortability`), 50 (a neutral mid-scale default)
   * for an empty roster. 2026-08-06, user's explicit ask after the O-POR/D-POR split landed:
   * "overall" portability never fed the AI at all (checked directly — neither `aiDrafter.ts` nor
   * `scoring.ts` referenced it before today), so this is genuinely new draft behavior, not a
   * refactor of existing logic. Continuous rather than the categorical `lacksRimProtection`/
   * `lacksPerimeterDefense` above (which only ask "does the team have ANY tagged defender") —
   * this asks "how defensively replaceable is the team's current starting five," and feeds a
   * magnitude-scaled bonus below rather than a flat one. */
  avgDefensivePortability: number;
  /** True if starters already include a real, elite-level playmaking hub (real apg, not
   * archetype-tagged — see `ELITE_PLAYMAKING_APG_THRESHOLD` below for why apg and not
   * `HIGH_USAGE_ARCHETYPE_WEIGHT`). 2026-08-07, user-reported (San Diego Bobcats): a team
   * with Magic Johnson already at PG kept drafting Domantas Sabonis at C — "team should be
   * targeting a defensive center, doesn't need a passing center when it already has Magic."
   * Root-caused: `usageWeight`'s existing redundancy discount only fires past a threshold of 2.0
   * combined usage-weight, which a single Primary Ball Handler (weight 0.5) never reaches alone
   * — and even if it did, Sabonis's own archetype (`Versatile Big`/`Post Scorer`, checked
   * directly against the pool) was never in `HIGH_USAGE_ARCHETYPE_WEIGHT` to begin with, since
   * that map is about ON-BALL SCORING usage (isolation/shot creation), not hub-passing — a real,
   * different skill the existing taxonomy has no entry for at all. Distinct mechanism, gated
   * separately below. */
  hasElitePlaymaking: boolean;
  /** 2026-08-07, offensiveProfile.ts synergy signals (shot-diet + playmaking gravity from the
   * user's zone-efficiency/playmaking CSV batch — explicitly NOT wired into computeTalent).
   * True if a starter is rim-dominant (Shaq/Giannis/LeBron per the user's a/c examples) — the
   * team should actively favor shooters beyond what `avgSpacing`'s general deficit already asks
   * for, since this player's specific value depends on it. */
  hasRimGravityStarter: boolean;
  /** True if a starter is a self-sufficient offensive engine (Nash per the user's d example —
   * elite playmaking, no dominant shot zone) — the team needs two-way/defensive complements more
   * than it needs another high-usage offensive piece. */
  hasSelfSufficientEngineStarter: boolean;
  /** 2026-08-08, user-reported: bench units often have nobody who can "pociągnąć grę" (carry
   * scoring load) once the starters sit — root-caused to `usageWeight`'s redundancy discount
   * below firing against Shot Creator/Slasher candidates in BENCH rounds too, purely because
   * `usageWeight` itself is starter-only (see its own docstring) with no round-awareness, so the
   * exact archetype a bench scorer needs gets suppressed the moment the starting five already has
   * two ball-dominant guys. True whenever NONE of the roster's current non-starters (real bench
   * players, by the same `starterPlayers`/`isRealPositionFit` split used above) carry a real
   * self-creator archetype yet. Deliberately NOT a roster-wide "has 2+ total" count — measured
   * directly (`scripts/_checkBenchCreatorCoverage.ts`, deleted after use) that a roster-wide count
   * is the wrong signal: a team can easily draft 2+ self-creators who all end up starting (they
   * only compete for the SAME slot if they share a position), leaving the bench with none while
   * reading as "covered." Checking the actual current bench split instead measures the real thing
   * being asked for. */
  lacksBenchShotCreator: boolean;
  /** 2026-08-14, user's own idea (`sixthMan.ts`'s own docstring has the full derivation): a real
   * instant-offense-off-the-bench profile (good O-TAL, real defensive liability, not a star-level
   * overall talent) the bench specifically benefits from, distinct from `lacksBenchShotCreator`
   * above — that one asks for a self-creator ARCHETYPE tag regardless of defense, this one asks
   * for the actual weak-defense/scoring-specialist STAT profile `isSixthManProfile` measures.
   * Same "does the current bench already have one" shape as `lacksBenchShotCreator`. */
  lacksSixthMan: boolean;
}

/** Only the full-weight archetypes (`HIGH_USAGE_ARCHETYPE_WEIGHT`'s Shot Creator/Slasher, weight
 * 1) count — a lead guard (Primary/Secondary Ball Handler, weight 0.5/0.25) creates offense for
 * teammates, not necessarily his own shot off the dribble, which is the specific "can go get a
 * bucket himself" trait a bench scorer needs when the starters' half-court sets aren't running. */
const isSelfCreatorArchetype = (p: PlayerSpan) => (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0) >= 1;

/** Measured against the real in-game pool (`draftPool.json`, ~3,100 spans): apg reads p50=2.9 /
 * p75=4.7 / p90=6.7 / p95=8.2 — 7.0 sits just past p90, "genuinely elite playmaking rate," not a
 * merely-good facilitator. Confirmed against the two named cases directly: Magic Johnson clears
 * it on every one of his 11 pool spans (7.7-12.8 apg), Domantas Sabonis clears it only on his
 * two real passing-hub peaks (2022-24 apg 7.7, 2023-25 apg 7.2) — his earlier, lower-passing
 * spans (1.5-6.4 apg) correctly do NOT trigger the redundancy discount on themselves. */
const ELITE_PLAYMAKING_APG_THRESHOLD = 7;
/** Same shape/magnitude as the existing usage-weight redundancy discount's per-point scale
 * (`* 0.5`) — a flat, not proportional, discount since apg above the threshold doesn't need a
 * finer gradient the way FGA-shortfall maluses elsewhere do; this is a binary "do we already
 * have this skill covered" question, not a "how much excess" one. */
const ELITE_PLAYMAKING_REDUNDANCY_DISCOUNT = 0.6;

export function assessNeeds(roster: PlayerSpan[]): NeedContext {
  const { slots } = autoAssignRotation(roster);

  // `slots[slot][0]` is the primary if bestPrimaryAssignment placed a real one there; if not,
  // it's whichever bench player the rotation's backup-filling relaxation ladder stuck there
  // to keep the slot at 48 minutes — including, at its loosest tier, someone with zero real
  // fit. That's the right call for a *finished* 9-man roster's rotation sheet, but it's the
  // wrong signal for "does this team still need a real starter here": a slot only counts as
  // covered if the player actually fits it, not just because *someone's* nominally in the row.
  //
  // Uses `isRealPositionFit` (primary or explicit secondary only), not the more lenient
  // `isPositionEligible` `autoAssignRotation` itself uses to fill the slot — user-reported
  // feedback (2026-08-05 playtest batch) surfaced the same "C at PF" / "PG at SG" mistake
  // recurring across many teams (Mutombo, Jokić, Isiah Thomas, Kirilenko, PJ Tucker, Barkley,
  // Hartenstein...). Root cause: the generic "one spot away" 0.75 fallback IS eligible under
  // `isPositionEligible`, so the moment `autoAssignRotation` plugged an adjacent player into a
  // gap, `assessNeeds` read that slot as already covered and never boosted drafting a real
  // fit for it — a self-perpetuating loop where the fallback masked the very gap it exists to
  // patch, most often at SG (surrounded by PG/SF, both real positions with generic 0.75
  // reach into SG). `isPositionEligible` itself is untouched — `autoAssignRotation`'s own
  // last-resort fill still needs the lenient version, since a real 9-man roster sometimes
  // genuinely lacks depth and stretching someone a slot is more realistic than nobody there.
  const starterPlayers: PlayerSpan[] = [];
  const emptySlots: Position[] = [];
  for (const slot of STARTER_SLOTS) {
    const top = slots[slot][0];
    const player = top ? roster.find((p) => p.id === top.playerId) : undefined;
    if (player && isRealPositionFit(player, slot)) {
      starterPlayers.push(player);
    } else {
      emptySlots.push(slot);
    }
  }

  // A starter alone isn't real depth — a slot needs at least one real backup beyond its
  // starter (2 eligible bodies total) to not need positional attention anymore. Same
  // `isRealPositionFit` tightening as above — a bench SF who merely reaches into PF via the
  // generic fallback shouldn't count as "real depth" either, or the AI would stop looking for
  // an actual backup PF the moment it happens to draft any forward at all.
  //
  // 2026-08-15, user-reported (real diagnostic: 63.7% of teams' final roster spot goes to a
  // player who gets literally 0 real minutes, ~4.8 FGA of cap spent for nothing): this constant
  // was 3, off by one from this comment's own stated intent — `eligibleCount < 3` keeps flagging
  // a slot "thin" even at 2 eligible bodies (starter + a real backup), the exact case the comment
  // above says should already read as covered. Checked directly against 6 concrete 0-minute
  // cases from real simulated drafts: every single one was a 3rd body at a position whose
  // starter+backup pair already covered the full 48 minutes (a 3rd center, a 3rd SF/SG, etc.),
  // while the roster spot could have gone to an actually-uncovered position instead. Fixed to
  // match the comment's own math.
  //
  // 2026-08-15 SAME-DAY FOLLOW-UP, user-reported (real diagnostic: Jaren Jackson Jr. — PF starter,
  // real C secondary, but `maxSustainableMinutes` only 30, already fully spent on his OWN PF
  // slot — counted as C's "2nd real fit" purely by carrying the tag, with zero actual spare
  // capacity to ever help there; C's real gap got covered by Mario Elie, an SF with NO real C fit
  // at all, via true last-resort). Root cause: `eligibleCount` above only asks "does a real-fit
  // body exist SOMEWHERE on the roster," never "is this slot's 48 minutes ACTUALLY coming from
  // real-fit bodies in the rotation this exact roster already produces" — a real secondary tag on
  // a starter who's fully consumed elsewhere is not real depth, just a nominal label. `slots`
  // (this function's own first line) is the ACTUAL computed rotation for this roster — reusing it
  // directly measures the true thing that matters (real minutes covered), not a proxy for it.
  // User's own words, verbatim requirement: "MASZ 3 SPOTY NA ŁAWCE, TE 3 SPOTY MUSZĄ POKRYĆ 5
  // POZYCJI" (3 bench spots MUST cover 5 positions) — a slot is only "not thin" once its real
  // minutes, from real-fit players only, add up to the full game, not before.
  const thinSlots = STARTER_SLOTS.filter((slot) => {
    if (emptySlots.includes(slot)) return false;
    const realFitMinutes = slots[slot].reduce((sum, a) => {
      const player = roster.find((p) => p.id === a.playerId);
      return player && isRealPositionFit(player, slot) ? sum + a.minutes : sum;
    }, 0);
    return realFitMinutes < GAME_MINUTES;
  });
  // See `NeedContext.looselyBackedThinSlots`'s own docstring.
  const looselyBackedThinSlots = thinSlots.filter((slot) =>
    roster.some((p) => isPositionEligible(p, slot) && !isRealPositionFit(p, slot)),
  );

  return {
    emptySlots,
    thinSlots,
    looselyBackedThinSlots,
    avgSpacing:
      starterPlayers.length === 0
        ? 50
        : starterPlayers.reduce((sum, p) => sum + computeSpacing(p), 0) / starterPlayers.length,
    lacksRimProtection: !starterPlayers.some((p) => RIM_PROTECTOR_ROLES.includes(p.defensiveRole)),
    perimeterDefenderStarterCount: starterPlayers.filter((p) => PERIMETER_DEFENDER_ROLES.includes(p.defensiveRole)).length,
    usageWeight: starterPlayers.reduce((sum, p) => sum + (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0), 0),
    avgDefensivePortability:
      starterPlayers.length === 0
        ? 50
        : starterPlayers.reduce((sum, p) => sum + computeDefensivePortability(p), 0) / starterPlayers.length,
    hasElitePlaymaking: starterPlayers.some((p) => p.box.apg >= ELITE_PLAYMAKING_APG_THRESHOLD),
    hasRimGravityStarter: starterPlayers.some(isRimGravityScorer),
    hasSelfSufficientEngineStarter: starterPlayers.some(isSelfSufficientEngine),
    lacksBenchShotCreator: !roster.some((p) => !starterPlayers.includes(p) && isSelfCreatorArchetype(p)),
    lacksSixthMan: !roster.some((p) => !starterPlayers.includes(p) && isSixthManProfile(p)),
  };
}

/** Even split of the whole cap across a full roster — the reference point "cap room per
 * remaining slot" is compared against to gauge how tight things are getting. */
const COMFORTABLE_BUDGET_PER_SLOT = CAP_LIMIT / ROSTER_SIZE;
/** Slots remaining at which point cap-consciousness starts ramping up regardless of how much
 * room is technically left — even a team that's spent nothing still shouldn't stay in pure
 * "best player available" mode all the way to the last pick or two, since the endgame is a
 * genuine multi-team squeeze (three other teams draining the same cheap tail between this
 * team's turns) that a single team's own budget math can't fully see coming. */
const COMFORT_SLOTS_LEFT = 4;
/** How hard a shot attempt is penalized when cap room is comfortable vs. when it's tight.
 * Ramping this up as the roster fills — rather than dividing talent by FGA outright — keeps
 * a real talent gap from ever being erased by cheapness alone (a scrub can't out-earn a
 * genuine star just by costing less), while still making the AI meaningfully more
 * cap-conscious in the back half of a draft than in the front half. */
const BASE_FGA_PENALTY = 0.4;
/** Capped low enough that cost alone can't flip a real talent gap in the range that actually
 * shows up near the cheap end of the pool (e.g. a ~7-TAL-point gap over ~5 FGA, Anthony Davis
 * vs. Mark Price) even at maximum end-of-draft cap pressure — hard cap-legality is already a
 * separate, absolute filter before this soft preference ever runs (`isPickCapLegal` /
 * `canFillFromLookup` above), so this only needs to bias toward cheapness, not enforce it. The
 * previous 3.2 cap let a 5-FGA gap alone erase a 16-point talent edge, which was overpowering
 * ordinary star-vs-cap-glue talent gaps rather than just tie-breaking among similar talents. */
const MAX_FGA_PENALTY = 1.3;

/**
 * A mathematically fillable bench is not necessarily a playable bench. The old lookahead only
 * reserved the cheapest surviving names, which let a five-man core spend 85.5 FGA and leave
 * three ~5-FGA roster spots; the resulting PG gap was then "solved" by TAL 40 Danny Young for
 * 20 minutes. Six FGA is a conservative planning allowance for an ordinary playable reserve in
 * this pool. Once only one or two future picks remain, one true sub-2-FGA glue slot may replace
 * one ordinary reserve. If no candidate preserves this reserve, normal hard-cap legality remains
 * the fallback, so the draft can always finish.
 */
const PLAYABLE_RESERVE_FGA_PER_SLOT = 6;
const TRUE_CAP_GLUE_FGA_CEILING = 2;

function plannedPlayableReserveFga(slotsRemaining: number): number {
  if (slotsRemaining <= 0) return 0;
  if (slotsRemaining >= 3) return slotsRemaining * PLAYABLE_RESERVE_FGA_PER_SLOT;
  return (slotsRemaining - 1) * PLAYABLE_RESERVE_FGA_PER_SLOT + TRUE_CAP_GLUE_FGA_CEILING;
}

/** A 12-minute specialist may be narrow; an 18-24 minute backup cannot be replacement-level. */
const MATERIAL_BENCH_MINUTES = 18;
const USEFUL_BENCH_MINUTES = 12;
const MATERIAL_BENCH_TALENT_FLOOR = 52;
const PENULTIMATE_ROTATION_TALENT_FLOOR = 56;
const BENCH_QUALITY_SCAN_SIZE = 40;

/**
 * The flat FGA cost cannot distinguish a justified all-time offensive burden from a merely good
 * player consuming an unusually large share of the cap. The thresholds are measured p85 values
 * for every position in the full pool. Above them, the penalty scales with excess FGA, offensive
 * shortfall, talent supplied by non-offensive components, and weak defense; PF/C receive an
 * additional surcharge because high-volume non-elite bigs are especially difficult to build
 * around under this game's cap.
 *
 * A strict TAL 96 plus elite-offense-or-defense gate protects real all-time engines and historic
 * two-way anchors. This is deliberately a profile rule rather than a list of player names.
 */
const HIGH_VOLUME_FGA_THRESHOLD: Record<Position, number> = {
  PG: 16.9,
  SG: 17.9,
  SF: 18.3,
  PF: 16.7,
  C: 16.1,
};
const ALL_TIME_VOLUME_TALENT_FLOOR = 96;
const ALL_TIME_VOLUME_OFFENSE_FLOOR = 88;
/**
 * 2026-08-14, user-reported (same session as the `grades.ts` C-position tier-cap fix — this is
 * the second, independently-calibrated occurrence of the identical pattern): Tim Duncan's real
 * defensive ceiling across his whole career is 94, one point under the old 95 floor here, so his
 * high-FGA two-way-anchor peak spans (2001-03/2002-04, TAL96, O-TAL 75-79) got NEITHER exemption
 * path — offense (79) is nowhere near 88, defense (94) missed 95 by exactly one point — and paid
 * the full non-elite-volume penalty (~8 of the 14-point max) that this gate exists specifically to
 * spare a genuine all-time anchor from. Measured directly: across 10 simulated drafts this alone
 * was the dominant reason his average pick (29.6) sat roughly double every real peer in his own
 * tier-2 legends cohort (Bird/Hakeem/Robinson/Garnett/Jokić/Magic/Durant/Giannis, all avg pick
 * 6.4-15.2, all correctly exempt via one path or the other). Lowered to 94. Full-archive blast
 * radius checked before shipping: 3 spans, 2 players (Kareem Abdul-Jabbar 1977-79, Tim Duncan
 * 2001-03/2002-04) — both genuine two-way-anchor cases, nothing else in the archive sits exactly
 * on this one-point line.
 */
const ALL_TIME_VOLUME_DEFENSE_FLOOR = 94;
const HIGH_VOLUME_BASE_SCALE = 0.75;
const HIGH_VOLUME_OFFENSE_REFERENCE = 88;
const HIGH_VOLUME_OFFENSE_SHORTFALL_SCALE = 0.035;
const HIGH_VOLUME_OFFENSE_SHORTFALL_FLAT_SCALE = 0.12;
const HIGH_VOLUME_WEAK_DEFENSE_FLOOR = 50;
const HIGH_VOLUME_WEAK_DEFENSE_SCALE = 0.2;
const HIGH_VOLUME_TALENT_OFFENSE_GAP_SCALE = 0.15;
const HIGH_VOLUME_BIG_EXTRA_SCALE = 1.5;
const MAX_HIGH_VOLUME_PENALTY = 14;
const ELITE_ONE_WAY_CREATOR_DEFENSE_FLOOR = 60;
const ELITE_ONE_WAY_CREATOR_DEFENSE_SCALE = 0.04;
const ELITE_ONE_WAY_CREATOR_EXCESS_FGA_SCALE = 0.05;
const MAX_ELITE_ONE_WAY_CREATOR_PENALTY = 1.5;
const PORTABLE_TWO_WAY_WING_OTAL_FLOOR = 75;
const PORTABLE_TWO_WAY_WING_DTAL_FLOOR = 55;
const PORTABLE_TWO_WAY_WING_SPACING_FLOOR = 80;
const PORTABLE_TWO_WAY_WING_PENALTY_SCALE = 0.35;

function isValidatedPortableTwoWayWing(p: PlayerSpan): boolean {
  if (p.primaryPosition !== 'SG' && p.primaryPosition !== 'SF') return false;
  return (
    madeAllNbaInSpan(p.playerName, p.spanLabel) &&
    computeOffensiveTalent(p) >= PORTABLE_TWO_WAY_WING_OTAL_FLOOR &&
    computeDefensiveTalent(p) >= PORTABLE_TWO_WAY_WING_DTAL_FLOOR &&
    computeSpacing(p) >= PORTABLE_TWO_WAY_WING_SPACING_FLOOR
  );
}

function highVolumeNonElitePenalty(p: PlayerSpan): number {
  const excess = p.fga - HIGH_VOLUME_FGA_THRESHOLD[p.primaryPosition];
  if (excess <= 0) return 0;

  const talent = effectiveTalent(p);
  const offensiveTalent = computeOffensiveTalent(p);
  const defensiveTalent = computeDefensiveTalent(p);
  const isAllTimeVolumeException =
    talent >= ALL_TIME_VOLUME_TALENT_FLOOR &&
    (offensiveTalent >= ALL_TIME_VOLUME_OFFENSE_FLOOR || defensiveTalent >= ALL_TIME_VOLUME_DEFENSE_FLOOR);
  if (isAllTimeVolumeException) {
    // An all-time offensive peak still has to pay a modest construction cost when it is a
    // high-volume, one-way Shot Creator. This separates Harden-like offense-only spans from
    // Jordan/Kobe/Wade-style two-way volume and, within one player's tied TAL/O-TAL spans,
    // stops the cheaper but much weaker defensive stretch from winning automatically.
    if (
      p.offensiveArchetype === 'Shot Creator' &&
      offensiveTalent >= 96 &&
      defensiveTalent < ELITE_ONE_WAY_CREATOR_DEFENSE_FLOOR
    ) {
      return Math.min(
        MAX_ELITE_ONE_WAY_CREATOR_PENALTY,
        (ELITE_ONE_WAY_CREATOR_DEFENSE_FLOOR - defensiveTalent) * ELITE_ONE_WAY_CREATOR_DEFENSE_SCALE +
          excess * ELITE_ONE_WAY_CREATOR_EXCESS_FGA_SCALE,
      );
    }
    return 0;
  }

  const offenseShortfall = Math.max(0, HIGH_VOLUME_OFFENSE_REFERENCE - offensiveTalent);
  const volumeScale = HIGH_VOLUME_BASE_SCALE + offenseShortfall * HIGH_VOLUME_OFFENSE_SHORTFALL_SCALE;
  const weakDefenseSurcharge =
    Math.max(0, HIGH_VOLUME_WEAK_DEFENSE_FLOOR - defensiveTalent) * HIGH_VOLUME_WEAK_DEFENSE_SCALE;
  const offenseShortfallSurcharge = offenseShortfall * HIGH_VOLUME_OFFENSE_SHORTFALL_FLAT_SCALE;
  const talentOffenseGapSurcharge =
    Math.max(0, talent - offensiveTalent) * HIGH_VOLUME_TALENT_OFFENSE_GAP_SCALE;
  const bigPositionSurcharge =
    p.primaryPosition === 'PF' || p.primaryPosition === 'C' ? excess * HIGH_VOLUME_BIG_EXTRA_SCALE : 0;
  const penalty = Math.min(
    MAX_HIGH_VOLUME_PENALTY,
    excess * volumeScale +
      offenseShortfallSurcharge +
      weakDefenseSurcharge +
      talentOffenseGapSurcharge +
      bigPositionSurcharge,
  );
  return isValidatedPortableTwoWayWing(p) ? penalty * PORTABLE_TWO_WAY_WING_PENALTY_SCALE : penalty;
}

const PLAYOFF_BPM_VALUE_BASELINE = 2;
const PLAYOFF_BPM_VALUE_SCALE = 0.9;
const MAX_PLAYOFF_BPM_VALUE_BONUS = 4;

export function playoffBpmDraftBonus(p: PlayerSpan): number {
  const playoff = playoffBpm2ForSpan(p);
  if (!playoff) return 0;
  if (
    p.primaryPosition !== 'PF' &&
    p.primaryPosition !== 'C' &&
    computeDefensiveTalent(p) < PORTABLE_TWO_WAY_WING_DTAL_FLOOR
  ) return 0;
  const excess = Math.max(0, playoff.bpm - PLAYOFF_BPM_VALUE_BASELINE);
  return Math.min(MAX_PLAYOFF_BPM_VALUE_BONUS, excess * playoff.reliability * PLAYOFF_BPM_VALUE_SCALE);
}

const ELITE_PERIMETER_ENGINE_ARCHETYPES = new Set(['Primary Ball Handler', 'Shot Creator']);
const ELITE_PERIMETER_ENGINE_TALENT_FLOOR = 96;
const ELITE_PERIMETER_ENGINE_OFFENSE_FLOOR = 90;
const ELITE_PERIMETER_ENGINE_FGA_FLOOR = 17.5;
const ELITE_PERIMETER_ENGINE_BONUS_REFERENCE = 88;
const ELITE_PERIMETER_ENGINE_BONUS_SCALE = 0.4;
const MAX_ELITE_PERIMETER_ENGINE_BONUS = 3;
const ELITE_POST_SCORER_BONUS = 2.5;
const ELITE_POST_PLAYMAKING_HUB_BONUS = 2;

function elitePerimeterEngineBonus(p: PlayerSpan): number {
  if (p.fga < ELITE_PERIMETER_ENGINE_FGA_FLOOR) return 0;
  if (effectiveTalent(p) < ELITE_PERIMETER_ENGINE_TALENT_FLOOR) return 0;
  const offensiveTalent = computeOffensiveTalent(p);
  if (p.offensiveArchetype === 'Post Scorer') {
    if (offensiveTalent < 88 || computeDefensiveTalent(p) >= 90) return 0;
    // The post-engine bump is meant for a workload a team can actually build around. Embiid's
    // 34-minute/load-managed spans keep their measured TAL but do not receive the same extra
    // draft credit as a fully sustainable Shaq-like peak.
    const sustainableMinutes = maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER);
    const workloadFactor = Math.max(0, Math.min(1, (sustainableMinutes - 32) / 4));
    const postBonus = p.box.apg >= 6 ? ELITE_POST_PLAYMAKING_HUB_BONUS : ELITE_POST_SCORER_BONUS;
    return postBonus * workloadFactor;
  }
  if (!ELITE_PERIMETER_ENGINE_ARCHETYPES.has(p.offensiveArchetype)) return 0;
  if (offensiveTalent < ELITE_PERIMETER_ENGINE_OFFENSE_FLOOR) return 0;
  return Math.min(
    MAX_ELITE_PERIMETER_ENGINE_BONUS,
    (offensiveTalent - ELITE_PERIMETER_ENGINE_BONUS_REFERENCE) * ELITE_PERIMETER_ENGINE_BONUS_SCALE,
  );
}

const ELITE_TWO_WAY_FRONTCOURT_OFFENSE_FLOOR = 65;
const ELITE_TWO_WAY_FRONTCOURT_DEFENSE_FLOOR = 91;
const ELITE_TWO_WAY_FRONTCOURT_PLAYMAKING_FLOOR = 3.3;
const ELITE_TWO_WAY_FRONTCOURT_BASE_BONUS = 0.4;
const ELITE_TWO_WAY_FRONTCOURT_DEFENSE_SCALE = 0.06;
const ELITE_TWO_WAY_FRONTCOURT_PLAYMAKING_SCALE = 0.05;
const MAX_ELITE_TWO_WAY_FRONTCOURT_BONUS = 1;
const ELITE_TWO_WAY_POST_FGA_FLOOR = 20;
const ELITE_TWO_WAY_POST_DEFENSE_FLOOR = 97;
const ELITE_TWO_WAY_POST_BONUS = 0.8;
const ELITE_TWO_WAY_SLASHER_OFFENSE_FLOOR = 90;
const ELITE_TWO_WAY_SLASHER_DEFENSE_FLOOR = 85;
const ELITE_TWO_WAY_SLASHER_FGA_FLOOR = 18;
const ELITE_TWO_WAY_SLASHER_BONUS = 0.8;
const ELITE_TWO_WAY_PERIMETER_BONUS = 1;

/**
 * 2026-08-14, user-reported ("Duncan nadal zbyt nisko" — still too low): this bonus is exactly
 * the "real two-way frontcourt anchor" profile it's named for (TAL>=96, real defense>=91, real
 * point-forward-level apg>=3.3), but a blanket `offensiveArchetype === 'Post Scorer'` exclusion
 * (no docstring ever explained why) shut out every Post-Scorer-tagged big regardless of how well
 * they otherwise fit — Duncan's three 96-TAL spans all clear every other gate. `Post Scorer` bigs
 * already have their OWN, much stricter two-way path (`eliteTwoWayPeakBonus`'s Post-Scorer
 * branch, defense>=97 vs this gate's 91) — that path staying separately gated is untouched here;
 * this only removes the total exclusion from THIS looser gate. Checked full-archive blast radius
 * before removing: 13 spans, 4 players — Kareem Abdul-Jabbar (7), Duncan (3), Hakeem Olajuwon (2),
 * David Robinson (1, a different span than his already-qualifying Versatile-Big one) — every one
 * a real, externally-validated (`taylorValidatedNames.ts`) two-way anchor, not a broad reopening.
 */
function eliteTwoWayFrontcourtBonus(p: PlayerSpan): number {
  if (p.primaryPosition !== 'PF' && p.primaryPosition !== 'C') return 0;
  if (effectiveTalent(p) < ELITE_PERIMETER_ENGINE_TALENT_FLOOR) return 0;
  const offensiveTalent = computeOffensiveTalent(p);
  if (offensiveTalent < ELITE_TWO_WAY_FRONTCOURT_OFFENSE_FLOOR) return 0;
  const defensiveTalent = computeDefensiveTalent(p);
  if (defensiveTalent < ELITE_TWO_WAY_FRONTCOURT_DEFENSE_FLOOR) return 0;
  if (p.box.apg < ELITE_TWO_WAY_FRONTCOURT_PLAYMAKING_FLOOR) return 0;
  return Math.min(
    MAX_ELITE_TWO_WAY_FRONTCOURT_BONUS,
    ELITE_TWO_WAY_FRONTCOURT_BASE_BONUS +
      (defensiveTalent - ELITE_TWO_WAY_FRONTCOURT_DEFENSE_FLOOR) * ELITE_TWO_WAY_FRONTCOURT_DEFENSE_SCALE +
      (p.box.apg - ELITE_TWO_WAY_FRONTCOURT_PLAYMAKING_FLOOR) * ELITE_TWO_WAY_FRONTCOURT_PLAYMAKING_SCALE,
  );
}

function eliteTwoWayPeakBonus(p: PlayerSpan): number {
  const talent = effectiveTalent(p);
  const offense = computeOffensiveTalent(p);
  const defense = computeDefensiveTalent(p);
  if (
    p.offensiveArchetype === 'Post Scorer' &&
    p.fga >= ELITE_TWO_WAY_POST_FGA_FLOOR &&
    talent >= ELITE_PERIMETER_ENGINE_TALENT_FLOOR &&
    offense >= ELITE_TWO_WAY_FRONTCOURT_OFFENSE_FLOOR &&
    defense >= ELITE_TWO_WAY_POST_DEFENSE_FLOOR
  ) {
    return ELITE_TWO_WAY_POST_BONUS;
  }
  if (
    p.offensiveArchetype === 'Slasher' &&
    p.fga >= ELITE_TWO_WAY_SLASHER_FGA_FLOOR &&
    talent >= ELITE_PERIMETER_ENGINE_TALENT_FLOOR &&
    offense >= ELITE_TWO_WAY_SLASHER_OFFENSE_FLOOR &&
    defense >= ELITE_TWO_WAY_SLASHER_DEFENSE_FLOOR
  ) {
    return ELITE_TWO_WAY_SLASHER_BONUS;
  }
  if (p.primaryPosition !== 'SG' && p.primaryPosition !== 'SF') return 0;
  if (talent < 98) return 0;
  if (offense < 94) return 0;
  if (defense < 95) return 0;
  return ELITE_TWO_WAY_PERIMETER_BONUS;
}

const NON_ELITE_CREATOR_TALENT_CEILING = 96;
const NON_ELITE_CREATOR_OFFENSE_REFERENCE = 88;
const NON_ELITE_CREATOR_BASE_PENALTY = 0.5;
const NON_ELITE_CREATOR_SHORTFALL_SCALE = 0.3;
const MAX_NON_ELITE_CREATOR_PENALTY = 4;
const OFF_BALL_SHOOTER_ARCHETYPES = new Set(['Off Screen Shooter', 'Movement Shooter', 'Stationary Shooter']);
const OFF_BALL_SPECIALIST_TALENT_REFERENCE = 96;
const OFF_BALL_SPECIALIST_PENALTY_SCALE = 0.7;
const OFF_BALL_SPECIALIST_DEFENSE_REFERENCE = 60;
const OFF_BALL_SPECIALIST_DEFENSE_SCALE = 0.08;
const MAX_OFF_BALL_SPECIALIST_PENALTY = 6.5;

/** Keep secondary scorers and shooting specialists fit-dependent in the early rounds. Historic
 * primary engines are exempt; the penalty only asks sub-96 Shot Creators to prove elite offense,
 * and only discounts off-ball specialists below the all-time talent tier. */
function earlyCoreRolePenalty(p: PlayerSpan): number {
  const talent = effectiveTalent(p);
  if (p.offensiveArchetype === 'Shot Creator' && talent < NON_ELITE_CREATOR_TALENT_CEILING) {
    const offenseShortfall = Math.max(0, NON_ELITE_CREATOR_OFFENSE_REFERENCE - computeOffensiveTalent(p));
    const penalty = Math.min(
      MAX_NON_ELITE_CREATOR_PENALTY,
      NON_ELITE_CREATOR_BASE_PENALTY + offenseShortfall * NON_ELITE_CREATOR_SHORTFALL_SCALE,
    );
    return isValidatedPortableTwoWayWing(p) ? penalty * PORTABLE_TWO_WAY_WING_PENALTY_SCALE : penalty;
  }
  if (OFF_BALL_SHOOTER_ARCHETYPES.has(p.offensiveArchetype) && talent < OFF_BALL_SPECIALIST_TALENT_REFERENCE) {
    return Math.min(
      MAX_OFF_BALL_SPECIALIST_PENALTY,
      (OFF_BALL_SPECIALIST_TALENT_REFERENCE - talent) * OFF_BALL_SPECIALIST_PENALTY_SCALE +
        Math.max(0, OFF_BALL_SPECIALIST_DEFENSE_REFERENCE - computeDefensiveTalent(p)) *
          OFF_BALL_SPECIALIST_DEFENSE_SCALE,
    );
  }
  return 0;
}

/**
 * A team already loaded with high-usage offensive talent should actively favor defense for its
 * remaining picks, not just fill a "zero defenders at all" gap. Reported directly (2026-07-30):
 * a team with Doncic + Durant + Garnett already rostered (offense-heavy) drafted Brent Barry — a
 * shooter, not a defender — at SG, and separately never drafted a real defensive-minded PF,
 * leaving the rotation to lean on Isaiah Hartenstein (a natural center) to cover that slot out
 * of position. `lacksRimProtection`/`lacksPerimeterDefense` below only fire on a binary "do we
 * have literally zero" — a single nominal defender tag doesn't make a real defense once three
 * ball-dominant scorers are already on the floor.
 *
 * Scaled by the SAME `usageWeight` signal the redundancy discount below already uses, so it
 * engages exactly when that discount does — a team with enough offensive juice to discount a 4th
 * high-usage scorer is exactly a team that should be actively shopping for defense instead. Not
 * position-gated, matching the existing binary defense bonuses' own shape (they credit any
 * defensive-tagged candidate, not just ones at a currently-thin slot) — a real defender at any
 * position is real team defense in this model.
 */
const OFFENSE_HEAVY_USAGE_THRESHOLD = 2;
const OFFENSE_HEAVY_DEFENSE_BONUS = 0.5;

/**
 * 2026-08-07 (v2), softened from a hard candidate-pool filter to a soft `need` bonus — same
 * "prefer a real, previously-human-drafted D1/D2/D3 name" idea (see d1d2d3Lookup.ts's own
 * docstring), but the earlier hard-filter version, combined with the tier-1 legends bonus above,
 * was measured (30-run simulation) to be narrowing the WHOLE draft down to only 227 of the
 * 572-player pool ever getting drafted — every one of the 20 most-frequent names was D1/D2/D3 —
 * reading as repetitive/scripted over a longer play session, the user's own explicit follow-up
 * complaint after the tier-bonus fix made the legends' own determinism visible for the first
 * time. Same magnitude family as the other small need-bonuses on this list (0.4-0.6) — a real
 * tie-break toward familiar names when candidates are otherwise close, but small enough that a
 * genuine talent/need gap (a needed position, a real two-way fit) still wins outright, unlike the
 * old hard filter which could exclude a needed non-D1/D2/D3 candidate from consideration
 * entirely. No position-need-aware gating needed anymore for the same reason: a flat 0.3 on top
 * of `need`'s other terms (empty-slot alone adds 1.5) can't override a real positional need the
 * way the old absolute filter risked doing, so the extra bookkeeping that guarded against that is
 * gone too.
 */
const D1D2D3_PREFERENCE_BONUS = 0.3;

/**
 * 2026-08-06, user's explicit ask: portability (split into O-POR/D-POR the same session) should
 * actually influence AI picks, not just sit as an informational stat — confirmed neither this
 * file nor `scoring.ts` referenced portability in any form before today. Same magnitude as the
 * existing offense-heavy defense bonus above (0.5) so it competes fairly rather than dominating
 * or being swamped by the established positional/spacing/defense need signals.
 *
 * `OFFENSE_HEAVY_OPOR_BONUS_SCALE` reuses the SAME "offense-heavy team" gate as
 * `OFFENSE_HEAVY_DEFENSE_BONUS` above — a roster stacked with ball-dominant, high-self-creation
 * starters specifically needs complementary players whose own offense *travels* next to that
 * (high O-POR: efficient off the ball, doesn't need their own touches) — continuous by the
 * candidate's own O-POR/100 rather than a flat credit, so a truly elite fit (Ray Allen-caliber)
 * earns more than a merely decent one.
 */
const OFFENSE_HEAVY_OPOR_BONUS_SCALE = 0.5;

/** Below this, a team's starting five is defensively replaceable enough that adding real
 * defensive value should meaningfully move the pick — 55 sits just above the pool's own
 * `computeDefensivePortability` median, so "below average defensively as a starting five" is
 * the actual trigger, not just "not already elite." Ramped by how far below the threshold the
 * team sits (linear 0-1) so a team at 10 pulls harder toward defense than one at 50. */
const DEFENSIVE_DEPTH_THRESHOLD = 55;
const DEFENSIVE_DEPTH_BONUS_SCALE = 0.5;

/** Same shape as `DEFENSIVE_DEPTH_THRESHOLD` immediately above, for `avgSpacing`. Both the
 * threshold and scale were measured, not guessed (`scripts/tmpSpacingDiag.ts`/
 * `tmpSpacingEffect.ts`, temp scripts used for this calibration, not kept — see the checked-in
 * regression instead). First tried mirroring the defensive threshold's own reasoning literally
 * ("just above the pool median", 50) with the defensive bonus's own scale (0.5) — measured
 * effect on 400 simulated AI teams' real `spacingScore` was negligible (mean 49.7→50.4). Root
 * cause, checked directly: sampling `avgSpacing` at real in-draft decision points showed it
 * sits at 65 or higher only 9% of the time (mean 48.5) — a threshold of 50 only engaged the
 * bonus for about half of all picks, so most of a team's actual starter-spacing composition
 * was being decided with the bonus silently off. Raised to **65** instead — not an arbitrary
 * round number, it's the same "Good shooter" tier floor `isPlusShooter` already uses elsewhere
 * in this codebase, so the target reads as "starters should collectively be shooters," not a
 * newly-invented number — which alone moved mean spacingScore to 52.7. Scale raised to **1.5**
 * (matching the strongest existing need bonus, `emptySlots`'s 1.5, so this term can compete on
 * equal footing rather than being structurally capped below every other signal) for a further
 * 53.2. Diminishing returns confirmed by also testing scale=3.0 (only 54.3) — most of the
 * remaining gap is structural, not a magnitude problem: `needRampProgress` correctly keeps this
 * bonus at zero for a team's first 3 picks (pure best-talent-available, by design), and those
 * early picks are exactly the ones most likely to end up starting, so no draft-time need signal
 * can fully close the gap without reopening the round-1 talent-first design. */
const SPACING_DEPTH_THRESHOLD = 65;
const SPACING_DEPTH_BONUS_SCALE = 1.1;

/**
 * 2026-08-07, offensiveProfile.ts synergy signals — see `NeedContext.hasRimGravityStarter`/
 * `hasSelfSufficientEngineStarter` above. Additional, not a replacement of the general
 * `avgSpacing`-deficit bonus — a rim-gravity starter's need for shooters is a real, extra pull
 * on top of the team's general spacing deficit (or lack of one), not a re-derivation of it.
 * Same magnitude family as `OFFENSE_HEAVY_DEFENSE_BONUS`/`DEFENSIVE_DEPTH_BONUS_SCALE` nearby.
 */
const RIM_GRAVITY_SHOOTER_BONUS_SCALE = 0.8;
/** Dampens (not zeroes) the pull toward another high-usage archetype once a self-sufficient
 * engine already starts — same shape as the existing redundancy discounts below, same elite-
 * talent exemption gate so a genuine top-of-history peak is still drafted regardless. */
const SELF_SUFFICIENT_USAGE_DAMPENING = 0.4;
/**
 * 2026-08-08, bench-shot-creator fix, option B (positive signal) — see
 * `NeedContext.lacksBenchShotCreator`'s own docstring. Flat, not proportional (matches
 * `lacksRimProtection`/`lacksPerimeterDefense`'s shape) — this is a binary "do we have this skill
 * covered at all" question, not a magnitude one.
 *
 * Tuned by measurement, not picked upfront (`scripts/_checkBenchCreatorCoverage.ts`, deleted
 * after use, tracked "% of AI teams with a real Shot Creator/Slasher among actual bench minutes"
 * across 225 simulated teams): the original magnitude family (this at 0.6, `BENCH_CREATOR_
 * DISCOUNT_SOFTEN` at 0.4) barely moved the number — 0.9% baseline to 3.1% — because the thin-slot
 * / spacing-deficit / rising cap-pressure bonuses competing for the same bench-round picks are
 * all similar or larger magnitude. Scaled up to this value (paired with a near-full discount
 * waiver below) for 11.6% coverage — still a real, deliberate minority (a bench needs at most one
 * such player, and cap/position needs correctly still win when they're the more urgent gap), not
 * a forced-every-team outcome.
 *
 * 2026-08-16, RAISED AGAIN, user-reported ("AI draftuje high TAL centra zamiast... kreacja na
 * piłce" — a bench pick was a high-TAL big, Sabonis-type, TAL84, instead of a real on-ball
 * creator): re-measured directly (`scripts/_checkBenchCreatorVsBig.ts`, deleted after use, 4x16
 * teams) and found the OLD 1.2 magnitude was no longer enough — after this same session's other
 * bench-round changes (dual-position coverage credit, `PG_BENCH_SCARCITY_BONUS`, the widened
 * cheap-guard pool) shifted what else competes for the same picks, **71.9% of teams still ended
 * the draft with literally zero real bench self-creator**, the exact symptom this bonus exists to
 * prevent — same root cause as the PG case just above: `need` MULTIPLIES `talent`, and a genuine
 * high-TAL big's raw advantage (60s-70s TAL for a real creator vs 80s+ for a big like Sabonis) was
 * still large enough to beat a merely-larger need multiplier in a direct comparison. Grid-tested
 * (not guessed) 2.5 and 4.0 against the same measurement: 2.5 dropped zero-coverage to 59.4%
 * (a real, meaningful gain), 4.0 only reached 56.3% (steep diminishing returns past 2.5 — checked
 * separately that pool depth isn't the bottleneck: 63 distinct real cheap self-creators exist in
 * the draftPool, comfortably enough for 48 bench slots across 16 teams, so the residual ~56-60%
 * reflects genuine per-pick competition/timing, not a supply shortage the bonus alone can fix).
 * Landed on **2.5** — the efficient point on the curve, not the ceiling. Full regression pass
 * (`npx tsc -b`, `npm test`) clean at this value.
 */
const BENCH_SHOT_CREATOR_BONUS = 2.5;
/**
 * 2026-08-08, bench-shot-creator fix, option A (softened discount) — same
 * `NeedContext.lacksBenchShotCreator` signal, same measurement pass as `BENCH_SHOT_CREATOR_BONUS`
 * above. Deliberately not a full 0 (a residual discount still applies even to an uncovered team's
 * candidate) but close to it — the positive bonus above is doing most of the real work; this
 * mainly stops the redundancy discount from actively fighting it on the same candidate. A team
 * that's already covered (real self-creator already sitting on the bench) gets the normal, full
 * discount against any further stacking — this only softens the specific "team's only ball-dominant
 * guys are all starters" case, not redundancy discounting in general. */
const BENCH_CREATOR_DISCOUNT_SOFTEN = 0.15;

/**
 * 2026-08-14, `NeedContext.lacksSixthMan`'s own positive-signal bonus — same flat-not-proportional
 * shape and same magnitude as `BENCH_SHOT_CREATOR_BONUS` above (a real, already-measured value for
 * "does the bench have this one specific skill covered"), reused directly rather than picked fresh
 * since it's the closest existing precedent for the same kind of binary bench-coverage question.
 * Not independently re-tuned against its own simulation batch the way the bench-shot-creator pair
 * was — if bench sixth-man coverage measures too low/high in practice, revisit with the same
 * measurement approach (`scripts/_checkBenchCreatorCoverage.ts`'s pattern) rather than guessing a
 * new number.
 */
const SIXTH_MAN_BONUS = 1.2;

/**
 * 2026-08-16, direction-2 follow-up to the `buildDraftPool.ts` cheap-guard/wing pool-widening fix
 * (see that file's own `VALUE_PER_POSITION` docstring for the real archive-scarcity measurement
 * that fix addressed). After widening the pool, re-measured actual bench-round (picks 6-8) pick
 * behavior directly (`scripts/_checkBenchPickPositionBias.ts`, deleted after use, 6x16-team
 * drafts): PG was BOTH the rarest bench pick (14.2% of bench slots, vs an even ~20% baseline) AND
 * the weakest by average talent among what did get picked (avg TAL 49.4, vs C's 62.8 at similar
 * average FGA cost — 6.4 vs 5.5). Root cause: the existing `emptySlots`/`thinSlots` bonus above is
 * additive to `need`, but `need` is a MULTIPLIER on `talent` in the final value formula — a
 * center's structural "free" TAL-per-FGA efficiency (established earlier this session: centers
 * reach good TAL at low usage far more easily than guards, who need real touches to earn it) is
 * large enough (the measured ~13-point TAL gap above) that an equal or even moderately larger need
 * multiplier for a thin PG slot still loses to a simultaneously-thin C candidate's much higher raw
 * talent. Scoped to PG alone, not SG/SF/PF too — those measured close to each other (17.7-26.7%
 * share, TAL 54.2-55.9), only PG stood out as clearly, doubly underserved.
 *
 * Deliberately an EXTRA bonus on top of the existing emptySlots/thinSlots coverage gate, not a
 * flat position-wide malus/bonus — the flat version was tried for this exact "bench needs
 * stronger PG/SG/SF/PF, weaker C" ask once already this session and reverted after it overcorrected
 * (severe-backup rate 18.8%->23.4%, guards forced into a now-EMPTY C backup slot — see the
 * `inBenchRound` coverage-additive mechanism's own docstring above for the full history). This
 * bonus only ever fires when PG is ALREADY a real, roster-specific gap (`emptySlots`/`thinSlots`
 * membership, the same gate the surrounding bonus uses) — it never manufactures a preference for
 * PG on a roster that doesn't actually need one, so it can't reproduce that failure mode.
 *
 * +1.5 chosen and verified by re-running the same measurement script with the bonus active, not
 * guessed: PG bench share rose 14.2%->25.3% (avg TAL 49.4->56.7), while every other position
 * stayed in a healthy, non-collapsed 16.7-19.8% band (C 22.2%->19.8%, still the single most
 * common bench position by count in most individual runs — not starved). Cross-checked against
 * the exact failure mode the earlier flat version caused: severe (not even loosely eligible)
 * backup rate across 96 simulated teams was 12.5% — LOWER than the pre-this-bonus pool-widening-
 * only baseline (18.8-32.8% across several measurement passes), and C's own backup real-fit rate
 * stayed healthy at 75.5% (PG's own hit 100%, up from 53-60%) — the opposite of the old
 * regression, where C specifically got starved by a broad guard preference.
 */
const PG_BENCH_SCARCITY_BONUS = 1.5;

function benchPgScarcityBonus(pos: Position, needs: NeedContext): number {
  if (pos !== 'PG') return 0;
  if (needs.emptySlots.includes('PG') || needs.thinSlots.includes('PG')) return PG_BENCH_SCARCITY_BONUS;
  return 0;
}

/**
 * 2026-08-19, user-reported real diagnostic: a team's final (8th) pick took Jon Barry (SG) while
 * its C slot sat thin (Shaq alone, no real backup). Traced directly, not guessed
 * (`scripts/_checkBarryVsCenter.ts`, deleted after use): reproducing that EXACT pick in isolation
 * (this team's own drafted names removed from the pool, nobody else's) shows the lottery correctly
 * picks a real center 5/5 of 30 samples — Nic Claxton, Rudy Gobert, Tyson Chandler, DeAndre Jordan,
 * Al Horford, all real TAL 71-75 fits, never Barry. So the per-pick value comparison already works;
 * the real board's Barry outcome means those same cheap, efficient centers had already been drafted
 * by the OTHER 15 teams by pick #123 of 128 — a real, shared-pool depletion-by-round-8 problem this
 * isolated reproduction can't see. checkBenchPositionBalance.ts's own measured C thin-rate (~20%)
 * is well above what real total supply alone would predict (44 material-backup centers for 16
 * teams needing ~1-2 each) — pointing at TIMING within each team's own draft, not raw scarcity: a
 * team chasing the single highest-value thin-position candidate at each bench pick (as designed)
 * can correctly pass on an available center at pick 6-7 for a higher-value alternative, then find
 * its own preferred cheap centers gone by picks 8, even though the position pool overall wasn't
 * actually exhausted.
 *
 * Same mechanism and magnitude as `benchPgScarcityBonus` above (the one other position this
 * project has already proven needs this exact "buy it before the crowd does" nudge) — pulls a
 * team toward locking in a real center a pick or two earlier, before 16-team competition for the
 * same cheap tier catches up with it specifically. Re-measure `checkBenchPositionBalance.ts`
 * after any future change to this value; this is a first-pass magnitude, not yet grid-tuned the
 * way the PG version was.
 */
const CENTER_BENCH_SCARCITY_BONUS = 1.5;

function benchCenterScarcityBonus(pos: Position, needs: NeedContext): number {
  if (pos !== 'C') return 0;
  if (needs.emptySlots.includes('C') || needs.thinSlots.includes('C')) return CENTER_BENCH_SCARCITY_BONUS;
  return 0;
}

/** Boosts real defensive/two-way value once a self-sufficient engine covers offense alone —
 * the user's own "needs two-way players, not more offensive talent" framing for the Nash case. */
const SELF_SUFFICIENT_DEFENSE_BONUS_SCALE = 0.6;

/** Weighted-random pool size for a team's very first pick (`roster.length === 0`, where `need`
 * is already flat at 1 for everyone — see `NEED_RAMP_ROSTER_SIZE` below). Diagnosed directly
 * (2026-08-05, playtest feedback): the deterministic round-1 value ranking (talent * durability
 * - fga * BASE_FGA_PENALTY, no lottery) already places genuine peaks reasonably — Bird #10,
 * Shaq #14, Chris Paul #17 of ~300 — but the standard 5-wide lottery at *every* pick still let
 * real top-16-caliber peaks scatter well past round 1 across simulated 16-team drafts purely on
 * lottery variance, contradicting this file's own stated round-1 design goal ("essentially a
 * clean top-N-by-talent"). Narrowed only for the true first pick, not every pick — later picks
 * keep the wider pool for roster-building variety, which is a real feature, not noise. */
const FIRST_PICK_LOTTERY_POOL = 3;
const LOTTERY_POOL = 5;

/**
 * Shapes the weighted lottery over the final shortlist. The weights were linear (`n-i` → 5:4:3:2:1
 * over a 5-wide pool), which handed the AI's own top pick only 5/15 ≈ 33% — two picks in three
 * went to a candidate it rated lower, which reads in playtest as "why did they take *that*."
 * Squaring (`(n-i)²` → 25:16:9:4:1) lifts the top pick to ≈ 45% over the 5-wide pool and ≈ 64%
 * over the first-pick 3-wide pool, keeping real variety while sharpening the AI toward its own
 * evaluation. Pulled out as a constant so it's a one-number tuning knob.
 */
const LOTTERY_WEIGHT_EXPONENT = 2;
let lotteryWeightExponent = LOTTERY_WEIGHT_EXPONENT;
/** Test-only: sweep the lottery shape (`scripts/checkLotteryExponent.ts`). Not used in the app. */
export function setLotteryWeightExponent(e: number): void {
  lotteryWeightExponent = e;
}

/** `k` is the pool size; returns descending weights `[k^e, (k-1)^e, … 1^e]`. */
function lotteryWeights(k: number): number[] {
  return Array.from({ length: k }, (_, i) => Math.pow(k - i, lotteryWeightExponent));
}

/**
 * 2026-08-07, "draft nie planuje pod rolę w rotacji" — named symptom: Ewing/Jokić/Kirilenko/
 * Nash-caliber players ending up buried as backups. Root cause: `pickForAi`'s value formula only
 * ever asked "how good is this player," never "would this player actually start on the roster
 * I'm building" — `rotation.ts`'s `bestPrimaryAssignment` (the SAME exact search that decides who
 * actually starts once the roster is done) can bench a high-talent pick behind a better-fitting
 * incumbent, and the AI had no way to see that coming at draft time.
 *
 * `marginalStarterValue` asks the same question `bestPrimaryAssignment` will eventually answer,
 * right now, against the CURRENT roster only (not a claim about future picks — see the plan's own
 * honest caveat: true lookahead over other teams' future choices is a combinatorial/game-
 * theoretic problem this doesn't attempt to solve). A candidate who'd cleanly fill a real gap or
 * upgrade a weak incumbent gets full credit, same as today; a candidate who'd be strictly
 * dominated by someone already on the roster at every realistic slot gets discounted toward
 * (never all the way to) the ordinary bench-value read, since a real GM still sometimes drafts a
 * bench-caliber player on purpose (trade value, insurance, depth) — this discounts a false
 * "great value" read, it doesn't zero out bench picks. Same `ELITE_TALENT_REDUNDANCY_EXEMPTION`
 * gate as every other redundancy-style discount here: a genuine top-of-history peak is drafted
 * regardless of who's already on the roster.
 */
function marginalStarterValue(roster: PlayerSpan[], baselineStarterValue: number, candidate: PlayerSpan): number {
  return projectedStarterValue([...roster, candidate]) - baselineStarterValue;
}
const MARGINAL_STARTER_DISCOUNT_SCALE = 0.5;
const MAX_MARGINAL_STARTER_DISCOUNT = 20;
/** See the 2026-08-15 comment on its one use site (the marginal-value shortlist loop below) for
 * the full case (Bam Adebayo, 12.7 FGA for 12 real bench minutes).
 * 2026-08-15, strengthened (0.4->0.6, 6->10), same day, user-reported follow-up: even a
 * genuinely GOOD pick by the new real-coverage need signal (Domantas Sabonis closing a real C
 * gap behind David Robinson) still cost 12.5 FGA for the 12 real minutes he actually plays — the
 * coverage bonus correctly identified he was needed, but nothing pushed the AI toward the
 * CHEAPEST real-fit way to close that same gap. The original magnitude was calibrated before the
 * real-coverage `thinSlots` rewrite (see that constant's own docstring) made this bonus fire more
 * often and more strongly than before; this penalty needed to scale up to match, not because the
 * old value was wrong in isolation, but because the term it competes against got stronger. */
const FGA_WASTE_ON_BENCH_SCALE = 0.6;
const MAX_FGA_WASTE_ON_BENCH_PENALTY = 10;

/** How many roster spots it takes for need-based value (position gaps, spacing, rim
 * protection, perimeter defense, redundancy discount) to reach full strength — 0 spots filled
 * (every team's very first pick) means every one of those need flags is trivially true for
 * literally every team regardless of who's on it, which was silently handing centers/plus-
 * shooters/defensive-tagged players a large "need" multiplier edge over pure elite scorers
 * (Jordan, LeBron, Curry) who don't happen to check one of those specific boxes, even when the
 * scorer's raw talent is equal or higher — real GMs draft the best player available in round 1
 * regardless of fit and only start drafting for team construction once the core is in place.
 * Ramping need's influence in over a team's first few picks (full strength by its 4th pick)
 * lets pure talent decide the truly early picks and hands fit-awareness back for the rest. */
const NEED_RAMP_ROSTER_SIZE = 4;

/** Collapse adjacent career spans only after they have been ranked, so one real player receives
 * one lottery place while their best context-specific span remains available. */
/** User-validated peak corrections where the derived TAL/O-TAL tie does not resolve the real
 * span correctly. This changes no statistics: it only selects among real, already-legal spans
 * of the same player. Keep this narrow and evidence-backed. */
const USER_VALIDATED_PEAK_SPANS = new Map<string, string>([
  [normalizePlayerName('James Harden'), '2018-20'],
  // 2026-09-06, user-reported (AI-4 backlog item): without a pin, Shaq's draft-time representative
  // span floated to whichever of his several TAL-97-tied spans scored best in a given pick's
  // context (measured: 2003-05, a real span but not his peak, won at least once) — the mechanism
  // behind the "AI picked a clearly worse Shaq span" 2026-08-19 report. User's own call: 1999-01
  // and 2000-02 are the two real peak-offense-and-defense candidates; checked both directly —
  // 1999-01 wins on both components (O-TAL 94 vs 92, D-TAL 80 vs 74) despite the tied overall TAL
  // (97), so it's the one pinned.
  [normalizePlayerName("Shaquille O'Neal"), '1999-01'],
  // 2026-09-06, systematic follow-up: audited every name in GREATEST_PEAK_DRAFT_TIERS above for
  // the same TAL-tie pattern that caused the Shaq case. Where one tied span is Pareto-dominant
  // on BOTH O-TAL and D-TAL over every other tied span (never worse on either, strictly better on
  // at least one), pinned it directly as the same class of fix; genuine either/or tradeoffs
  // (Bird, Hakeem, Robinson — user's own call: inconsequential either way) were deliberately left
  // unpinned.
  [normalizePlayerName('Michael Jordan'), '1987-89'], // O-TAL 100/D-TAL 100, beats the other 4 TAL-99 spans (1986-88, 1988-90, 1989-91, 1990-92) on both
  [normalizePlayerName('Tim Duncan'), '2001-03'], // O-TAL 79/D-TAL 96, beats 2000-02 and 2002-04 (both TAL-97-tied) on both
  [normalizePlayerName('Kevin Garnett'), '2002-04'], // O-TAL 82/D-TAL 96, beats 2003-05 and 2004-06 (both TAL-97-tied) on both
  [normalizePlayerName('Anthony Davis'), '2017-19'], // O-TAL 85/D-TAL 96, beats 2018-20 (TAL-94-tied) on both
  // Jokić's three TAL-98-tied spans (2021-23/2023-25/2024-26) read IDENTICAL O-TAL(100)/D-TAL(57)
  // — no Pareto answer, since none differs on either axis. User's own tiebreak: the cheapest of
  // the three (16.3 FGA vs 18.5/18.6), same production for less cap cost.
  [normalizePlayerName('Nikola Jokic'), '2021-23'],
]);

function uniqueRankedPlayers<T extends { player: PlayerSpan; value: number; talent: number }>(ranked: T[]): T[] {
  const grouped = new Map<string, T[]>();
  for (const entry of ranked) {
    const key = normalizePlayerName(entry.player.playerName);
    const existing = grouped.get(key);
    if (existing) existing.push(entry);
    else grouped.set(key, [entry]);
  }

  // Rank the real player by their best context/cap value. Only an explicitly validated peak may
  // replace that representative span; a prior broad TAL/O-TAL tie-break changed unrelated center
  // spans and destabilized the whole first round. Harden 2014-16 and 2018-20 both read TAL 96 /
  // O-TAL 100, while the user-validated 2018-20 peak also carries the stronger real D-TAL.
  return [...grouped.values()].map((entries) => {
    const bestDraftEntry = entries[0];
    const key = normalizePlayerName(bestDraftEntry.player.playerName);
    const preferredSpan = USER_VALIDATED_PEAK_SPANS.get(key);
    if (!preferredSpan) return bestDraftEntry;
    const preferredEntry = entries.find((entry) => entry.player.spanLabel === preferredSpan);
    return preferredEntry ? { ...bestDraftEntry, player: preferredEntry.player, talent: preferredEntry.talent } : bestDraftEntry;
  });
}

function uniquePlayerSpans(ranked: PlayerSpan[]): PlayerSpan[] {
  const seen = new Set<string>();
  return ranked.filter((player) => {
    const key = normalizePlayerName(player.playerName);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Picks a player for an AI team: reuses the same need signals the judge scores on, so the AI
 * is playing to the same rubric. `teamCount` defaults to the real game's `TEAM_COUNT` — only
 * validation scripts simulating a different number of contending teams need to override it,
 * so the contention margin actually reflects that scenario instead of silently assuming 4.
 *
 * `pickNumber` (1-based, the caller's own running pick count — e.g. draft.ts's
 * `state.history.length + 1`) is optional and only feeds the "steal" safety net below; every
 * other signal in this function is unaffected by it, and it's safe to omit entirely (validation
 * scripts that don't track a real running pick count simply never trigger that check).
 *
 * `rng` (defaults to `Math.random`) is only consulted by the final weighted lottery — the entire
 * value pipeline above it is deterministic. `draft.ts` threads a seeded `mulberry32` stream here
 * so a whole draft can be replayed from its logged seed (see that file's `seed` field); every
 * other caller leaves it unseeded.
 */
export function pickForAi(
  roster: PlayerSpan[],
  currentFgas: number[],
  available: PlayerSpan[],
  teamCount: number = TEAM_COUNT,
  pickNumber?: number,
  rng: () => number = Math.random,
): PlayerSpan {
  const slotsLeft = ROSTER_SIZE - roster.length;
  const needs = assessNeeds(roster);
  const spent = currentFgas.reduce((s, f) => s + f, 0);
  const capRemaining = CAP_LIMIT - spent;
  const budgetPerSlot = capRemaining / slotsLeft;
  // Two independent signals, whichever is more urgent wins: a team that's overspent gets
  // pressure from tight actual cap room, and every team gets rising pressure in the last few
  // picks regardless of room left, since the endgame squeeze is structural, not just a
  // function of this one team's own spending so far.
  const budgetPressure = Math.max(0, Math.min(1, 1 - budgetPerSlot / COMFORTABLE_BUDGET_PER_SLOT));
  const slotsLeftPressure = Math.max(0, Math.min(1, (COMFORT_SLOTS_LEFT - slotsLeft) / COMFORT_SLOTS_LEFT));
  const pressure = Math.max(budgetPressure, slotsLeftPressure);
  const fgaPenalty = BASE_FGA_PENALTY + pressure * (MAX_FGA_PENALTY - BASE_FGA_PENALTY);
  const needRampProgress = Math.min(1, roster.length / NEED_RAMP_ROSTER_SIZE);

  // A DNP-tier span (maxSustainableMinutes <= 0 — the player physically couldn't stay on the
  // floor across that real stretch, e.g. Joel Embiid's 2023-25 games-missed span) isn't a real
  // draft option regardless of whether `value` below applies any durability scaling — the span
  // still occupied the "this player's name is available" slot, so a genuinely great alternate
  // span of the same person
  // (Embiid's 2020-22/2021-23, both TAL95 and fully playable) never got evaluated on its own
  // merits — the elite talent just sat undrafted the whole game instead of the AI reaching for
  // the healthier season. Excluding DNP spans from the normal candidate pool lets a real
  // alternate span win on its own value instead.
  const isDraftableDurability = (p: PlayerSpan) => maxSustainableMinutes(p, MAX_MINUTES_PER_PLAYER) > 0;

  // Built once and reused for every candidate below — rebuilding a filtered pool + sorted
  // lookup per candidate (as before) is O(n log n) per candidate, i.e. O(n^2 log n) for the
  // whole scan, which chokes once the pool is thousands of players instead of dozens.
  const lookup = buildCheapestLookup(available);
  const candidates = available.filter((p) => {
    if (!isDraftableDurability(p)) return false;
    if (!isPickCapLegal(currentFgas, p.fga)) return false;
    const slotsLeftAfterPick = slotsLeft - 1;
    if (slotsLeftAfterPick > 0) {
      const capRemainingAfterPick = CAP_LIMIT - (spent + p.fga);
      if (!canFillFromLookup(lookup, slotsLeftAfterPick, capRemainingAfterPick, normalizePlayerName(p.playerName), teamCount)) return false;
    }
    return true;
  });

  // Preserve enough cap for a *playable* remainder, not merely the cheapest mathematically
  // possible remainder. This is a planning preference layered on top of the hard lookahead:
  // fall back to `candidates` whenever the board/cap leaves no reserve-preserving choice.
  const reserveAwareCandidates = candidates.filter((p) => {
    const slotsLeftAfterPick = slotsLeft - 1;
    const capRemainingAfterPick = CAP_LIMIT - (spent + p.fga);
    return capRemainingAfterPick + 1e-9 >= plannedPlayableReserveFga(slotsLeftAfterPick);
  });
  const planningCandidates = reserveAwareCandidates.length > 0 ? reserveAwareCandidates : candidates;

  // 2026-08-15, user's explicit ask ("gracze jak KG jeśli spadają poniżej X picku... AI traktuje
  // go jako steal i wybiera z automatu"): `greatestPeakTierBonus` below is a real, but SOFT nudge
  // — it wins the weighted top-5 lottery most of the time (Kevin Garnett 2002-04 measured at
  // picks 9-15 across 15 fresh drafts) but is still a lottery, so a genuine legend can occasionally
  // slide much further on pure bad luck. This is the hard safety net for that tail: once a listed
  // legend (`GREATEST_PEAK_TIER_BY_NAME`, the same lookup `greatestPeakTierBonus` already uses —
  // matched by name + real peak-or-better talent, same rule, not a new one) is STILL on the board
  // past `STEAL_PICK_THRESHOLD`, take him immediately, bypassing the rest of this function's
  // scoring entirely — an obvious value mismatch a real GM would never pass on twice. Still
  // respects every hard constraint `candidates` above already filtered for (cap-legal, fillable,
  // durability-playable) — this can never force an illegal or unplayable pick, only skip the
  // SOFT scoring/lottery step for an unambiguous case.
  //
  // 2026-08-15 follow-up, user's explicit ask: on the rare turn where MORE than one qualifying
  // legend has fallen this far at once, don't just grab the highest raw talent blindly — prefer
  // whichever one actually fills a real gap (`needs.emptySlots`/`thinSlots`, the same signal
  // every other pick in this function already reads) over one that would only duplicate a
  // position the roster already has real depth at. This is a tie-break among steals, not a
  // filter: with only one qualifying legend on the board (the overwhelmingly common case), he's
  // still taken regardless of fit — the whole point of a "steal" is that a real GM takes him
  // anyway, same philosophy as `ELITE_TALENT_REDUNDANCY_EXEMPTION` elsewhere in this file.
  if (pickNumber !== undefined && pickNumber > STEAL_PICK_THRESHOLD) {
    const steals = planningCandidates.filter((p) => {
      const entry = GREATEST_PEAK_TIER_BY_NAME.get(normalizePlayerName(p.playerName));
      return entry !== undefined && effectiveTalent(p) >= entry.tal;
    });
    if (steals.length > 0) {
      const fillsRealGap = (p: PlayerSpan) => needs.emptySlots.includes(p.primaryPosition) || needs.thinSlots.includes(p.primaryPosition);
      return steals.sort((a, b) => {
        const gapDiff = Number(fillsRealGap(b)) - Number(fillsRealGap(a));
        return gapDiff || effectiveTalent(b) - effectiveTalent(a) || a.fga - b.fga;
      })[0];
    }
  }

  // 2026-08-07, user's own diagnosis: force the starting five to actually complete EARLY, while
  // the pool is still deep at every position (100+ per position), not late. Two hard-filter
  // attempts scoped to the ENDGAME (last 1-3 picks, pool already thinned by 13+ other teams'
  // worth of picks) both measured WORSE on severe backups than doing nothing (4.7% baseline ->
  // 17.2% "any gap" -> 25.0% "single scarcest gap") — forcing a position then costs real value
  // with few good options left, stealing draft capital from whichever OTHER position wasn't the
  // one being forced. Left undone deliberately; do not re-attempt an endgame-scoped hard filter
  // without a fundamentally different mechanism. This is the opposite scope: picks 4-5
  // specifically (right after `needRampProgress`'s pure-best-talent picks 1-3, before any bench-
  // phase logic), while a REAL starting-five slot is still empty. The pool is at its deepest
  // here, so a hard requirement rarely costs a genuinely bad pick, and it directly guarantees a
  // real 5-man starting five exists before redundancy/bench considerations ever compete for
  // those same slots — the user's own mental model ("po 5 pickach mieć starting5").
  const STARTER_LOCK_ROSTER_SIZE = STARTER_SLOTS.length;
  const MINIMUM_CREDIBLE_STARTER_TALENT = 55;
  let phaseFilteredCandidates = planningCandidates;
  if (
    DRAFT_EXPERIMENT.starterFiveLock &&
    roster.length >= NEED_RAMP_ROSTER_SIZE - 1 &&
    roster.length < STARTER_LOCK_ROSTER_SIZE &&
    needs.emptySlots.length > 0
  ) {
    const starterFillers = planningCandidates.filter((p) => needs.emptySlots.some((slot) => isRealPositionFit(p, slot)));
    if (starterFillers.length > 0) {
      // `rotationScore` treats a starter below TAL55 as a lineup-breaking weak starter. Prefer
      // candidates that clear the same boundary while the board is still deep, but retain the
      // full filler set as a cap/availability fallback so this can never dead-end the draft.
      const credibleStarterFillers = starterFillers.filter((p) => effectiveTalent(p) >= MINIMUM_CREDIBLE_STARTER_TALENT);
      phaseFilteredCandidates = credibleStarterFillers.length > 0 ? credibleStarterFillers : starterFillers;
    }
  }

  // 2026-08-07, user's follow-up diagnosis from a live draft-order export (Hakeem #5, then a
  // SECOND center — Ewing #37 — before PG/SG/SF/PF were even filled): the soft need bonuses
  // (even ramped in by pick 3) weren't enough to stop a high-usage duplicate at an
  // ALREADY-FILLED position from beating a real empty-slot candidate on raw talent. The user's
  // own rule, deliberately not absolute: a CHEAP duplicate at a filled position is fine (a
  // low-usage role player doesn't compete for cap room or a real roster slot the same way), but
  // a high-FGA duplicate — competing for real touches at a position the team doesn't need
  // more of — is excluded outright while any starting-five slot is still empty. Distinct from
  // the starter-lock above (which REQUIRES filling an empty slot at picks 4-5 specifically);
  // this instead EXCLUDES a specific bad category of pick for as long as any slot is empty,
  // independent of pick number.
  const HIGH_FGA_DUPLICATE_THRESHOLD = 15;
  if (needs.emptySlots.length > 0) {
    const withoutHighFgaDuplicates = phaseFilteredCandidates.filter((p) => {
      const positionAlreadyFilled = !needs.emptySlots.includes(p.primaryPosition);
      return !(positionAlreadyFilled && p.fga > HIGH_FGA_DUPLICATE_THRESHOLD);
    });
    if (withoutHighFgaDuplicates.length > 0) phaseFilteredCandidates = withoutHighFgaDuplicates;
  }

  // 2026-08-19, user's explicit ask, prototype for a `BENCH_SLOT_COUNT` 3->4 experiment (see that
  // constant's own docstring for the 2026-08-15 reasoning behind shrinking it to 3 in the first
  // place — the removed 4th spot routinely ended up a same-position duplicate with 0 real
  // minutes, since a position's 48 real minutes are already fully claimed once 2 real fits exist
  // there). The user's fix for a restored 4th spot: don't let the AI draft that duplicate at all
  // during bench rounds, rather than merely discount it (`samePositionRedundancyDiscount` above
  // already discounts, doesn't exclude). Hard-excludes a bench-round candidate whose EVERY real
  // position (primary + secondary) already has `REAL_FIT_REDUNDANCY_THRESHOLD` (2) real fits —
  // same threshold the existing soft discount already uses, just enforced as a wall instead of a
  // nudge. Same `ELITE_TALENT_REDUNDANCY_EXEMPTION` gate as every other redundancy mechanism here
  // (a genuine top-of-history peak still drafts regardless), and the same "never leaves zero
  // candidates" safety every hard filter in this function already follows.
  if (roster.length >= STARTER_LOCK_ROSTER_SIZE) {
    const withoutRedundantBenchPicks = phaseFilteredCandidates.filter((p) => {
      if (effectiveTalent(p) >= ELITE_TALENT_REDUNDANCY_EXEMPTION) return true;
      const positions = [p.primaryPosition, ...p.secondaryPositions];
      return positions.some((pos) => roster.filter((r) => isRealPositionFit(r, pos)).length < REAL_FIT_REDUNDANCY_THRESHOLD);
    });
    if (withoutRedundantBenchPicks.length > 0) phaseFilteredCandidates = withoutRedundantBenchPicks;
  }

  if (candidates.length === 0) {
    // Every candidate fails the strict lookahead — other teams have already drained
    // the affordable tier. Rather than picking by need/value (which could still spend
    // enough to make a later slot unaffordable), grab from the cheapest legal options
    // to preserve as much cap as possible for whatever slots remain. Still prefers a
    // playable span here (DNP is a genuinely worse pick than an ordinary cheap one, not just
    // an ignorable one), and only drops that preference in the true last-resort tiers below,
    // where filling the roster at all matters more than which span fills it.
    const capLegal = available.filter((p) => isPickCapLegal(currentFgas, p.fga) && isDraftableDurability(p));
    if (capLegal.length === 0) {
      const capLegalAnyDurability = available.filter((p) => isPickCapLegal(currentFgas, p.fga));
      if (capLegalAnyDurability.length === 0) {
        // Nothing fits under the cap at all anymore — a full (if imperfect) roster beats
        // a permanently unfillable slot, so take the single cheapest player available,
        // matching the last-resort tier `isPickLegal` allows through over the cap.
        return [...available].sort((a, b) => a.fga - b.fga)[0];
      }
      return [...capLegalAnyDurability].sort((a, b) => a.fga - b.fga)[0];
    }
    const cheapestFirst = uniquePlayerSpans([...capLegal].sort((a, b) => a.fga - b.fga));
    const cheapPool = cheapestFirst.slice(0, Math.min(5, cheapestFirst.length));
    const weights = lotteryWeights(cheapPool.length);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    let roll = rng() * totalWeight;
    for (let i = 0; i < cheapPool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return cheapPool[i];
    }
    return cheapPool[0];
  }

  // Computed once per pick (the roster is fixed across every candidate this pick) — see
  // `marginalStarterValue` above. Skipped entirely once the roster is basically full (last 2
  // picks): bench-round picks are legitimately about depth/insurance, not "will this start," and
  // the exact search's cost grows with roster size, so this also caps the worst-case per-pick
  // overhead to the rounds where the signal actually matters. The earlier 8-man prototype moved
  // this boundary from 7 to 6; because it derives from `ROSTER_SIZE`, the active 9-man format now
  // correctly restores the boundary to 7 while retaining the same "last 2 picks" proportion.
  const MARGINAL_VALUE_ROSTER_SIZE_CEILING = ROSTER_SIZE - 2;
  const baselineStarterValue = roster.length < MARGINAL_VALUE_ROSTER_SIZE_CEILING ? projectedStarterValue(roster) : null;

  // 2026-08-08, bench-shot-creator fix (options A+B): measured directly
  // (`scripts/_checkSelfCreatorDistribution.ts`, deleted after use) that gating this on
  // `needs.lacksBenchShotCreator` alone wasn't enough — 80% of teams already draft 2+ self-creator
  // (Shot Creator/Slasher) spans, but 98% of THOSE teams still end up with zero on the bench,
  // because a pick applied during starter rounds just becomes an extra starter (self-creators
  // skew high-talent, so they win an empty/thin starter slot at whatever position they play,
  // rather than ever reaching the bench) — reinforcing the exact problem instead of fixing it.
  // Restricting both options to genuine bench rounds (starters already locked, same
  // `STARTER_LOCK_ROSTER_SIZE` boundary the starter-fill phase above uses) means a pick this
  // nudges toward is one `autoAssignRotation` will actually seat on the bench, barring an
  // extreme talent mismatch with an existing starter.
  const inBenchRound = roster.length >= STARTER_LOCK_ROSTER_SIZE;

  const scoredBySpan = phaseFilteredCandidates.map((p) => {
    let need = 1;
    // 2026-08-15, user's explicit ask: with only `BENCH_SLOT_COUNT` (3) bench spots covering 5
    // starter positions, a real GM can't afford a bench built from single-position duplicates —
    // the only way 3 bodies realistically backstop 5 slots is real dual-position coverage (e.g.
    // "PG/SG + SF/PF + C"), each bench player reaching two starter positions instead of one. The
    // ORIGINAL cascade below only ever credits ONE of a candidate's real positions (primary if
    // it's in need, secondary only as a fallback if primary isn't) — a genuine dual-position
    // player who could help TWO thin slots at once got no more credit than a single-position
    // player helping just one, so nothing here previously favored the versatile pick.
    //
    // First attempt at the user's SEPARATE, earlier ask ("bench needs stronger PG/SG/SF/PF,
    // weaker C") was a flat position-wide malus/bonus — measured and reverted: it worked
    // (`scripts/_checkBenchByPosition.ts`: bench C count 61->17 across 96 teams) but overcorrected
    // into exactly the failure this fixes, confirmed directly (`checkBenchAbsurdities.ts`: severe-
    // backup rate rose 18.8%->23.4%, almost entirely off-position guards/wings forced into a
    // now-empty C backup slot). This additive-coverage version replaces that flat malus/bonus
    // entirely — a real dual-position PF/C still earns full credit for genuinely covering C (no
    // more starvation), it just no longer beats a PG/SG covering two thin guard spots by default.
    //
    // Scoped to bench rounds only (`inBenchRound`) — starter-round selection (picks before the
    // roster locks its five) is unchanged, matching how every other bench-specific mechanism in
    // this file (`lacksBenchShotCreator`, `lacksSixthMan`) is already scoped.
    if (inBenchRound) {
      for (const pos of [p.primaryPosition, ...p.secondaryPositions]) {
        if (needs.emptySlots.includes(pos)) need += 1.5;
        else if (needs.thinSlots.includes(pos)) {
          need += needs.looselyBackedThinSlots.includes(pos) ? 0.5 : 1.3;
        }
        need += benchPgScarcityBonus(pos, needs);
        need += benchCenterScarcityBonus(pos, needs);
      }
    } else {
      if (needs.emptySlots.includes(p.primaryPosition)) need += 1.5;
      // See `NeedContext.looselyBackedThinSlots`'s own docstring — a thin slot already backed by
      // an adjacent-fallback roster player gets a discounted (not zeroed) version of the thin-slot
      // pull, so a genuinely uncovered position elsewhere isn't mechanically outbid by a duplicate
      // specialist here purely on this bonus.
      else if (needs.thinSlots.includes(p.primaryPosition)) {
        need += needs.looselyBackedThinSlots.includes(p.primaryPosition) ? 0.5 : 1.3;
      }
      else if (p.secondaryPositions.some((s) => needs.emptySlots.includes(s))) need += 0.8;
      else if (p.secondaryPositions.some((s) => needs.thinSlots.includes(s))) need += 0.6;
    }
    if (needs.avgSpacing < SPACING_DEPTH_THRESHOLD) {
      const deficitRatio = (SPACING_DEPTH_THRESHOLD - needs.avgSpacing) / SPACING_DEPTH_THRESHOLD;
      need += deficitRatio * (computeSpacing(p) / 100) * SPACING_DEPTH_BONUS_SCALE;
    }
    if (needs.lacksRimProtection && RIM_PROTECTOR_ROLES.includes(p.defensiveRole)) need += 0.6;
    // A real contender stacks 2-3 perimeter defenders, not one — taper the bonus over the first
    // two starters rather than dropping it to zero the moment one is aboard (see
    // `perimeterDefenderStarterCount`'s own docstring). Third and beyond: nothing.
    if (PERIMETER_DEFENDER_ROLES.includes(p.defensiveRole)) {
      const already = needs.perimeterDefenderStarterCount;
      need += already === 0 ? 0.4 : already === 1 ? 0.25 : 0;
    }
    if (
      needs.usageWeight >= OFFENSE_HEAVY_USAGE_THRESHOLD &&
      (RIM_PROTECTOR_ROLES.includes(p.defensiveRole) || PERIMETER_DEFENDER_ROLES.includes(p.defensiveRole))
    ) {
      need += OFFENSE_HEAVY_DEFENSE_BONUS;
    }
    if (needs.usageWeight >= OFFENSE_HEAVY_USAGE_THRESHOLD) {
      need += (computeOffensivePortability(p) / 100) * OFFENSE_HEAVY_OPOR_BONUS_SCALE;
    }
    if (needs.avgDefensivePortability < DEFENSIVE_DEPTH_THRESHOLD) {
      const deficitRatio = (DEFENSIVE_DEPTH_THRESHOLD - needs.avgDefensivePortability) / DEFENSIVE_DEPTH_THRESHOLD;
      need += deficitRatio * (computeDefensivePortability(p) / 100) * DEFENSIVE_DEPTH_BONUS_SCALE;
    }
    if (needs.hasRimGravityStarter) {
      need += (computeSpacing(p) / 100) * RIM_GRAVITY_SHOOTER_BONUS_SCALE;
    }
    if (needs.hasSelfSufficientEngineStarter) {
      need += (computeDefensivePortability(p) / 100) * SELF_SUFFICIENT_DEFENSE_BONUS_SCALE;
    }
    // Option B (bench-shot-creator fix): positive pull toward a self-creator archetype while the
    // team still lacks a real bench-caliber one — see `NeedContext.lacksBenchShotCreator` and
    // `inBenchRound`'s own docstring for why this is round-gated.
    if (inBenchRound && needs.lacksBenchShotCreator && isSelfCreatorArchetype(p)) {
      need += BENCH_SHOT_CREATOR_BONUS;
    }
    // 2026-08-14, user's own "Sixth Man" idea: same round-gated positive pull as the bench-shot-
    // creator bonus above, but toward `isSixthManProfile`'s real weak-defense/scoring-specialist
    // stat profile instead of an archetype tag — see `NeedContext.lacksSixthMan`'s own docstring
    // for how the two differ.
    if (inBenchRound && needs.lacksSixthMan && isSixthManProfile(p)) {
      need += SIXTH_MAN_BONUS;
    }
    if (DRAFT_EXPERIMENT.d1d2d3Preference && isD1D2D3Player(p)) need += D1D2D3_PREFERENCE_BONUS;
    // 2026-08-14, user's explicit ask after the Jayson Tatum investigation: the AI was valuing
    // every candidate off raw `computeTalent` alone, completely blind to the same tier-cap
    // system (`grades.ts`'s `overallTierForSpan`/`displayTalentForSpan` — two-way position
    // gates, playoff collapse, era validation) that the UI already uses to tell the user "this
    // span's real production says 96, but it's only earned an All-NBA badge, not MVP+." A span
    // whose badge disagrees with its raw number was still drafted (and exempted from redundancy
    // discounting) as if it were the real top-of-history peak the raw number alone suggests.
    // `displayTalentForSpan` IS that judgment, already built and validated — reusing it here
    // instead of re-deriving a second opinion. Deliberately scoped to this one central `talent`
    // (used below for the redundancy exemption, the main value formula, and the marginal-
    // starter-value shortlist gate).
    // 2026-08-19: this and every smaller specialized malus/bonus function above
    // (`eliteLowUsageDraftMalus`, `greatestPeakTierBonus`, `highVolumeNonElitePenalty`,
    // `elitePerimeterEngineBonus`, `eliteTwoWayFrontcourtBonus`, `eliteTwoWayPeakBonus`,
    // `earlyCoreRolePenalty`) now read `effectiveTalent` (grades.ts), not raw `computeTalent` —
    // part of the project-wide display-vs-real unification (see that function's own docstring).
    // Full-pool scan found 242 spans/117 players where the two disagreed, up to 21 points (Brent
    // Barry, this file's own long-standing motivating case for `OFFENSE_HEAVY_DEFENSE_BONUS`
    // below, real=86/display=65) — those candidates were being valued here off a number higher
    // than what the game's own credibility-gated judgment (and every other real decision point)
    // actually thought they were worth.
    const talent = effectiveTalent(p);
    if (needs.usageWeight >= 2 && talent < ELITE_TALENT_REDUNDANCY_EXEMPTION) {
      const usageDiscount = (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0) * 0.5;
      // Option A (bench-shot-creator fix): this discount fires off `usageWeight`, which is
      // starter-only (see its own docstring) — it can't tell "competing with starters for
      // touches" apart from "this exact archetype is the one thing the bench still lacks," so
      // soften (not waive) it for a self-creator candidate specifically while that's still true,
      // and only in genuine bench rounds (see `inBenchRound`'s own docstring).
      const stillNeedsBenchCreator = inBenchRound && needs.lacksBenchShotCreator && isSelfCreatorArchetype(p);
      need -= stillNeedsBenchCreator ? usageDiscount * BENCH_CREATOR_DISCOUNT_SOFTEN : usageDiscount;
    }
    if (talent < ELITE_TALENT_REDUNDANCY_EXEMPTION) {
      need -= samePositionRedundancyDiscount(roster, p);
    }
    if (needs.hasElitePlaymaking && p.box.apg >= ELITE_PLAYMAKING_APG_THRESHOLD && talent < ELITE_TALENT_REDUNDANCY_EXEMPTION) {
      need -= ELITE_PLAYMAKING_REDUNDANCY_DISCOUNT;
    }
    if (needs.hasSelfSufficientEngineStarter && talent < ELITE_TALENT_REDUNDANCY_EXEMPTION) {
      need -= (HIGH_USAGE_ARCHETYPE_WEIGHT[p.offensiveArchetype] ?? 0) * SELF_SUFFICIENT_USAGE_DAMPENING;
    }

    // Ramp need's above-baseline influence (both bonuses and the redundancy discount) in over
    // a team's first few picks — see NEED_RAMP_ROSTER_SIZE above. At roster.length 0 this
    // collapses `need` to a flat 1 for everyone (pure best-talent-available); by
    // NEED_RAMP_ROSTER_SIZE picks in, `need` applies at its full computed value.
    const rampedNeed = 1 + (need - 1) * needRampProgress;

    // 2026-08-05, experiment per explicit user request: durability REMOVED from the AI's draft
    // VALUE (previously `talent * durabilityScale(...) * rampedNeed`, 2026-08-01). Reason: it
    // was diagnosed as the actual mechanism pushing genuinely elite peaks (Jokić, Anthony
    // Davis, Paul George — durabilityScale 0.85-0.95, not the full 1.0 several classic bigs
    // have) several picks below their raw-talent rank in the round-1 deterministic ranking,
    // which read as an unwanted "slide" in playtest feedback. Talent (not talent/FGA) is still
    // the primary signal — dividing by FGA mathematically favors any low-usage player over a
    // star, since talent never scales down as steeply as usage does. The legality/relief-valve
    // checks above handle hard cap-safety; `fgaPenalty` handles the softer "how much should
    // cost matter right now" question. DNP-tier spans are still excluded entirely above (a
    // separate, harder "is this specific span even playable" filter, not a value discount) —
    // removing durability from `value` does not reopen that. If reintroduced later, don't
    // silently restore the exact prior formula without re-checking this diagnosis — the
    // complaint was about elite peaks specifically, a milder/partial durability weight (rather
    // than a full multiplier) might resolve it without the all-or-nothing swing this is.
    // See `ELITE_TALENT_FGA_PENALTY_DAMPENING`'s own docstring above — a true top-of-history
    // peak still feels cap pressure, just softened, rather than being mechanically discounted
    // below a cheaper merely-very-good alternative the same way an ordinary star would be.
    const effectiveFgaPenalty = fgaPenalty * eliteTalentFgaPenaltyDampening(talent);
    const talentTerm = talent * rampedNeed;
    const fgaCost = p.fga * effectiveFgaPenalty;
    const adjustments = {
      lowUsageBigMalus: -lowUsageBigMalus(p),
      eliteLowUsageDraftMalus: -eliteLowUsageDraftMalus(p),
      highVolumeNonElitePenalty: -highVolumeNonElitePenalty(p),
      elitePerimeterEngineBonus: elitePerimeterEngineBonus(p),
      eliteTwoWayFrontcourtBonus: eliteTwoWayFrontcourtBonus(p),
      eliteTwoWayPeakBonus: eliteTwoWayPeakBonus(p),
      earlyCoreRolePenalty: -earlyCoreRolePenalty(p),
      greatestPeakTierBonus: greatestPeakTierBonus(p),
      playoffBpmDraftBonus: playoffBpmDraftBonus(p),
    };
    const value =
      talentTerm - fgaCost + Object.values(adjustments).reduce((s, v) => s + v, 0);
    // The per-candidate value breakdown is only materialised when the dev debug flag is on (see
    // `setAiDraftDebug`) — otherwise it's dead weight on the hot scoring loop.
    const debug = aiDraftDebug
      ? { talent, rampedNeed, talentTerm, fga: p.fga, effectiveFgaPenalty, fgaCost, ...adjustments }
      : undefined;
    return { player: p, value, talent, debug };
  });

  // A player may have several legal spans. The context-optimal representative used for draft
  // value can be a cheaper, lower-TAL span, while post-draft span optimization can realize a
  // stronger legal version of the same name. Keep the best legal talent by name for the bench
  // quality gate so Nate McMillan is recognized as a playable reserve even if his cheapest span
  // wins the immediate value comparison; Danny Young, whose entire profile tops out at TAL 40,
  // remains correctly below the floor.
  const bestLegalTalentByName = new Map<string, number>();
  for (const entry of scoredBySpan) {
    const key = normalizePlayerName(entry.player.playerName);
    bestLegalTalentByName.set(key, Math.max(bestLegalTalentByName.get(key) ?? 0, entry.talent));
  }

  scoredBySpan.sort((a, b) => b.value - a.value);
  const scored = uniqueRankedPlayers(scoredBySpan);

  // `marginalStarterValue` (see its own docstring above) is expensive — an exact rotation
  // search per candidate — so it's only ever applied to a generous SHORTLIST of the top-by-raw-
  // value candidates, not all ~300. It can only ever REDUCE a candidate's value, so a candidate
  // ranked below the shortlist could never have out-scored one inside it anyway; the shortlist
  // just needs to be wide enough that nothing outside it could plausibly reach the final lottery
  // pool after in-shortlist discounting. 25 comfortably covers that at `LOTTERY_POOL`'s width of
  // 5. Measured directly: without this shortlisting, a single 16-team simulated draft went from
  // a few seconds to ~80s (~300 candidates x up to 8 rounds x exact-search calls) — this cuts the
  // expensive call count by roughly (poolSize / 25).
  const MARGINAL_VALUE_SHORTLIST_SIZE = 25;
  if (baselineStarterValue !== null) {
    const shortlistCount = Math.min(MARGINAL_VALUE_SHORTLIST_SIZE, scored.length);
    for (let i = 0; i < shortlistCount; i++) {
      const entry = scored[i];
      if (entry.talent >= ELITE_TALENT_REDUNDANCY_EXEMPTION) continue;
      const marginalGain = marginalStarterValue(roster, baselineStarterValue, entry.player);
      const shortfall = Math.max(0, entry.talent - marginalGain);
      const wastedPickDiscount = Math.min(MAX_MARGINAL_STARTER_DISCOUNT, shortfall * MARGINAL_STARTER_DISCOUNT_SCALE);
      // 2026-08-15, user-reported (real diagnostic: Bam Adebayo, 12.7 FGA, projected/ended up a
      // 12-real-minute backup C — "grający 12 minut za 12.7 FGA jest problemem"): `shortfall`
      // above already answers "will this candidate actually start" (the same question
      // `marginalStarterValue` exists for) and discounts by wasted TALENT when the answer is no,
      // but says nothing about wasted FGA/cap specifically — a bench-fated candidate who's
      // expensive because he was a heavy offensive focal point in his own stint is a strictly
      // worse cap fit than an equally bench-fated candidate who's naturally cheap, even at similar
      // projected minutes, and the existing discount doesn't distinguish them. Fires only when
      // `shortfall > 0` (not a real projected starter upgrade — the same gate `wastedPickDiscount`
      // uses), scaled by the candidate's OWN fga so a high-FGA bench-fated pick pays more than a
      // low-FGA one. Magnitude picked by analogy to this file's other small profile maluses
      // (`MAX_LOW_USAGE_BIG_MALUS`=5, `MAX_ELITE_LOW_USAGE_MALUS`=3), not yet grid-measured —
      // revisit with a real simulation pass if bench FGA efficiency doesn't move as expected.
      const fgaWasteOnBench = shortfall > 0 ? Math.min(MAX_FGA_WASTE_ON_BENCH_PENALTY, entry.player.fga * FGA_WASTE_ON_BENCH_SCALE) : 0;
      entry.value -= wastedPickDiscount + fgaWasteOnBench;
    }
    // `.slice().sort()` sorts a copy, so the reordered shortlist is written back into the front
    // of `scored` explicitly rather than relying on an in-place sort of a slice.
    const shortlist = scored.slice(0, shortlistCount).sort((a, b) => b.value - a.value);
    for (let i = 0; i < shortlistCount; i++) scored[i] = shortlist[i];
  }

  let lotteryCandidates = scored;
  if (inBenchRound) {
    const scan = scored.slice(0, Math.min(BENCH_QUALITY_SCAN_SIZE, scored.length));
    let playable = scan.filter((entry) => {
      if (entry.player.fga < TRUE_CAP_GLUE_FGA_CEILING) return true;
      const projectedRotation = autoAssignRotation([...roster, entry.player]);
      const projectedMinutes = totalMinutesForPlayer(projectedRotation, entry.player.id);
      const bestLegalTalent = bestLegalTalentByName.get(normalizePlayerName(entry.player.playerName)) ?? entry.talent;
      // A 3-6 FGA player projected for 0-7 minutes is not "harmlessly cheap" — he is the exact
      // dead paid roster slot surfaced by Eric Snow/Greg Buckner/Hoiberg/Ratliff. Only true
      // sub-2-FGA glue may occupy that construction role; everyone else must project to useful
      // minutes and clear a basic talent floor.
      return (
        projectedMinutes >= USEFUL_BENCH_MINUTES &&
        entry.talent >= MATERIAL_BENCH_TALENT_FLOOR &&
        bestLegalTalent >= MATERIAL_BENCH_TALENT_FLOOR
      );
    });

    const picksIncludingThisOne = ROSTER_SIZE - roster.length;
    if (picksIncludingThisOne > 1) {
      const realRotationCandidates = playable.filter((entry) => entry.player.fga >= TRUE_CAP_GLUE_FGA_CEILING);
      if (realRotationCandidates.length > 0) playable = realRotationCandidates;
    }
    if (picksIncludingThisOne === 2) {
      // With two slots left, secure one actual rotation player first. This prevents two cheap,
      // low-TAL 3-5 FGA picks from consuming the remaining cap while neither can play.
      const qualityReserve = playable.filter((entry) => {
        if (entry.player.fga < TRUE_CAP_GLUE_FGA_CEILING) return false;
        const projectedRotation = autoAssignRotation([...roster, entry.player]);
        const projectedMinutes = totalMinutesForPlayer(projectedRotation, entry.player.id);
        const bestLegalTalent = bestLegalTalentByName.get(normalizePlayerName(entry.player.playerName)) ?? entry.talent;
        return projectedMinutes >= MATERIAL_BENCH_MINUTES && bestLegalTalent >= PENULTIMATE_ROTATION_TALENT_FLOOR;
      });
      if (qualityReserve.length > 0) playable = qualityReserve;
    } else if (picksIncludingThisOne === 1 && !roster.some((player) => player.fga < TRUE_CAP_GLUE_FGA_CEILING)) {
      // Once eight meaningful names are aboard, the ninth slot may deliberately be cap glue.
      // It is never rewarded with minutes for being cheap; rotation quality still decides that.
      const glue = playable.filter((entry) => entry.player.fga < TRUE_CAP_GLUE_FGA_CEILING);
      if (glue.length > 0) playable = glue;
    }
    // Never dead-end the draft for a soft quality preference. If the cap/board truly offers no
    // playable material-minutes option, keep the original lottery as the emergency fallback.
    if (playable.length > 0) {
      lotteryCandidates = playable;
      // 2026-08-18, user-reported (real diagnostic: repeated rosters with an all-guard bench —
      // Barros/Barry/Buckner backing up Malone/Horry/Yao at PF/SF/C with zero real fit — or the
      // mirror case, two redundant same-position bigs). Measured directly
      // (`scripts/_checkBenchPositionBalance.ts`, 64 simulated 16-team teams): PG finished the
      // draft real-fit-thin 0.0% of the time, but SF/PF/C sat thin 27-34% — because the ONLY hard
      // guarantee here (this block) was scoped to PG alone; SF/PF/C relied purely on the additive
      // `need` bonus above (`emptySlots`/`thinSlots`, same +1.5/+1.3 shape PG also gets), which a
      // higher-raw-talent guard in the SAME top-5 lottery pool can and does outscore, since `need`
      // only multiplies `talent` rather than gating the pool. PG itself needed both its own soft
      // `benchPgScarcityBonus` AND this hard narrowing to reach 0% — the soft bonus alone (which
      // SF/PF/C already have) was demonstrably not enough on its own for PG either.
      //
      // Generalized to every starter slot, not just PG: once ANY position is genuinely thin
      // (`emptySlots`/`thinSlots`, the same real-fit-minutes gate every other need signal in this
      // file already uses), a playable real fit there cannot share the narrowed lottery with an
      // unrelated candidate and vanish on random variance. Still gated by the exact same quality
      // filter above (never forces an unplayable/replacement-level pick) and still falls back to
      // the full playable set if no gap-fitting candidate exists, so a thin position that
      // genuinely has no board option left can never dead-end the draft.
      const gapPositions = STARTER_SLOTS.filter((slot) => needs.emptySlots.includes(slot) || needs.thinSlots.includes(slot));
      if (gapPositions.length > 0) {
        const playableGapFit = playable.filter((entry) => gapPositions.some((slot) => isRealPositionFit(entry.player, slot)));
        if (playableGapFit.length > 0) lotteryCandidates = playableGapFit;
      }
    }
  }

  const lotteryPoolSize = roster.length === 0 ? FIRST_PICK_LOTTERY_POOL : LOTTERY_POOL;
  const top = lotteryCandidates.slice(0, Math.min(lotteryPoolSize, lotteryCandidates.length));
  const weights = lotteryWeights(top.length);
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  let roll = rng() * totalWeight;
  const rolledFrom = roll;
  let chosenIndex = 0;
  for (let i = 0; i < top.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { chosenIndex = i; break; }
  }
  if (aiDraftDebug) {
    logDraftDebug(roster, pickNumber, top, weights, rolledFrom, totalWeight, chosenIndex);
  }
  return top[chosenIndex].player;
}
