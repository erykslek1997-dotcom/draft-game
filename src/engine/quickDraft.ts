import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { activeDraftPool } from './draft';
import { randomTeamNames } from './teamNames';
import {
  STARTER_SLOTS,
  TEAM_COUNT,
  totalFga,
  buildCheapestLookup,
  canFillFromLookup,
  isRealPositionFit,
  type CheapestLookup,
} from './positions';
import { pickForAi, type AiDraftRuleset } from './aiDrafter';
import { bestPrimaryAssignment } from './rotation';
import { mulberry32, mixSeed, randomSeed } from './rng';
import type { DraftHistoryEntry, Team, Rotation, SlotAssignment } from './types';

/**
 * "Szybka 5" (Quick 5) — 2026-09-11, user's own spec: "normalny 16 drużynowy draft, tylko
 * starting 5... Mini-draft: wybierasz 5 graczy (nie 9), bez etapu budowania rotacji/minut — od
 * razu wynik... pełny draft (kolejne piki, reagowanie na to co bierze AI) zamiast statycznej
 * łamigłówki z gotową pulą kandydatów." A real sequential 16-team draft, same AI reacting pick
 * by pick — just 5 rounds instead of 9, no bench, and a 70-shot cap (hand-estimated start,
 * "tuned not derived" the same way the real 100.9 cap started) instead of 100.9.
 *
 * Deliberately a SEPARATE, self-contained module rather than parameterizing `draft.ts` itself —
 * user's explicit choice (AskUserQuestion): "Osobna, lekka kopia silnika draftu" over "pełna
 * parametryzacja głównego silnika", specifically to keep zero risk to the real 9-man/100.9-cap
 * engine (`draft.ts`, `positions.ts`, `DraftBoard.tsx`, `RotationBuilder.tsx`, `GameShell.tsx` are
 * all untouched by this file). The one piece that genuinely IS reused, not forked, is the AI pick
 * logic itself (`pickForAi`) — see aiDrafter.ts's own `AiDraftRuleset` docstring for why that one
 * function became parameterizable instead of duplicated.
 */

export const QUICK_ROSTER_SIZE = STARTER_SLOTS.length; // 5 — no bench slots at all
export const QUICK_ROUNDS = QUICK_ROSTER_SIZE;
export const QUICK_CAP_LIMIT = 70;

const RULESET: AiDraftRuleset = { rosterSize: QUICK_ROSTER_SIZE, capLimit: QUICK_CAP_LIMIT };

const players = activeDraftPool;
const playersById = new Map<string, PlayerSpan>(players.map((p) => [p.id, p]));
const spansByNormalizedName = new Map<string, PlayerSpan[]>();
for (const p of players) {
  const key = normalizePlayerName(p.playerName);
  const arr = spansByNormalizedName.get(key);
  if (arr) arr.push(p);
  else spansByNormalizedName.set(key, [p]);
}

export interface QuickDraftState {
  teams: Team[];
  draftedIds: Set<string>;
  round: number; // 0-indexed
  pickInRound: number; // 0-indexed
  complete: boolean;
  history: DraftHistoryEntry[];
  seed: number;
}

const availableCache = new WeakMap<QuickDraftState, PlayerSpan[]>();
const lookupCache = new WeakMap<QuickDraftState, CheapestLookup>();
const deadEndCache = new WeakMap<QuickDraftState, boolean>();
const noCapLegalCache = new WeakMap<QuickDraftState, boolean>();

/** Same slot/name-assignment shape as `draft.ts`'s `createInitialTeams`, kept in sync deliberately
 * (a real duplicate, not imported — that function is 9-man/100.9-cap `DraftState`-shaped, this one
 * is `QuickDraftState`-shaped; they'd need a shared generic to actually merge, not worth it for
 * ~15 lines). */
