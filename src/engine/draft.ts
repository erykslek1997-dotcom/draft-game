import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { DRAFT_EXPERIMENT } from './draftExperiment';
import { peakDraftPool } from './peakDraftPool';
import { leanDraftPool } from './leanDraftPool';
import { createInitialTeams } from './draftSetup';
import {
  ROSTER_SIZE,
  CAP_LIMIT,
  TEAM_COUNT,
  isPickCapLegal,
  totalFga,
  buildCheapestLookup,
  canFillFromLookup,
  MARGIN_PER_CONTENDING_TEAM,
  type CheapestLookup,
} from './positions';
import { pickForAi, type AiDraftRuleset, type AiDraftStrategy } from './aiDrafter';
import { mulberry32, mixSeed, randomSeed } from './rng';
import type { DraftHistoryEntry, Team } from './types';

export { TEAM_COUNT };
export const ROUNDS = ROSTER_SIZE; // 9 rounds x TEAM_COUNT teams

/** The exact pool used by the current draft profile. Exported so regression tests exercise
 * the same full-span/peak-only choice as the browser rather than assuming one of them.
 *
 * `pruneToObservedAiPool` used to filter this pool directly, which meant real gameplay
 * (Commissioner Mode included) was silently restricted to the 216-name AI-calibration test
 * allowlist instead of the full database -- after 3 rounds of a 16-team draft that left only
 * ~168 players. The AI-calibration test now builds its own pruned pool locally in
 * `scripts/analyzeAiAveragePick.ts`; `activeDraftPool` always reflects the real, full player
 * database (modulo the separate `DRAFT_EXPERIMENT.spanPoolMode` span choice, which is unrelated). */
const spanModePool =
  DRAFT_EXPERIMENT.spanPoolMode === 'peak'
    ? peakDraftPool
    : DRAFT_EXPERIMENT.spanPoolMode === 'lean'
      ? leanDraftPool
      : draftPool;
export const activeDraftPool: PlayerSpan[] = spanModePool;
const players = activeDraftPool;

export interface DraftState {
  teams: Team[];
  draftedIds: Set<string>;
  round: number; // 0-indexed
  pickInRound: number; // 0-indexed
  complete: boolean;
  history: DraftHistoryEntry[];
  /** A mode where the human manually picks for every team, one pick-and-why at a time. Kept as a
   * separate flag because `isHuman` still identifies the user's own roster for UI/export and the
   * post-draft span/rotation screens. Cap legality is identical in both modes and for every team. */
  commissionerMode: boolean;
  /** The candidate pool this draft draws from -- `activeDraftPool` (the full real database) by
   * default. Only the AI-calibration analysis script overrides this, to a small allowlisted
   * pool, so that experiment stays isolated from real gameplay instead of shrinking it. */
  pool: PlayerSpan[];
  /** uint32 seed for every random draw this draft makes — the human's slot assignment and each
   * AI team's weighted lottery. Random per draft unless `createDraft` is handed one. Logged to the
   * console in dev so a surprising draft can be replayed verbatim by passing the same value back
   * (see `createDraft`). The value pipeline that ranks candidates is fully deterministic; only the
   * final tie-break lottery consumes this. */
  seed: number;
}

// --- One-time-per-dataset lookups, built once at module load rather than re-scanning the
// full player list (thousands of entries) on every single candidate check. ---
// 2026-09-25, user-reported live ("nie mogę wydraftować" — the scouting modal listed a star's other
// years but none could be drafted): these lookups used to cover only the active (lean) pool, which
// keeps just a star's peak windows. They now cover every career window in the database, so the
// human can draft any year the scouting modal shows (the Team tab already let them switch to any
// of them after the pick), and drafting one window retires ALL of that player's windows. The CPU
// teams still choose only from `state.pool`.
const draftPoolIds = new Set(draftPool.map((p) => p.id));
const allKnownSpans = [...draftPool, ...players.filter((p) => !draftPoolIds.has(p.id))];
const playersById = new Map<string, PlayerSpan>(allKnownSpans.map((p) => [p.id, p]));
const spansByNormalizedName = new Map<string, PlayerSpan[]>();
for (const p of allKnownSpans) {
  const key = normalizePlayerName(p.playerName);
  const arr = spansByNormalizedName.get(key);
  if (arr) arr.push(p);
  else spansByNormalizedName.set(key, [p]);
}

