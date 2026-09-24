import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Position } from '../data/schema';
import type { Team } from '../engine/types';
import {
  createQuickDraft,
  currentTeamIndex,
  makeQuickPick,
  resolveQuickAiPickIfNeeded,
  autoFinishQuickDraft,
  isQuickPickLegal,
  quickPickBlockReason,
  quickPickBudget,
  finalizeQuickRotation,
  QUICK_CAP_LIMIT,
  QUICK_ROUNDS,
  type QuickDraftState,
} from '../engine/quickDraft';
import { peakDraftPool } from '../engine/peakDraftPool';
import { totalFga, TEAM_COUNT, STARTER_SLOTS } from '../engine/positions';
import { bestPrimaryAssignment } from '../engine/rotation';
import { scoreLineup, WEIGHTED_AXES, WEAK_AXIS_REASON, type Lineup, type LineupScore } from '../engine/bestFive';
import { allStarCount } from '../engine/allStarLookup';
import { tierRank, overallTierForSpan } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { teamCodes, teamLabel } from '../engine/teamNames';
import { Face, ShotChip, ShotsMeter, shortenName } from './ShotChip';
import DraftLottery from './DraftLottery';
import { ALL_POSITIONS } from './DraftBoard';
import './QuickFive.css';
import { AI_SPEED_LABELS, useAiSpeed } from './aiSpeed';
import { AiSpeedControl, DraftTicker, LeaveDraftDialog, type TickerPick } from './DraftChrome';

interface Props {
  humanTeamName?: string;
  onExit: () => void;
}

type Phase = 'lottery' | 'draft' | 'results';

// 2026-09-17, user's own ask: a real "how to play?" on the lottery screen, same as the full draft
// — but this mode's own rules, not a copy of the 9-round ones (no bench/rotation step, no span
// choice, a different cap/round count).
const QUICK_HOW_TO_PLAY = [
  { title: 'Draft', body: `${TEAM_COUNT} teams take turns, ${QUICK_ROUNDS} rounds — one starter each round, no bench. You control one team; the rest are CPU.` },
  { title: 'Shot cap', body: `Every pick costs shots. Your five starters have to fit under ${QUICK_CAP_LIMIT} shots.` },
  { title: 'Peak only', body: "No span picking — every player is shown at their single best season, so each pick is quick." },
  { title: 'Grading', body: 'The judge scores your five the same way the full draft does — talent, offense, defense, spacing, fit — right after your last pick.' },
];

/**
 * "Szybka 5" — a real 16-team, pick-by-pick draft (same AI reacting live as the full 9-round
 * draft), just 5 rounds/starters-only and a 70-shot cap instead of 100.9. See `quickDraft.ts` for
 * the engine side and why this is a separate module rather than a parameterized `draft.ts`.
 *
 * Deliberately its own lean UI too — `DraftBoard.tsx`/`ResultsScreen.tsx` are both deeply
 * 9-man/100.9-cap shaped (judge-metric columns sized for 9 rounds, championship/matchup features
 * that don't translate to a bare five under a different cap) — reusing them directly would mean
 * either forking huge swaths of them or leaving dead 9-man UI chrome half-visible. This screen
 * reuses the small, genuinely generic pieces instead (`DraftLottery`, `Face`/`ShotChip`/
 * `ShotsMeter` — shared with Best Five, user's own ask: "podobne kafelki jak w build the best 5" —
 * `scoreLineup`/`WEAK_AXIS_REASON` from the bare-five scoring path Best Five already validated)
 * and builds its own compact Draft/Results.
 *
 * One card per PLAYER, not per span — user's own steer: "ograniczamy do najlepszego sezonu...
 * gracz nie wybiera sezonu, tylko gracza." Drafts straight from `peakDraftPool` (one real,
 * tier-capped-peak span per player), not `draft.ts`'s own multi-span `activeDraftPool` — there is
 * no span picker anywhere in this mode, by design, not just by omission.
 */