function createInitialTeams(humanTeamName: string | undefined, rng: () => number): Team[] {
  const humanIndex = Math.floor(rng() * TEAM_COUNT);
  const names = randomTeamNames(TEAM_COUNT);
  const trimmedHumanName = humanTeamName?.trim();
  if (trimmedHumanName) names[humanIndex] = trimmedHumanName;
  const teams: Team[] = [];
  for (let i = 0; i < TEAM_COUNT; i++) {
    teams.push({ id: `t${i}`, name: names[i], draftSlot: i + 1, isHuman: i === humanIndex, roster: [], rotation: null });
  }
  return teams;
}

export function createQuickDraft(humanTeamName?: string, seed: number = randomSeed()): QuickDraftState {
  if (import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.info(`[quickDraft] seed ${seed}`);
  }
  return {
    teams: createInitialTeams(humanTeamName, mulberry32(mixSeed(seed, 0))),
    draftedIds: new Set(),
    round: 0,
    pickInRound: 0,
    complete: false,
    history: [],
    seed,
  };
}

export function snakeOrderIndex(round: number, pickInRound: number): number {
  return round % 2 === 0 ? pickInRound : TEAM_COUNT - 1 - pickInRound;
}

export function currentTeamIndex(state: QuickDraftState): number {
  return snakeOrderIndex(state.round, state.pickInRound);
}

export function availablePlayers(state: QuickDraftState): PlayerSpan[] {
  let cached = availableCache.get(state);
  if (!cached) {
    cached = players.filter((p) => !state.draftedIds.has(p.id));
    availableCache.set(state, cached);
  }
  return cached;
}

function getCheapestLookup(state: QuickDraftState): CheapestLookup {
  let cached = lookupCache.get(state);
  if (!cached) {
    cached = buildCheapestLookup(availablePlayers(state));
    lookupCache.set(state, cached);
  }
  return cached;
}

function advance(state: QuickDraftState): QuickDraftState {
  let { round, pickInRound } = state;
  pickInRound += 1;
  if (pickInRound >= TEAM_COUNT) {
    pickInRound = 0;
    round += 1;
  }
  const complete = round >= QUICK_ROUNDS;
  return { ...state, round, pickInRound, complete };
}

function isCapLegal(currentFgas: number[], candidateFga: number): boolean {
  return totalFga([...currentFgas, candidateFga]) <= QUICK_CAP_LIMIT;
}

/** Same three-tier shape as `draft.ts`'s `isPickLegal` — full lookahead for the human ONLY on
 * cap-legality (see that file's own docstring on why the human's own turn skips the "will this
 * strand me" foresight check entirely, "FULL BOARD FOR HUMAN"), full lookahead for AI teams,
 * degrading to plain cap-legal, then a last-resort cheapest-available escape hatch. */
function strictPickLegal(state: QuickDraftState, playerId: string): boolean {
  const player = playersById.get(playerId);
  if (!player || state.draftedIds.has(playerId)) return false;

  const team = state.teams[currentTeamIndex(state)];
  const currentFgas = team.roster.map((p) => p.fga);
  if (!isCapLegal(currentFgas, player.fga)) return false;
  if (team.isHuman) return true;

  const slotsLeftAfterPick = QUICK_ROSTER_SIZE - team.roster.length - 1;
  if (slotsLeftAfterPick === 0) return true;

  const capRemainingAfterPick = QUICK_CAP_LIMIT - totalFga([...currentFgas, player.fga]);
  const lookup = getCheapestLookup(state);
  return canFillFromLookup(lookup, slotsLeftAfterPick, capRemainingAfterPick, normalizePlayerName(player.playerName));
}

function strictCheckIsDeadEnd(state: QuickDraftState): boolean {
  let cached = deadEndCache.get(state);
  if (cached === undefined) {
    cached = availablePlayers(state).every((p) => !strictPickLegal(state, p.id));
    deadEndCache.set(state, cached);
  }
  return cached;
}