// --- Per-DraftState memoization: these are recomputed at most once per state object,
// no matter how many individual candidates ask isPickLegal/strictPickLegal about it
// (the UI asks once per visible row, potentially thousands of times per render). ---
const availableCache = new WeakMap<DraftState, PlayerSpan[]>();
const lookupCache = new WeakMap<DraftState, CheapestLookup>();
const deadEndCache = new WeakMap<DraftState, boolean>();
const noCapLegalCache = new WeakMap<DraftState, boolean>();

/** Which draft slot (0 = picks first, ..., TEAM_COUNT-1 = picks last in round 1) the human
 * lands on — randomized per draft rather than always slot 0, like a real draft lottery.
 * Every team gets a random "Place Mascot" name (`teamNames.ts`) plus its 1-based `draftSlot`;
 * names are drawn independently of `humanIndex`, so nothing about a name reveals or depends on
 * where the human landed. Replaced the old sequential "CPU Team A/B/C" + "Your Team" scheme.
 *
 * 2026-08-16, user's own ask: the human can now supply their own team NAME (typed on the intro
 * screen, or that screen's own "🎲 randomize" button) instead of always getting one of the
 * randomly-generated "Place Mascot" names indistinguishable from the 15 CPU teams — the whole
 * point being they can actually recognize their own team on sight, including on the Draft
 * Lottery/Overview grid where all 16 names sit in one list. Only overrides the human's own slot;
 * the other 15 stay on the normal random generator untouched. A blank/whitespace-only
 * `humanTeamName` is treated the same as not passing one at all (falls through to the random
 * draw) rather than shipping a team with an empty name. */
export { createInitialTeams } from './draftSetup';

/**
 * `seed` (uint32) is optional: omitted, a fresh random one is drawn per draft. Pass one to replay
 * a draft — the same seed reproduces the human's slot and every AI lottery outcome exactly (given
 * the same pool). In dev the chosen seed is logged so a surprising draft can be pinned and
 * re-run; a `?draftSeed=` URL param wired through `GameShell` is the usual way to feed one back.
 */
export function createDraft(
  commissionerMode: boolean = false,
  pool: PlayerSpan[] = players,
  humanTeamName?: string,
  seed: number = randomSeed(),
  /** Teams already drawn for this seed (the intro's early lottery, see draftSetup.ts). */
  presetTeams?: Team[],
): DraftState {
  // Optional-chained: `import.meta.env` is undefined when an engine test script runs this under
  // tsx (no Vite), and `.DEV` on undefined would throw.
  if (import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.info(`[draft] seed ${seed} — pass ?draftSeed=${seed} to replay this draft`);
  }
  return {
    teams: presetTeams ?? createInitialTeams(humanTeamName, mulberry32(mixSeed(seed, 0))),
    draftedIds: new Set(),
    round: 0,
    pickInRound: 0,
    complete: false,
    history: [],
    commissionerMode,
    pool,
    seed,
  };
}

export function snakeOrderIndex(round: number, pickInRound: number): number {
  return round % 2 === 0 ? pickInRound : TEAM_COUNT - 1 - pickInRound;
}

export function currentTeamIndex(state: DraftState): number {
  return snakeOrderIndex(state.round, state.pickInRound);
}

export function availablePlayers(state: DraftState): PlayerSpan[] {
  let cached = availableCache.get(state);
  if (!cached) {
    cached = state.pool.filter((p) => !state.draftedIds.has(p.id));
    availableCache.set(state, cached);
  }
  return cached;
}