export default function QuickFive({ humanTeamName, onExit }: Props) {
  const [state, setState] = useState<QuickDraftState>(() => createQuickDraft(humanTeamName));
  const [phase, setPhase] = useState<Phase>('lottery');
  // 2026-09-24: same CPU-speed choice as the All-Time Draft (aiSpeed.ts), a "← Menu" with a
  // confirm instead of a bare Exit at the very bottom, and every phase opening at the top.
  const aiSpeed = useAiSpeed();
  const [confirmExit, setConfirmExit] = useState(false);
  const closeExitDialog = useCallback(() => setConfirmExit(false), []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);
  /** New draft (no seed) or "Rematch this board" (same seed), straight from the results. */
  function restart(seed?: number) {
    const humanName = state.teams.find((t) => t.isHuman)?.name ?? humanTeamName;
    setState(createQuickDraft(humanName, seed));
    setSearch('');
    setSelectedPosition('ALL');
    setPhase('lottery');
  }
  const [autoFinishing, setAutoFinishing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<Position | 'ALL'>('ALL');

  const teamIdx = currentTeamIndex(state);
  const currentTeam = state.teams[teamIdx];
  const humanTeam = state.teams.find((t) => t.isHuman)!;
  const canPick = currentTeam.isHuman;
  const teamCodeByTeamId = useMemo(() => teamCodes(state.teams), [state.teams]);

  // Auto-resolve CPU turns, same pacing the main draft's default 'Normal' speed uses.
  useEffect(() => {
    if (phase !== 'draft' || state.complete || autoFinishing) return;
    if (state.teams[currentTeamIndex(state)].isHuman) return;
    const timer = setTimeout(() => {
      const next = resolveQuickAiPickIfNeeded(state);
      if (next) setState(next);
    }, aiSpeed.delayMs);
    return () => clearTimeout(timer);
  }, [state, phase, autoFinishing, aiSpeed.delayMs]);

  // Once the draft ends, move straight to results — no rotation-building step at all (user's own
  // spec: "bez etapu budowania rotacji/minut — od razu wynik").
  useEffect(() => {
    if (state.complete && phase === 'draft') setPhase('results');
  }, [state.complete, phase]);

  useEffect(() => {
    if (autoFinishing && state.complete) setAutoFinishing(false);
  }, [autoFinishing, state.complete]);

  function handleAutoFinish() {
    setAutoFinishing(true);
    setState((s) => autoFinishQuickDraft(s));
  }

  function handlePick(playerId: string) {
    setState((s) => makeQuickPick(s, playerId));
  }

  return (
    <div className="at-shell">
      {phase !== 'lottery' && (
        <button
          type="button"
          className="at-menu-btn at-cond"
          onClick={() => (phase === 'results' ? onExit() : setConfirmExit(true))}
        >
          ← Menu
        </button>
      )}
      {confirmExit && (
        <LeaveDraftDialog text="Quick 5 drafts aren't saved — leaving ends this one." onStay={closeExitDialog} onLeave={onExit} />
      )}
      {phase !== 'lottery' && <div className="at-board-brand at-cond">Quick 5</div>}
      {phase === 'draft' && !state.complete && (
        <div className="at-topbar">
          <AiSpeedControl labels={AI_SPEED_LABELS} index={aiSpeed.index} onChange={aiSpeed.setIndex} />
        </div>
      )}
      {phase === 'lottery' && (
        <DraftLottery teams={state.teams} onDone={() => setPhase('draft')} howToPlay={QUICK_HOW_TO_PLAY} onExit={onExit} />
      )}
      {phase === 'draft' && (
        <QuickDraftBoard
          state={state}
          canPick={canPick}
          currentTeam={currentTeam}
          humanTeam={humanTeam}
          teamCodeByTeamId={teamCodeByTeamId}
          search={search}
          setSearch={setSearch}
          selectedPosition={selectedPosition}
          setSelectedPosition={setSelectedPosition}
          onPick={handlePick}
          onAutoFinish={handleAutoFinish}
          autoFinishing={autoFinishing}
          teamIdx={teamIdx}
        />
      )}
      {phase === 'results' && (
        <QuickResults
          state={state}
          teamCodeByTeamId={teamCodeByTeamId}
          onExit={onExit}
          onNewDraft={() => restart()}
          onRematch={() => restart(state.seed)}
        />
      )}
    </div>
  );
}

/**
 * 2026-09-11, user-reported live ("długi czas ładowania po wciśnięciu play"): the whole candidate
 * pool's expensive per-player tier lookup (`overallTierForSpan`/`tierContextFor` chain through
 * several real-data corrections, not cheap — DraftBoard.tsx's own "bardzo wolno" perf bug,
 * 2026-09-02, was exactly this same trap) used to be recomputed on EVERY pick, because it lived in
 * a `useMemo` keyed on `state` (which changes every pick, correctly, but only the "which players
 * are still available" part actually needs to). Built once here, at module scope, over the whole
 * immutable `peakDraftPool` — same fix shape DraftBoard.tsx's own `enrichedGroups` memo already
 * uses — so a pick, a search keystroke, or a position-filter click only ever re-runs the CHEAP
 * filter/sort pass in `filtered` below, never this. One entry per player already (see this file's
 * own top docstring), so no per-player span-grouping/reduce is needed here at all, unlike
 * DraftBoard.tsx's own multi-span pool.
 */
const allEnrichedOnce = peakDraftPool.map((span) => ({
  span,
  tier: overallTierForSpan(tierContextFor(span)),
}));

function QuickDraftBoard({
  state,
  canPick,
  currentTeam,
  humanTeam,
  teamCodeByTeamId,
  search,
  setSearch,
  selectedPosition,
  setSelectedPosition,
  onPick,
  onAutoFinish,
  autoFinishing,
  teamIdx,
}: {
  state: QuickDraftState;
  canPick: boolean;
  currentTeam: Team;
  humanTeam: Team;
  teamCodeByTeamId: Map<string, string>;
  search: string;
  setSearch: (v: string) => void;
  selectedPosition: Position | 'ALL';
  setSelectedPosition: (v: Position | 'ALL') => void;
  onPick: (id: string) => void;
  onAutoFinish: () => void;
  autoFinishing: boolean;
  teamIdx: number;
}) {
  // Cheap pass only: drop drafted players, position filter, search box, tier sort — no per-player
  // tier-lookup call here, that's all already done once in `allEnrichedOnce` above. Re-runs on
  // every pick AND every keystroke, same as DraftBoard.tsx's own `groups` memo.
  // 2026-09-24: this pick's shot budget (the same "can you still fill the five?" rule every team
  // now plays under) and an "only players that fit" filter the stuck-board notice can switch on.
  const budget = useMemo(() => quickPickBudget(state), [state]);
  const [onlyFits, setOnlyFits] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allEnrichedOnce
      .filter((e) => !state.draftedIds.has(e.span.id))
      .filter((e) => (onlyFits && canPick ? isQuickPickLegal(state, e.span.id) : true))
      .filter((e) => (selectedPosition !== 'ALL' ? e.span.primaryPosition === selectedPosition : true))
      .filter((e) => e.span.playerName.toLowerCase().includes(q))
      .sort((a, b) => {
        const tierDiff = tierRank(b.tier) - tierRank(a.tier);
        if (tierDiff !== 0) return tierDiff;
        return allStarCount(b.span.playerName) - allStarCount(a.span.playerName);
      })
      .slice(0, 80);
  }, [state, search, selectedPosition, onlyFits, canPick]);
  const anyLegal = !canPick || filtered.some((e) => isQuickPickLegal(state, e.span.id));
  const recentPicks: TickerPick[] = useMemo(() => {
    const spanById = new Map(state.teams.flatMap((t) => t.roster.map((p) => [p.id, p] as const)));
    return state.history
      .slice(-4)
      .reverse()
      .map((h) => {
        const name = spanById.get(h.playerId)?.playerName ?? '—';
        const parts = name.split(' ');
        return {
          pickNumber: h.pickNumber,
          teamCode: teamCodeByTeamId.get(h.teamId) ?? '',
          isHuman: Boolean(state.teams.find((t) => t.id === h.teamId)?.isHuman),
          shortName: parts.length < 2 ? name : `${parts[0][0]}. ${parts[parts.length - 1]}`,
        };
      });
  }, [state.history, state.teams, teamCodeByTeamId]);
  const picksAway = useMemo(() => {
    const start = state.round * TEAM_COUNT + state.pickInRound;
    for (let k = start; k < TEAM_COUNT * QUICK_ROUNDS; k++) {
      const round = Math.floor(k / TEAM_COUNT);
      const pick = k % TEAM_COUNT;
      if (state.teams[round % 2 === 0 ? pick : TEAM_COUNT - 1 - pick].isHuman) return k - start;
    }
    return null;
  }, [state.round, state.pickInRound, state.teams]);

  const humanFgas = humanTeam.roster.map((p) => p.fga);
  // Not `capRemaining` from positions.ts — that hardcodes the real 9-man CAP_LIMIT (100.9), wrong
  // for Szybka 5's own 70-shot cap.
  const humanShotsUsed = totalFga(humanFgas);
  // 2026-09-11, user-reported live ("nie wiem jakie pozycje mam obstawione" — the panel used to
  // list picks in draft order with no position label, so you couldn't tell PG/SG/SF/PF/C coverage
  // at a glance). Same optimal slot search `finalizeQuickRotation`/`QuickResults` already use to
  // decide "who plays where" for scoring, reused here so the live panel matches what the result
  // screen will actually grade instead of showing a second, different guess at the lineup.
  const humanAssignment = useMemo(
    () => bestPrimaryAssignment(humanTeam.roster).assignment,
    [humanTeam.roster],
  );

  return (
    <div className="at-card">
      <DraftTicker
        youOnClock={canPick}
        complete={state.complete}
        onClockLabel={teamLabel(currentTeam)}
        picksAway={picksAway}
        recentPicks={recentPicks}
        boardOpen={boardOpen}
        onToggleBoard={() => setBoardOpen((o) => !o)}
      />
      {boardOpen && (
      <div className="at-grid-scroll" style={{ marginBottom: 16 }}>
        <table className="at-ov-grid">
          <thead>
            <tr>
              <th className="at-teamcol">Team</th>
              {Array.from({ length: QUICK_ROUNDS }, (_, r) => (
                <th key={r} className="at-rnd">
                  {r + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.teams.map((team, i) => (
              <tr key={team.id} className={`${team.isHuman ? 'at-you' : ''} ${i === teamIdx ? 'at-clock' : ''}`}>
                <td className="at-teamcol">
                  <span className="at-team-chip" tabIndex={0}>
                    {teamCodeByTeamId.get(team.id)}
                  </span>
                  <span className="at-team-name-full">
                    {teamLabel(team)}
                    {team.isHuman && <span className="at-lottery-you-tag">YOU</span>}
                  </span>
                </td>
                {Array.from({ length: QUICK_ROUNDS }, (_, r) => {
                  const pick = team.roster[r];
                  if (pick) {
                    return (
                      <td key={r} className="at-pickcell">
                        <span className="at-name-tip" tabIndex={0}>
                          {pick.playerName}
                        </span>
                      </td>
                    );
                  }
                  if (i === teamIdx && r === team.roster.length) {
                    return (
                      <td key={r} className="at-onclock">
                        on the clock…
                      </td>
                    );
                  }
                  return (
                    <td key={r} className="at-empty">
                      —
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      )}

      <div style={{ height: 12 }} />
      <div className="at-turn-sticky">
        {!canPick ? (
          <div className="at-cpu-turn-banner">{teamLabel(currentTeam)} is picking…</div>
        ) : (
          <div className="at-your-turn-banner" role="status">
            <span className="at-your-turn-title at-cond">Your pick</span>
            <span>
              Round {state.round + 1}/{QUICK_ROUNDS} · up to <b>{budget.maxThisPick}</b> shots this pick
              {budget.slotsLeft > 1 && (
                <span className="at-your-turn-reserve">
                  {' '}
                  ({budget.reserved} kept for your other {budget.slotsLeft - 1} pick{budget.slotsLeft - 1 === 1 ? '' : 's'})
                </span>
              )}
            </span>
          </div>
        )}
        {canPick && !anyLegal && (
          <div className="at-budget-notice">
            <span>None of the players shown fit this pick — max {budget.maxThisPick} shots.</span>
            <button
              type="button"
              className="at-budget-notice-btn at-cond"
              onClick={() => {
                setSearch('');
                setSelectedPosition('ALL');
                setOnlyFits(true);
              }}
            >
              Show players that fit
            </button>
          </div>
        )}
      </div>

      <ShotsMeter used={humanShotsUsed} cap={QUICK_CAP_LIMIT} label="Your shots" />

      {/* 2026-09-11, user-reported live: "ważne żebyśmy mogli zobaczyć własny zespoł bo nie wiem
          ile mam zabranych rzutów" — the cap number alone didn't show WHICH players it came from.
          Same Face+ShotChip tile Best Five uses (user's own cross-mode ask), one per starter slot.
          Keyed by STARTER_SLOTS (not draft order, per the follow-up "nie wiem jakie pozycje mam
          obstawione" — draft order never told you WHICH position a pick actually covers) so the
          panel reads as PG/SG/SF/PF/C coverage, matching `humanAssignment`'s own optimal seating —
          a player picked 3rd can still show up under SF here if that's their best slot. Any drafted
          player `bestPrimaryAssignment` couldn't seat (5th man beyond a clean 1-per-slot fit) still
          shows below the grid so a real pick never silently vanishes from view. */}
      <div className="qf-team-panel">
        {STARTER_SLOTS.map((slot) => {
          const p = humanAssignment[slot];
          return p ? (
            <div className="qf-team-card" key={slot}>
              <span className="qf-team-card-slot at-cond">{slot}</span>
              <Face name={p.playerName} />
              <span className="qf-team-card-name">{p.playerName}</span>
              <ShotChip fga={p.fga} cap={QUICK_CAP_LIMIT} />
            </div>
          ) : (
            <div className="qf-team-empty" key={slot}>
              <span className="qf-team-card-slot at-cond">{slot}</span>
              <span aria-hidden>?</span>
            </div>
          );
        })}
      </div>
      {(() => {
        const seatedIds = new Set(Object.values(humanAssignment).filter((p): p is (typeof humanTeam.roster)[number] => Boolean(p)).map((p) => p.id));
        const overflow = humanTeam.roster.filter((p) => !seatedIds.has(p.id));
        return overflow.length > 0 ? (
          <div className="qf-team-panel qf-team-panel--overflow">
            {overflow.map((p) => (
              <div className="qf-team-card" key={p.id}>
                <span className="qf-team-card-slot at-cond">EXTRA</span>
                <Face name={p.playerName} />
                <span className="qf-team-card-name">{p.playerName}</span>
                <ShotChip fga={p.fga} cap={QUICK_CAP_LIMIT} />
              </div>
            ))}
          </div>
        ) : null;
      })()}

      <div className="at-controls-row">
        <input
          className="at-search-input"
          placeholder="Search players…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="secondary-btn" style={{ marginLeft: 'auto' }} disabled={autoFinishing} onClick={onAutoFinish}>
          {autoFinishing ? 'Finishing…' : 'Auto-finish'}
        </button>
      </div>
      <div className="at-controls-row" style={{ marginTop: -4 }}>
        <button className={selectedPosition === 'ALL' ? 'active' : ''} onClick={() => setSelectedPosition('ALL')}>
          ALL
        </button>
        {ALL_POSITIONS.map((pos) => (
          <button key={pos} className={selectedPosition === pos ? 'active' : ''} onClick={() => setSelectedPosition(pos)}>
            {pos}
          </button>
        ))}
        <button className={onlyFits ? 'active' : ''} aria-pressed={onlyFits} onClick={() => setOnlyFits((v) => !v)}>
          Fits my budget
        </button>
      </div>

      {/* 2026-09-11, user-reported live ("widok graczy" screenshot, then "może używajmy podobnych
          kafelków jak w build the best 5? face card + shots i tyle") — replaces the flat
          DraftBoard-style text row this used to be with the same card-grid shape Best Five's own
          `.bf-pool-card` uses: a face, a name, and the shot cost, nothing else. */}
      <div className="qf-pool">
        {filtered.map(({ span }) => {
          const legal = canPick && isQuickPickLegal(state, span.id);
          const position = span.secondaryPositions.length > 0 ? `${span.primaryPosition}/${span.secondaryPositions[0]}` : span.primaryPosition;
          return (
            <button
              key={span.id}
              className="qf-pool-card"
              disabled={!legal}
              title={
                !canPick
                  ? `${teamLabel(currentTeam)} is picking…`
                  : legal
                    ? span.playerName
                    : quickPickBlockReason(state, span.id) === 'reserve'
                      ? `Too expensive right now — you need to keep ${budget.reserved} shots for your other ${budget.slotsLeft - 1} pick${budget.slotsLeft - 1 === 1 ? '' : 's'}. Max for this pick: ${budget.maxThisPick} shots.`
                      : `Over the ${QUICK_CAP_LIMIT}-shot cap — pick a cheaper player.`
              }
              onClick={() => onPick(span.id)}
            >
              <Face name={span.playerName} size="md" />
              <span className="qf-pool-name">{shortenName(span.playerName)}</span>
              <span className="qf-pool-pos">{position}</span>
              <ShotChip fga={span.fga} cap={QUICK_CAP_LIMIT} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Same tier ramp ResultsScreen.tsx's own hero uses for the main draft (module-private there —
 * duplicated here rather than imported, same "small and self-contained, don't pull a large
 * lazy-loaded component's module graph into this lean screen" reasoning `quickDraft.ts` already
 * documents for not reusing `draft.ts` directly). */
function resultTier(rank: number, fieldSize: number): { label: string; tone: 1 | 2 | 3 | 4 | 5 | 6 } {
  const pct = rank / fieldSize;
  if (rank === 1) return { label: 'Dynasty', tone: 6 };
  if (pct <= 0.2) return { label: 'Contender', tone: 5 };
  if (pct <= 0.4) return { label: 'Playoff Lock', tone: 4 };
  if (pct <= 0.6) return { label: 'Play-In Fight', tone: 3 };
  if (pct <= 0.85) return { label: 'Lottery Team', tone: 2 };
  if (rank < fieldSize) return { label: 'Full Rebuild', tone: 1 };
  return { label: 'Wooden Spoon', tone: 1 };
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function QuickResults({
  state,
  teamCodeByTeamId,
  onExit,
  onNewDraft,
  onRematch,
}: {
  state: QuickDraftState;
  teamCodeByTeamId: Map<string, string>;
  onExit: () => void;
  onNewDraft: () => void;
  onRematch: () => void;
}) {
  const ranked = useMemo(() => {
    return state.teams
      .map((team) => {
        const finalized = finalizeQuickRotation(team);
        // Derived from the ALREADY-finalized rotation (not a second, separate
        // `bestPrimaryAssignment` call) — guarantees the score shown here always matches the same
        // 5-man assignment the team's own card displays, gap-filled the same way (see
        // `finalizeQuickRotation`'s own docstring: a drafted 5th player never silently drops out
        // of its team's score just because the optimal search alone couldn't seat him).
        const lineup: Lineup = {};
        for (const [slot, assignments] of Object.entries(finalized.rotation!.slots) as [Position, { playerId: string }[]][]) {
          const playerId = assignments[0]?.playerId;
          if (playerId) lineup[slot] = finalized.roster.find((p) => p.id === playerId);
        }
        const score = scoreLineup(lineup);
        return { team: finalized, score };
      })
      .sort((a, b) => b.score.composite - a.score.composite);
  }, [state.teams]);

  const humanRank = ranked.findIndex((r) => r.team.isHuman) + 1;
  const human = ranked[humanRank - 1];
  const tier = resultTier(humanRank, TEAM_COUNT);
  const barKeys: (keyof LineupScore)[] = ['talent', 'offense', 'defense', 'spacing', 'fit'];

  // 2026-09-11, user-reported live: "brak insightu" — the field/bars alone never explained WHY.
  // Same weakest-axis reasoning Best Five's own result screen uses (`WEAK_AXIS_REASON`, exported
  // from bestFive.ts for exactly this reuse), plus the same fit weak-link/notes `scoreLineup`
  // already computes but nothing here was reading yet.
  const weakest = [...WEIGHTED_AXES].sort((a, b) => human.score[a.key] - human.score[b.key])[0];

  return (
    <div className="at-card bf-result">
      <div className={`qf-hero qf-hero-t${tier.tone}`}>
        <span className="qf-hero-rank">
          {ordinal(humanRank)} of {TEAM_COUNT} — {tier.label}
        </span>
        <span className="qf-hero-team">{teamLabel(human.team)} · {human.score.composite} composite</span>
      </div>

      <div className="bf-bars">
        {barKeys.map((key) => (
          <div key={key} className="bf-bar-row">
            <span className="bf-bar-label at-cond">{key[0].toUpperCase() + key.slice(1)}</span>
            <span className="bf-bar-track">
              <span className="bf-bar-fill" style={{ width: `${Math.max(0, Math.min(100, human.score[key] as number))}%` }} />
            </span>
            <span className="bf-bar-val">{Math.round(human.score[key] as number)}</span>
          </div>
        ))}
      </div>

      <div className="qf-why">
        <p>
          Your weakest axis is <b>{weakest.label} ({Math.round(human.score[weakest.key])})</b>. {WEAK_AXIS_REASON[weakest.key](human.score)}
        </p>
        {human.score.weakLink && (
          <p>
            Defensively, <b>{human.score.weakLink}</b> is the softest spot — an opponent will attack him every possession.
          </p>
        )}
        {human.score.notes[0] && <p>{human.score.notes[0]}</p>}
      </div>

      <div className="at-legend-row" style={{ marginTop: 4 }}>
        <p className="at-caption" style={{ marginTop: 0 }}>
          Field
        </p>
      </div>
      <div className="qf-field">
        {ranked.map((r, i) => (
          <div key={r.team.id} className={`qf-field-card ${r.team.isHuman ? 'qf-field-card--you' : ''}`}>
            <strong>
              {i + 1}. {teamCodeByTeamId.get(r.team.id)} {r.team.isHuman && '(You)'}
            </strong>
            <span>{r.score.composite} composite</span>
          </div>
        ))}
      </div>

      <div className="bf-submit-row bf-result-actions">
        <button className="at-draft-btn bf-submit" onClick={onNewDraft}>
          New draft
        </button>
        <button className="secondary-btn" onClick={onRematch} title="Same 16 teams, same draft order — try a different plan.">
          Rematch this board
        </button>
        <button className="secondary-btn" onClick={onExit}>
          Main menu
        </button>
      </div>
    </div>
  );
}