function noCapLegalPickExists(state: QuickDraftState): boolean {
  let cached = noCapLegalCache.get(state);
  if (cached === undefined) {
    const team = state.teams[currentTeamIndex(state)];
    const currentFgas = team.roster.map((p) => p.fga);
    cached = availablePlayers(state).every((p) => !isCapLegal(currentFgas, p.fga));
    noCapLegalCache.set(state, cached);
  }
  return cached;
}

export function isQuickPickLegal(state: QuickDraftState, playerId: string): boolean {
  if (state.complete) return false;
  const player = playersById.get(playerId);
  if (!player || state.draftedIds.has(playerId)) return false;

  if (strictPickLegal(state, playerId)) return true;

  const team = state.teams[currentTeamIndex(state)];
  const currentFgas = team.roster.map((p) => p.fga);
  if (isCapLegal(currentFgas, player.fga)) return strictCheckIsDeadEnd(state);

  if (!noCapLegalPickExists(state)) return false;
  const cheapestAvailable = [...availablePlayers(state)].sort((a, b) => a.fga - b.fga)[0];
  return cheapestAvailable?.id === playerId;
}

export function makeQuickPick(state: QuickDraftState, playerId: string): QuickDraftState {
  if (!isQuickPickLegal(state, playerId)) return state;

  const teamIdx = currentTeamIndex(state);
  const team = state.teams[teamIdx];
  const player = playersById.get(playerId)!;

  const draftedIds = new Set(state.draftedIds);
  const siblings = spansByNormalizedName.get(normalizePlayerName(player.playerName)) ?? [player];
  for (const p of siblings) draftedIds.add(p.id);

  const teams = state.teams.map((t, i) => (i === teamIdx ? { ...t, roster: [...t.roster, player] } : t));
  const pickNumber = state.round * TEAM_COUNT + state.pickInRound + 1;
  const history = [...state.history, { pickNumber, teamId: team.id, playerId: player.id }];

  return advance({ ...state, teams, draftedIds, history });
}

/** Slots `bestPrimaryAssignment` itself would currently leave empty given this partial roster —
 * NOT the same as "no player has real fit here": a per-slot existence check isn't enough, since
 * two players can each individually fit a slot but the actual optimal one-to-one assignment still
 * can't cover both simultaneously (a real bipartite-matching subtlety a naive per-slot check
 * missed in testing — half of all CPU fives still finished with a gap even after the first,
 * per-slot-only version of this guard). Reusing the real search directly instead of re-deriving a
 * simpler approximation of it is what makes this check trustworthy. */
function openSlots(roster: PlayerSpan[]): typeof STARTER_SLOTS {
  const { assignment } = bestPrimaryAssignment(roster);
  return STARTER_SLOTS.filter((slot) => !assignment[slot]);
}

/**
 * 2026-09-11: a 5-round draft is short enough that `pickForAi`'s normal (heavily weighted, not
 * guaranteed) positional-need scoring left roughly half of all CPU fives with an uncovered slot
 * in testing (two SGs and no SF, say) — the extra rounds a 9-man draft has to eventually correct
 * that don't exist here. Rather than touch `pickForAi`'s shared scoring (used by the real 9-man
 * draft too), this narrows the CANDIDATE POOL a CPU team's pick is chosen from, only once it's at
 * (or past) the exact tipping point where every remaining pick must land a genuinely open slot or
 * coverage becomes mathematically impossible — the AI's own value-based choice still decides WHICH
 * eligible player, just no longer free to spend a now-critical pick on a redundant position.
 * Deliberately CPU-only: the human's own turn stays fully unrestricted, same "FULL BOARD FOR
 * HUMAN" philosophy `draft.ts`'s own `strictPickLegal` docstring already established — a human who
 * drafts two SGs and skips SF is a strategic choice to live with, not something to block.
 */