/**
 * True once the pool has run dry enough that the human's roster can never reach
 * `ROSTER_SIZE` players, no matter what happens from here — i.e. fewer unique real players
 * remain undrafted than the human still needs. A conservative, unambiguous check (it doesn't
 * try to account for how many of those remaining players the other teams will also compete
 * for between now and the human's last pick — that would only make this true *earlier*, never
 * later, so this is a lower bound, not an overestimate). Cap exhaustion cannot permanently
 * strand a team because `isPickLegal` has strict, cap-legal and final cheapest-player relief
 * tiers; the pool physically running out is the only unrecoverable case.
 */
export function isHumanRosterImpossible(state: DraftState): boolean {
  const humanTeam = state.teams.find((t) => t.isHuman);
  if (!humanTeam) return false;
  const slotsStillNeeded = ROSTER_SIZE - humanTeam.roster.length;
  if (slotsStillNeeded <= 0) return false;
  const uniqueRemaining = new Set(availablePlayers(state).map((p) => normalizePlayerName(p.playerName))).size;
  return uniqueRemaining < slotsStillNeeded;
}

function getCheapestLookup(state: DraftState): CheapestLookup {
  let cached = lookupCache.get(state);
  if (!cached) {
    cached = buildCheapestLookup(availablePlayers(state));
    lookupCache.set(state, cached);
  }
  return cached;
}

function advance(state: DraftState): DraftState {
  let { round, pickInRound } = state;
  pickInRound += 1;
  if (pickInRound >= TEAM_COUNT) {
    pickInRound = 0;
    round += 1;
  }
  const complete = round >= ROUNDS;
  return { ...state, round, pickInRound, complete };
}

/**
 * 2026-08-19, user's explicit, direct, escalating ask across several real reproduced cases
 * (Russell Westbrook; a 3-slots-left/11.2-FGA pick) where the "can I still complete my roster"
 * foresight check — not just its contention margin — blocked genuinely cap-legal players from
 * ever showing up for the human. First tried zeroing only the margin (`teamCount=1`); user's own
 * direct follow-up ("FULL BOARD FOR HUMAN" / "IF PLAYER IS AN IDIOT LET HIM BE") asked for the
 * whole foresight check gone for the human's own turn, not just its safety padding — real cap
 * legality on THIS pick only, no lookahead at all. The AI still needs that lookahead (it can't
 * see the human's future choices the way the human can just look at the board again next turn),
 * so this only branches on `team.isHuman` — every AI turn keeps the full, unchanged
 * `canFillFromLookup` tier-1 check, contention margin included. A human who spends into a corner
 * this way isn't stranded regardless: the existing tier-2/tier-3 fallbacks below
 * (`isPickLegal`'s own doc) still guarantee some pick is always possible, over cap if it comes to
 * that — same backstop this project already relies on everywhere else.
 */
function strictPickLegal(state: DraftState, playerId: string): boolean {
  const player = playersById.get(playerId);
  if (!player || state.draftedIds.has(playerId)) return false;

  const team = state.teams[currentTeamIndex(state)];
  const currentFgas = team.roster.map((p) => p.fga);
  if (!isPickCapLegal(currentFgas, player.fga)) return false;
  // 2026-09-24: the human used to skip the lookahead below (`if (team.isHuman) return true`),
  // which let a normal-looking run of star picks spend ~99 of 100.9 shots with 4 slots still
  // open — every card on the board then went grey with no explanation and the draft sat waiting
  // forever on a pick only the single cheapest player in the whole pool could satisfy (tier 3 of
  // `isPickLegal`). The human now gets the exact same "can you still fill the roster?" check the
  // CPU teams always had; `pickBudget` below is what the UI shows so this never feels arbitrary.

  const slotsLeftAfterPick = ROSTER_SIZE - team.roster.length - 1;
  if (slotsLeftAfterPick === 0) return true;

  const capRemainingAfterPick = CAP_LIMIT - totalFga([...currentFgas, player.fga]);
  const lookup = getCheapestLookup(state);
  return canFillFromLookup(lookup, slotsLeftAfterPick, capRemainingAfterPick, normalizePlayerName(player.playerName));
}

