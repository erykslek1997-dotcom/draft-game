import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { peakDraftPool as players } from './peakDraftPool';
import { randomTeamNames } from './teamNames';
import {
  ROSTER_SIZE,
  CAP_LIMIT,
  TEAM_COUNT,
  isPickCapLegal,
  totalFga,
  buildCheapestLookup,
  canFillFromLookup,
  type CheapestLookup,
} from './positions';
import { pickForAi } from './aiDrafter';
import type { DraftHistoryEntry, Team } from './types';

export { TEAM_COUNT };
export const ROUNDS = ROSTER_SIZE; // 9 rounds x 4 teams = 36 picks

export interface DraftState {
  teams: Team[];
  draftedIds: Set<string>;
  round: number; // 0-indexed
  pickInRound: number; // 0-indexed
  complete: boolean;
  history: DraftHistoryEntry[];
  /** 2026-08-07, user explicit ask: a mode where the human manually picks for EVERY team (to
   * play out a full causal-reasoning draft, one pick-and-why at a time), not just their own
   * randomly-assigned slot. Deliberately NOT implemented by setting every team's `isHuman` to
   * true — that would also give every team the human's cap-FREE perk below, which defeats the
   * whole point (the exercise is only useful if every team faces the same real constraints an AI
   * team would). Instead this flag alone overrides just the cap-legality bypass, leaving
   * `isHuman` purely about "which team's mini-roster panel says (You)" and UI/export labeling. */
  commissionerMode: boolean;
}

// --- One-time-per-dataset lookups, built once at module load rather than re-scanning the
// full player list (thousands of entries) on every single candidate check. ---
const playersById = new Map<string, PlayerSpan>(players.map((p) => [p.id, p]));
const spansByNormalizedName = new Map<string, PlayerSpan[]>();
for (const p of players) {
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
 * where the human landed. Replaced the old sequential "CPU Team A/B/C" + "Your Team" scheme. */
export function createInitialTeams(): Team[] {
  const humanIndex = Math.floor(Math.random() * TEAM_COUNT);
  const names = randomTeamNames(TEAM_COUNT);
  const teams: Team[] = [];
  for (let i = 0; i < TEAM_COUNT; i++) {
    // `draftSlot` is 1-based and equals the team's position in round 1 — the same index the snake
    // order runs off — so "Kentucky Chickens #4" tells a drafter exactly when that team picks.
    teams.push({
      id: `t${i}`,
      name: names[i],
      draftSlot: i + 1,
      isHuman: i === humanIndex,
      roster: [],
      rotation: null,
    });
  }
  return teams;
}

export function createDraft(commissionerMode: boolean = false): DraftState {
  return {
    teams: createInitialTeams(),
    draftedIds: new Set(),
    round: 0,
    pickInRound: 0,
    complete: false,
    history: [],
    commissionerMode,
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
    cached = players.filter((p) => !state.draftedIds.has(p.id));
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
 * later, so this is a lower bound, not an overestimate). The human has no FGA cap
 * (`isPickLegal` bypasses it entirely), so cap exhaustion can't strand them — the pool
 * physically running out is the only way their team becomes impossible to complete.
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

function strictPickLegal(state: DraftState, playerId: string): boolean {
  const player = playersById.get(playerId);
  if (!player || state.draftedIds.has(playerId)) return false;

  const team = state.teams[currentTeamIndex(state)];
  const currentFgas = team.roster.map((p) => p.fga);
  if (!isPickCapLegal(currentFgas, player.fga)) return false;

  const slotsLeftAfterPick = ROSTER_SIZE - team.roster.length - 1;
  if (slotsLeftAfterPick === 0) return true;

  const capRemainingAfterPick = CAP_LIMIT - totalFga([...currentFgas, player.fga]);
  const lookup = getCheapestLookup(state);
  return canFillFromLookup(lookup, slotsLeftAfterPick, capRemainingAfterPick, normalizePlayerName(player.playerName));
}

/**
 * True once every available player fails the strict stranding check — i.e. the four
 * teams' competition for cheap players has already produced a dead end before this
 * pick, regardless of what gets chosen now. This can happen even though every past
 * pick individually passed the strict check at the time it was made, since 3 other
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
 * plus the other 3 teams' picks in between this team's turns):
 * 1. Cap-legal AND doesn't leave the team unable to afford filling its remaining slots.
 * 2. If (1) is impossible for every available player, just cap-legal is enough.
 * 3. If even (2) is impossible for every available player (the team spent its way into
 *    a corner), the single cheapest available player is allowed through even over cap —
 *    a full, if imperfect, roster beats a permanently unfillable slot.
 * Shared by `makePick` and the UI, so a button that looks enabled never silently does
 * nothing when clicked.
 */
export function isPickLegal(state: DraftState, playerId: string): boolean {
  if (state.complete) return false;
  const player = playersById.get(playerId);
  if (!player || state.draftedIds.has(playerId)) return false;

  // The human drafts with no FGA cap at all - only the AI teams are cap-constrained (the whole
  // point of the cap is to make the AI's roster-building interesting/hard; it isn't a rule the
  // human needs to play under). The strict/lookahead/last-resort tiers below exist purely to
  // manage the AI's own cap pressure, so they never even run on the human's turn.
  // `commissionerMode` overrides this bypass — every team (including the nominally "human" one)
  // is cap-constrained exactly like an AI team, since the whole point of that mode is producing
  // real, comparable picks under the same pressure every team actually faces. See DraftState's
  // own docstring for why this is a separate flag rather than just flipping `isHuman` for all 16.
  const team = state.teams[currentTeamIndex(state)];
  if (team.isHuman && !state.commissionerMode) return true;

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
 * all `TEAM_COUNT` teams instead of `TEAM_COUNT - 1`. Synchronous — the whole draft resolves in
 * one call, unlike the normal per-pick `setTimeout` pacing the UI uses for CPU turns.
 */
export function autoFinishDraft(state: DraftState): DraftState {
  let s = state;
  while (!s.complete) {
    const teamIdx = currentTeamIndex(s);
    const team = s.teams[teamIdx];
    const available = availablePlayers(s);
    if (available.length === 0) break;
    const currentFgas = team.roster.map((p) => p.fga);
    const pick = pickForAi(team.roster, currentFgas, available);
    s = makePick(s, pick.id);
  }
  return s;
}

/** Resolves the current pick if it belongs to an AI team. Returns null if it's the human's turn or the draft is already complete. */
export function resolveAiPickIfNeeded(state: DraftState): DraftState | null {
  if (state.complete) return null;
  const teamIdx = currentTeamIndex(state);
  const team = state.teams[teamIdx];
  if (team.isHuman) return null;

  const available = availablePlayers(state);
  if (available.length === 0) return null;
  const currentFgas = team.roster.map((p) => p.fga);
  const pick = pickForAi(team.roster, currentFgas, available);
  return makePick(state, pick.id);
}