function resolveAutomatedPick(state: QuickDraftState): QuickDraftState | null {
  const teamIdx = currentTeamIndex(state);
  const team = state.teams[teamIdx];
  let available = availablePlayers(state);
  if (available.length === 0) return null;

  const picksLeftForTeam = QUICK_ROSTER_SIZE - team.roster.length; // includes this pick
  const gaps = openSlots(team.roster);
  // One pick of slack (`- 1`, not the exact tipping point) — a guard that only ever fires at the
  // literal last-possible moment can still be one pick too late if an earlier UNCONSTRAINED pick
  // happens to open a second gap at once; constraining one pick earlier leaves room to recover
  // from that case too. Even with this, a real (if rare, ~8% of CPU fives measured — see
  // `scripts/_quickDraftCheck.ts` during development) residual risk remains: `bestPrimaryAssignment`
  // is a true bipartite matching, so which slots are "covered" can shift as a new player is added,
  // not just monotonically fill — fully eliminating that would mean re-running the (expensive,
  // ~ms-per-call) assignment search per candidate, not worth the cost for a rare cosmetic gap a
  // finished five already degrades gracefully from (one drafted player just rides the bench).
  if (gaps.length >= picksLeftForTeam - 1) {
    const locked = available.filter((p) => gaps.some((slot) => isRealPositionFit(p, slot)));
    if (locked.length > 0) available = locked;
  }

  const currentFgas = team.roster.map((p) => p.fga);
  const pickNumber = state.round * TEAM_COUNT + state.pickInRound + 1;
  const rng = mulberry32(mixSeed(state.seed, pickNumber));
  const preferred = pickForAi(team.roster, currentFgas, available, TEAM_COUNT, pickNumber, rng, RULESET);
  const preferredState = makeQuickPick(state, preferred.id);
  if (preferredState !== state) return preferredState;

  const legal = available.filter((p) => isQuickPickLegal(state, p.id));
  if (legal.length === 0) return null;

  const fallback = pickForAi(team.roster, currentFgas, legal, TEAM_COUNT, pickNumber, rng, RULESET);
  const fallbackState = makeQuickPick(state, fallback.id);
  if (fallbackState !== state) return fallbackState;

  for (const player of legal) {
    const next = makeQuickPick(state, player.id);
    if (next !== state) return next;
  }
  return null;
}

export function resolveQuickAiPickIfNeeded(state: QuickDraftState): QuickDraftState | null {
  if (state.complete) return null;
  const teamIdx = currentTeamIndex(state);
  const team = state.teams[teamIdx];
  if (team.isHuman) return null;
  return resolveAutomatedPick(state);
}

export function autoFinishQuickDraft(state: QuickDraftState): QuickDraftState {
  let s = state;
  let guard = 0;
  while (!s.complete && guard++ < QUICK_ROUNDS * TEAM_COUNT + 1) {
    const next = resolveAutomatedPick(s);
    if (!next || next === s) break;
    s = next;
  }
  return s;
}

/** Every finished team gets a fixed 48-min-per-starter rotation — same "bare five, no bench"
 * choice Best Five's own `lineupTeam` makes, and for the same reason: `autoAssignRotation`'s
 * minutes-distribution half is wrong for a roster with no bench to lean on. The SLOT assignment
 * itself (which of the 5 drafted players plays which position) reuses `bestPrimaryAssignment`
 * directly — the same optimal, tier-gated search `autoAssignRotation` uses internally — rather
 * than a naive "primary position, first match wins" guess that could hand a slot to a player who
 * fits it worse than a teammate would. */
export function finalizeQuickRotation(team: Team): Team {
  const { assignment } = bestPrimaryAssignment(team.roster);
  const slots = {} as Rotation['slots'];
  for (const slot of STARTER_SLOTS) {
    const p = assignment[slot];
    slots[slot] = p ? [{ playerId: p.id, minutes: 48 } satisfies SlotAssignment] : [];
  }
  return { ...team, rotation: { slots } };
}