/**
 * True once every available player fails the strict stranding check — i.e. the other
 * teams' competition for cheap players has already produced a dead end before this
 * pick, regardless of what gets chosen now. This can happen even though every past
 * pick individually passed the strict check at the time it was made, since the other
 * teams also draft from the same shrinking pool between this team's turns.
 */
function strictCheckIsDeadEnd(state: DraftState): boolean {
  let cached = deadEndCache.get(state);
  if (cached === undefined) {
    cached = availablePlayers(state).every((p) => !strictPickLegal(state, p.id));
    deadEndCache.set(state, cached);
  }
  return cached;
}

/** True once no available player is even cap-legal on its own — a team can spend recklessly enough, early enough, that this becomes mathematically unavoidable regardless of strategy from then on. */
function noCapLegalPickExists(state: DraftState): boolean {
  let cached = noCapLegalCache.get(state);
  if (cached === undefined) {
    const team = state.teams[currentTeamIndex(state)];
    const currentFgas = team.roster.map((p) => p.fga);
    cached = availablePlayers(state).every((p) => !isPickCapLegal(currentFgas, p.fga));
    noCapLegalCache.set(state, cached);
  }
  return cached;
}

/**
 * Whether `playerId` is a legal pick for the team currently on the clock. Three tiers,
 * from strictest to a last-resort escape hatch — each only kicks in once the previous
 * one has been driven to a genuine dead end by the shared pool shrinking (own picks
 * plus the other teams' picks in between this team's turns):
 * 1. Cap-legal AND doesn't leave the team unable to afford filling its remaining slots.
 * 2. If (1) is impossible for every available player, just cap-legal is enough.
 * 3. If even (2) is impossible for every available player (the team spent its way into
 *    a corner), the single cheapest available player is allowed through even over cap —
 *    a full, if imperfect, roster beats a permanently unfillable slot.
 * Shared by `makePick` and the UI, so a button that looks enabled never silently does
 * nothing when clicked.
 */
/**
 * What the team on the clock can spend on THIS pick and still be able to fill every remaining
 * slot — the same cheapest-players-plus-contention-margin reserve `strictPickLegal` enforces,
 * surfaced as a number the UI can show ("max 14.2 shots this pick"). `maxThisPick` is a guide,
 * not the legality rule itself (`isPickLegal` stays the one gate): it assumes the reserve is
 * filled by the currently-cheapest distinct players, which is exactly what the lookahead does
 * except in the rare case where the candidate IS one of those cheapest players.
 */
export interface PickBudget {
  capLeft: number;
  slotsLeft: number;
  /** Shots set aside for the slots after this one. */
  reserved: number;
  maxThisPick: number;
}

export function pickBudget(state: DraftState, team: Team = state.teams[currentTeamIndex(state)]): PickBudget {
  const capLeft = CAP_LIMIT - totalFga(team.roster.map((p) => p.fga));
  const slotsLeft = Math.max(0, ROSTER_SIZE - team.roster.length);
  const slotsAfter = Math.max(0, slotsLeft - 1);
  let reserved = 0;
  if (slotsAfter > 0) {
    const { sorted } = getCheapestLookup(state);
    for (let i = 0; i < slotsAfter && i < sorted.length; i++) reserved += sorted[i].fga;
    reserved += MARGIN_PER_CONTENDING_TEAM * (TEAM_COUNT - 1) * slotsAfter;
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    capLeft: round1(capLeft),
    slotsLeft,
    reserved: round1(reserved),
    maxThisPick: round1(Math.max(0, capLeft - reserved)),
  };
}

/** Why `playerId` can't be drafted right now, for button tooltips — `null` when it can. */
export function pickBlockReason(state: DraftState, playerId: string): 'cap' | 'reserve' | null {
  if (isPickLegal(state, playerId)) return null;
  const player = playersById.get(playerId);
  if (!player) return 'cap';
  const team = state.teams[currentTeamIndex(state)];
  return isPickCapLegal(team.roster.map((p) => p.fga), player.fga) ? 'reserve' : 'cap';
}

export function isPickLegal(state: DraftState, playerId: string): boolean {
  if (state.complete) return false;
  const player = playersById.get(playerId);
  if (!player || state.draftedIds.has(playerId)) return false;

  // Every team follows the same cap rule. The intro, cap meter and final ranking all present the
  // rosters as comparable under one 100.9-FGA constraint, so silently exempting the human would
  // make both the strategy and the result misleading. Commissioner mode changes who clicks the
  // pick button, not the rules used to validate that pick.
  const team = state.teams[currentTeamIndex(state)];

  if (strictPickLegal(state, playerId)) return true;

  const currentFgas = team.roster.map((p) => p.fga);
  if (isPickCapLegal(currentFgas, player.fga)) return strictCheckIsDeadEnd(state);

  if (!noCapLegalPickExists(state)) return false;
  const cheapestAvailable = [...availablePlayers(state)].sort((a, b) => a.fga - b.fga)[0];
  return cheapestAvailable?.id === playerId;
}

export function makePick(state: DraftState, playerId: string): DraftState {
  if (!isPickLegal(state, playerId)) return state;

  const teamIdx = currentTeamIndex(state);
  const team = state.teams[teamIdx];
  const player = playersById.get(playerId)!;

  // Every other span of this same real player leaves the pool too — you can't draft
  // one person twice under two different stat windows (matched on a normalized name so
  // e.g. "Nikola Jokić" and "Nikola Jokic" from different data sources count as one person).
  const draftedIds = new Set(state.draftedIds);
  const siblings = spansByNormalizedName.get(normalizePlayerName(player.playerName)) ?? [player];
  for (const p of siblings) draftedIds.add(p.id);

  const teams = state.teams.map((t, i) => (i === teamIdx ? { ...t, roster: [...t.roster, player] } : t));
  const pickNumber = state.round * TEAM_COUNT + state.pickInRound + 1;
  const history = [...state.history, { pickNumber, teamId: team.id, playerId: player.id }];

  return advance({ ...state, teams, draftedIds, history });
}

/**
 * Auto-drafts every remaining pick — including the human's — via `pickForAi`, so a full 144-pick
 * draft can be skipped straight to a finished roster. The user's own ask, for testing: "add
 * auto-finish button. Good for testing." `pickForAi` doesn't care who's on the clock (it only
 * reads roster/cap/available), so this is the same logic every CPU team already uses, run for
 * all `TEAM_COUNT` teams instead of `TEAM_COUNT - 1`.
 *
 * `maxPicks` (audit AI-4) caps how many picks one call resolves — the UI passes a small number
 * and loops with a `setTimeout(0)` yield between chunks so a full auto-finish (~2500 rotation
 * builds) no longer freezes the main thread for several seconds; omitted, it resolves the whole
 * remaining draft in one synchronous call as before (scripts and tests rely on that).
 */
export function autoFinishDraft(state: DraftState, maxPicks: number = Infinity): DraftState {
  let s = state;
  let done = 0;
  while (!s.complete && done < maxPicks) {
    const next = resolveAutomatedPick(s);
    // Never spin synchronously forever if the AI's preferred candidate and the legality engine
    // disagree. `resolveAutomatedPick` already retries from the legal subset; null therefore
    // means there is genuinely no progress available and returning the partial state is safer
    // than freezing the browser.
    if (!next || next === s) break;
    s = next;
    done++;
  }
  return s;
}

/** Lightweight developer skip: fills the remaining draft with the first legal spans instead of
 * running the expensive AI scorer for every pick. It is intentionally only used by the Skip to
 * Results convenience action; normal Auto-finish keeps the quality-oriented AI path. */
export function fastFinishDraft(state: DraftState): DraftState {
  let s = state;
  while (!s.complete) {
    const legal = availablePlayers(s).filter((p) => isPickLegal(s, p.id));
    if (legal.length === 0) break;
    const next = makePick(s, legal[0].id);
    if (next === s) break;
    s = next;
  }
  return s;
}

/** Makes one automated pick and guarantees that any returned state has advanced. The AI and
 * legality engine intentionally answer slightly different questions (the AI also excludes DNP
 * spans), so an AI-preferred candidate can occasionally be rejected even though another legal
 * option exists. On that rare mismatch, re-run the AI over the actual legal subset, then fall
 * back to a direct legal scan as a final defensive guard. */
/**
 * 2026-09-16, real 16-team AI-draft strategy mix ([[pickforai_stacked_fga_stars_bug]]) — see
 * `AiDraftRuleset`'s own docstring in aiDrafter.ts for the full rationale. Deterministic off each
 * team's `draftSlot` (1-16, fixed at `createInitialTeams` time) so a draft still replays exactly
 * from its `seed`. Roughly 6/5/5 across the three named strategies.
 */
function strategyForDraftSlot(draftSlot: number): AiDraftStrategy {
  const bucket = draftSlot % 3;
  if (bucket === 2) return 'stack-stars';
  if (bucket === 0) return 'value-hunter';
  return 'starting-five-first';
}

function resolveAutomatedPick(state: DraftState): DraftState | null {
  const teamIdx = currentTeamIndex(state);
  const team = state.teams[teamIdx];
  const available = availablePlayers(state);
  if (available.length === 0) return null;

  const currentFgas = team.roster.map((p) => p.fga);
  // Same `pickNumber` formula `makePick` itself uses when recording a history entry (see that
  // function, just below) — computed from the CURRENT (pre-pick) state, since that's the pick
  // about to be made. Feeds `pickForAi`'s "steal" safety net only; see that function's own docstring.
  const pickNumber = state.round * TEAM_COUNT + state.pickInRound + 1;
  // Per-pick seeded stream off the draft's own seed, so the whole draft replays from `state.seed`.
  // One generator instance for both `pickForAi` calls below: if the preferred pick is rejected and
  // the AI re-runs over the legal subset, that second lottery just draws the next value from the
  // same stream — still fully determined by the seed.
  const rng = mulberry32(mixSeed(state.seed, pickNumber));
  const ruleset: AiDraftRuleset = { rosterSize: ROSTER_SIZE, capLimit: CAP_LIMIT, strategy: strategyForDraftSlot(team.draftSlot) };
  const preferred = pickForAi(team.roster, currentFgas, available, TEAM_COUNT, pickNumber, rng, ruleset);
  const preferredState = makePick(state, preferred.id);
  if (preferredState !== state) return preferredState;

  const legal = available.filter((p) => isPickLegal(state, p.id));
  if (legal.length === 0) return null;

  const fallback = pickForAi(team.roster, currentFgas, legal, TEAM_COUNT, pickNumber, rng, ruleset);
  const fallbackState = makePick(state, fallback.id);
  if (fallbackState !== state) return fallbackState;

  for (const player of legal) {
    const next = makePick(state, player.id);
    if (next !== state) return next;
  }
  return null;
}

/** Resolves the current pick if it belongs to an AI team. Returns null if it's the human's turn or the draft is already complete. */
export function resolveAiPickIfNeeded(state: DraftState): DraftState | null {
  if (state.complete) return null;
  const teamIdx = currentTeamIndex(state);
  const team = state.teams[teamIdx];
  if (team.isHuman) return null;
  return resolveAutomatedPick(state);
}
