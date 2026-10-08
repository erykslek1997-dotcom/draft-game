import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
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
import { overallTierForSpan, displayTalentForSpan, formatTal } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { teamCodes, teamLabel } from '../engine/teamNames';
import { CapIcon, Face, ShotChip, ShotsMeter } from './ShotChip';
import { DraftPlayerCard } from './DraftPlayerCard';
import { markStepDone } from './pathProgress';
import { rankTeams } from '../engine/scoring';
import { fitScore } from '../engine/fit';
import { bestHistoricalComp } from '../engine/historicalComps';
import DraftLottery from './DraftLottery';
import { nextDraftTip } from './ResultsScreen';
import { RosterGrid, TeamMark, TeamReport, fieldGrade, teamHue, type DeskVoice, type ProfileRow } from './ResultsReport';
import { ALL_POSITIONS } from './DraftBoard';
import './QuickFive.css';
import { ChallengeNote } from './ScoreBoard';
import ShareResultModal from './ShareResultModal';
import { copyLink } from './shareSave';
import { modeChallengeLink, type ModeChallenge } from '../modeChallenge';
import { cpuPickDelay } from './aiSpeed';
import { AUTO_FINISH_FOR_TESTING } from './testingFlags';
import { BoardToggleButton, DraftStrip, LeaveDraftDialog, RimPressureNote, type TickerPick } from './DraftChrome';
import { FitName, FitTeam } from './FitName';

interface Props {
  humanTeamName?: string;
  onExit: () => void;
  /** The next step of the learning path (the All-Time Draft), offered on the result screen. */
  onNextStep?: () => void;
  /** A friend's "Challenge a friend" link: their board and their score. */
  challenge?: ModeChallenge;
}

type Phase = 'lottery' | 'draft' | 'results';

// 2026-09-17, user's own ask: a real "how to play?" on the lottery screen, same as the full draft
// — but this mode's own rules, not a copy of the 9-round ones (no bench/rotation step, no span
// choice, a different cap/round count).
const QUICK_HOW_TO_PLAY = [
  { title: 'Draft', body: `${TEAM_COUNT} teams take turns, ${QUICK_ROUNDS} rounds — one starter each round, no bench. You control one team; the rest are CPU.` },
  { title: 'Caps', body: `Every pick costs caps — his shots per game in those years. Your five starters have to fit under ${QUICK_CAP_LIMIT} caps.` },
  { title: 'Peak only', body: "No choosing years — every player is shown at his single best season, so each pick is quick." },
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
/** CPU pick delay while "Skip to my pick" runs, ms. */
const RUSH_PICK_MS = 90;

export default function QuickFive({ humanTeamName, onExit, onNextStep, challenge }: Props) {
  const [state, setState] = useState<QuickDraftState>(() => createQuickDraft(humanTeamName, challenge ? Number(challenge.seed) : undefined));
  const [phase, setPhase] = useState<Phase>('lottery');
  // 2026-09-24: a "← Menu" with a confirm instead of a bare Exit at the very bottom, and every
  // phase opening at the top.
  const [boardOpen, setBoardOpen] = useState(false);
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

  // 2026-09-28 playtest: with a late slot the player sat through nine calm first-round CPU picks
  // before touching anything. "Skip to my pick" runs the CPU picks quickly up to the player's next
  // turn, then the chosen pace is back.
  const [rushToMe, setRushToMe] = useState(false);
  useEffect(() => {
    if (canPick) setRushToMe(false);
  }, [canPick]);

  // Auto-resolve CPU turns, same pacing the main draft's default 'Normal' speed uses.
  useEffect(() => {
    if (phase !== 'draft' || state.complete || autoFinishing) return;
    if (state.teams[currentTeamIndex(state)].isHuman) return;
    const timer = setTimeout(() => {
      const next = resolveQuickAiPickIfNeeded(state);
      if (next) setState(next);
    }, rushToMe ? RUSH_PICK_MS : cpuPickDelay(state.history.length, TEAM_COUNT));
    return () => clearTimeout(timer);
  }, [state, phase, autoFinishing, rushToMe]);

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
    <div className="at-shell at-calm">
      {/* 2026-10-07, the UI simplification: the All-Time Draft's one-row header. */}
      {phase !== 'lottery' && (
        <div className="at-calm-header">
          <button
            type="button"
            className="at-calm-btn at-calm-btn--ghost"
            onClick={() => (phase === 'results' ? onExit() : setConfirmExit(true))}
          >
            ← Menu
          </button>
          <h1 className="at-calm-title">Mini Draft</h1>
          {phase === 'draft' && !state.complete ? (
            <BoardToggleButton open={boardOpen} onToggle={() => setBoardOpen((o) => !o)} />
          ) : (
            <span className="rs-header-spacer" aria-hidden />
          )}
        </div>
      )}
      {confirmExit && (
        <LeaveDraftDialog text="Mini Drafts aren't saved — leaving ends this one." onStay={closeExitDialog} onLeave={onExit} />
      )}
      {phase === 'lottery' && (
        <DraftLottery teams={state.teams} rounds={QUICK_ROUNDS} onDone={() => setPhase('draft')} howToPlay={QUICK_HOW_TO_PLAY} onExit={onExit} />
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
          boardOpen={boardOpen}
          rushToMe={rushToMe}
          onRushToMe={() => setRushToMe(true)}
        />
      )}
      {phase === 'results' && (
        <QuickResults
          state={state}
          teamCodeByTeamId={teamCodeByTeamId}
          onExit={onExit}
          onNewDraft={() => restart()}
          onRematch={() => restart(state.seed)}
          onNextStep={onNextStep}
          challenge={challenge && Number(challenge.seed) === state.seed ? challenge : undefined}
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
/** Cards shown at first and per "See more" — same paging as the All-Time Draft grid. */
const QUICK_VISIBLE_STEP = 30;

const allEnrichedOnce = peakDraftPool.map((span) => ({
  span,
  tier: overallTierForSpan(tierContextFor(span)),
  // 2026-09-26, the user: "segregowanie według TAL" — the grid is sorted by the TAL on the card.
  tal: displayTalentForSpan(tierContextFor(span)),
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
  boardOpen,
  rushToMe,
  onRushToMe,
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
  rushToMe: boolean;
  onRushToMe: () => void;
  teamIdx: number;
  boardOpen: boolean;
}) {
  // Cheap pass only: drop drafted players, position filter, search box, tier sort — no per-player
  // tier-lookup call here, that's all already done once in `allEnrichedOnce` above. Re-runs on
  // every pick AND every keystroke, same as DraftBoard.tsx's own `groups` memo.
  // 2026-09-24: this pick's shot budget (the same "can you still fill the five?" rule every team
  // now plays under) and an "only players that fit" filter the stuck-board notice can switch on.
  const budget = useMemo(() => quickPickBudget(state), [state]);
  const [onlyFits, setOnlyFits] = useState(false);
  const priciestAvailable = useMemo(
    () => allEnrichedOnce.reduce((max, e) => (!state.draftedIds.has(e.span.id) && e.span.fga > max ? e.span.fga : max), 0),
    [state.draftedIds],
  );
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allEnrichedOnce
      .filter((e) => !state.draftedIds.has(e.span.id))
      .filter((e) => (onlyFits && canPick ? isQuickPickLegal(state, e.span.id) : true))
      .filter((e) => (selectedPosition !== 'ALL' ? e.span.primaryPosition === selectedPosition : true))
      .filter((e) => e.span.playerName.toLowerCase().includes(q))
      .sort((a, b) => b.tal - a.tal || allStarCount(b.span.playerName) - allStarCount(a.span.playerName))
      .slice(0, 80);
  }, [state, search, selectedPosition, onlyFits, canPick]);
  const [visibleCount, setVisibleCount] = useState(QUICK_VISIBLE_STEP);
  const anyLegal = !canPick || filtered.slice(0, visibleCount).some((e) => isQuickPickLegal(state, e.span.id));
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
  const humanStarters = useMemo(
    () => Object.values(humanAssignment).filter((p): p is PlayerSpan => Boolean(p)),
    [humanAssignment],
  );

  return (
    <div className="at-card at-stage-in">
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

      <div className="at-turn-sticky">
        <DraftStrip
          youOnClock={canPick}
          complete={state.complete}
          onClockLabel={teamLabel(currentTeam)}
          picksAway={picksAway}
          recentPicks={recentPicks.slice(0, 2)}
          round={Math.min(state.round + 1, QUICK_ROUNDS)}
          rounds={QUICK_ROUNDS}
          progress={state.history.length / (TEAM_COUNT * QUICK_ROUNDS)}
          capLeft={QUICK_CAP_LIMIT - humanShotsUsed}
          slotsLeft={QUICK_ROUNDS - humanTeam.roster.length}
          maxThisPick={canPick && budget.maxThisPick < priciestAvailable ? budget.maxThisPick : null}
        />
        {!canPick && picksAway != null && picksAway > 1 && !rushToMe && (
          <button type="button" className="at-calm-btn qf-skip" onClick={onRushToMe}>
            Skip to my pick →
          </button>
        )}
        {canPick && <RimPressureNote starters={humanStarters} />}
        {canPick && !anyLegal && (
          <div className="at-budget-notice">
            <span>None of the players shown fit this pick — it can cost up to <CapIcon /> {budget.maxThisPick} caps.</span>
            <button
              type="button"
              className="at-calm-btn"
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

      <ShotsMeter used={humanShotsUsed} cap={QUICK_CAP_LIMIT} label="Your caps" />

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
              <FitName className="qf-team-card-name" name={p.playerName} faceNextToIt />
              <span className="qf-team-card-tal">
                <span>TAL <b>{formatTal(displayTalentForSpan(tierContextFor(p)))}</b></span>
                <ShotChip fga={p.fga} cap={QUICK_CAP_LIMIT} />
              </span>
            </div>
          ) : (
            <div className="qf-team-empty" key={slot}>
              <span className="qf-team-card-slot at-cond">{slot}</span>
              <span className="bf-face bf-face--sm bf-face--empty" aria-hidden />
              <span className="qf-team-empty-text">Open</span>
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
                <FitName className="qf-team-card-name" name={p.playerName} faceNextToIt />
                <ShotChip fga={p.fga} cap={QUICK_CAP_LIMIT} />
              </div>
            ))}
          </div>
        ) : null;
      })()}

      {/* 2026-09-26, the user: "fits my budget wygląda dziwnie" — it sat among the round position
          pills and wrapped into a three-line blob on phones. Now a switch next to the search box. */}
      <div className="at-calm-filters">
        <input
          className="at-calm-search"
          placeholder="Search players…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="at-calm-seg" role="group" aria-label="Position">
          {(['ALL', ...ALL_POSITIONS] as const).map((pos) => (
            <button
              key={pos}
              type="button"
              aria-pressed={selectedPosition === pos}
              className={selectedPosition === pos ? 'is-on' : ''}
              onClick={() => setSelectedPosition(pos)}
            >
              {pos === 'ALL' ? 'All' : pos}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`at-calm-chip${onlyFits ? ' is-on' : ''}`}
          aria-pressed={onlyFits}
          title="Only players whose cost fits your next pick"
          onClick={() => setOnlyFits((on) => !on)}
        >
          <CapIcon size={12} /> Affordable
        </button>
        {AUTO_FINISH_FOR_TESTING && (
          <button type="button" className="at-calm-btn qf-autofinish" disabled={autoFinishing} onClick={onAutoFinish}>
            {autoFinishing ? 'Finishing…' : 'Auto-finish'}
          </button>
        )}
      </div>

      {/* 2026-09-26 (the user: "quick 5 może bardziej przypominać normalny draft"): the same
          player cards as the All-Time Draft — tier frame, TAL, team chips, the season's box line —
          without the Scouting button, since every player comes at his single best season here. */}
      <div className="at-player-cards">
        {filtered.slice(0, visibleCount).map(({ span, tier }) => {
          const legal = canPick && isQuickPickLegal(state, span.id);
          return (
            <DraftPlayerCard
              key={span.id}
              span={span}
              cap={QUICK_CAP_LIMIT}
              tier={span.fga < 2 ? 'Salary Glue' : tier}
              legal={legal}
              draftTitle={
                !canPick
                  ? `${teamLabel(currentTeam)} is picking…`
                  : legal
                    ? `Draft ${span.playerName}`
                    : quickPickBlockReason(state, span.id) === 'reserve'
                      ? `Too expensive right now — you need to keep ${budget.reserved} caps for your other ${budget.slotsLeft - 1} pick${budget.slotsLeft - 1 === 1 ? '' : 's'}. This pick can cost up to ${budget.maxThisPick} caps.`
                      : `Over the ${QUICK_CAP_LIMIT}-cap limit — pick a cheaper player.`
              }
              onDraft={() => onPick(span.id)}
            />
          );
        })}
      </div>
      {visibleCount < filtered.length && (
        <button
          type="button"
          className="at-legend-toggle"
          style={{ marginTop: 10 }}
          onClick={() => setVisibleCount((c) => Math.min(filtered.length, c + QUICK_VISIBLE_STEP))}
        >
          See {Math.min(QUICK_VISIBLE_STEP, filtered.length - visibleCount)} more ({filtered.length - visibleCount} left)
        </button>
      )}
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
  onNextStep,
  challenge,
}: {
  state: QuickDraftState;
  teamCodeByTeamId: Map<string, string>;
  onExit: () => void;
  onNewDraft: () => void;
  onRematch: () => void;
  onNextStep?: () => void;
  challenge?: ModeChallenge;
}) {
  useEffect(() => markStepDone('quickfive'), []);
  const [shareOpen, setShareOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
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
  // "Plays like" from the same comp engine as the All-Time Draft's results, read on the finalized
  // fives (starters only, 48 minutes each).
  const comp = useMemo(() => {
    const breakdown = rankTeams(ranked.map((r) => r.team)).find((r) => r.team.id === human.team.id)?.breakdown;
    return breakdown ? bestHistoricalComp(human.team, breakdown, fitScore(human.team)) : null;
  }, [ranked, human]);
  const tier = resultTier(humanRank, TEAM_COUNT);
  const barKeys: (keyof LineupScore)[] = ['talent', 'offense', 'defense', 'spacing', 'fit'];

  // 2026-09-11, user-reported live: "brak insightu" — the field/bars alone never explained WHY.
  // Same weakest-axis reasoning Best Five's own result screen uses (`WEAK_AXIS_REASON`, exported
  // from bestFive.ts for exactly this reuse), plus the same fit weak-link/notes `scoreLineup`
  // already computes but nothing here was reading yet.
  // 2026-09-28 playtest: the weakest axis is the one furthest below the field median, not the
  // lowest raw number (the scales differ) — the same reading the All-Time "Next draft:" tip uses,
  // and the tip added here names the same axis the sentence above it does. No tip for the winner.
  const weakest = useMemo(() => {
    const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0;
    return [...WEIGHTED_AXES].sort(
      (a, b) => human.score[a.key] - median(ranked.map((r) => r.score[a.key])) - (human.score[b.key] - median(ranked.map((r) => r.score[b.key]))),
    )[0];
  }, [ranked, human]);
  const nextTip = useMemo(
    () => (humanRank === 1 ? undefined : nextDraftTip(weakest.label, human.team)),
    [weakest, human, humanRank],
  );

  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const breakdowns = useMemo(() => new Map(rankTeams(ranked.map((r) => r.team)).map((r) => [r.team.id, r.breakdown])), [ranked]);
  const compFor = (team: Team) => {
    const breakdown = breakdowns.get(team.id);
    return breakdown ? bestHistoricalComp(team, breakdown, fitScore(team)) : null;
  };
  const profileRows = (score: LineupScore): ProfileRow[] =>
    barKeys.map((key) => {
      const value = Math.round(score[key] as number);
      return { label: key[0].toUpperCase() + key.slice(1), value, grade: fieldGrade(value, ranked.map((r) => Math.round(r.score[key] as number))) };
    });
  // The same Draft Desk voices as the All-Time results: the weakest axis (the podium hears it only
  // as what a rival could attack), the softest defender, and one thing to try next draft.
  const voices: DeskVoice[] = [
    {
      who: 'The Coach',
      what: humanRank <= 3 ? 'where a rival could still hurt you' : 'what held you back',
      text: `${humanRank <= 3 ? 'The one thing a rival could attack' : 'Your weakest area'} is ${weakest.label} (${Math.round(human.score[weakest.key])}). ${WEAK_AXIS_REASON[weakest.key](human.score)}`,
      tone: 'warn' as const,
    },
    ...(human.score.weakLink
      ? [{ who: 'The Analyst' as const, what: 'on defense', text: `${human.score.weakLink} is the softest spot — an opponent will attack him every possession.`, tone: 'warn' as const }]
      : []),
    ...(nextTip && humanRank > 3 ? [{ who: 'The Scout' as const, what: humanRank === 4 ? 'to get over the top' : 'next draft', text: nextTip, tone: 'warn' as const }] : []),
  ];
  const starters = STARTER_SLOTS.map((slot) => {
    const id = human.team.rotation?.slots[slot]?.[0]?.playerId;
    return { slot, player: id ? human.team.roster.find((p) => p.id === id) : undefined };
  });
  const top = ranked[0].score.composite;
  const boardCells = [
    { label: 'Your team', value: human.score.composite, you: human.score.composite },
    { label: 'Best in field', value: top },
    { label: 'Behind the best', value: top > human.score.composite ? top - human.score.composite : '—' },
  ];
  async function challengeFriend() {
    if (await copyLink(modeChallengeLink('mini', state.seed, human.score.composite, teamLabel(human.team)))) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }

  // 2026-09-26, the user: "ekran końcowy może być tak samo zaprojektowany jak ten w all-time
  // drafcie, po prostu mniej szczegółowy". The All-Time Draft's results hero (finish, rating,
  // style, team profile chips, a few bars, the lineup by position), cut down to a five.
  return (
    <div className="bf-result qf-result" style={{ ['--team-hue' as string]: teamHue(human.team.name) }}>
      {/* 2026-10-08, results look C: the All-Time Draft's results, cut down to a five. */}
      <header className={`rs-hero rr-hero${humanRank === 1 ? ' is-champ' : ''}`}>
        <div className="rr-hero-grid">
          <div className="rr-hero-main">
            <span className="rr-label">Final standings</span>
            <span className="rr-place">
              <b>
                {humanRank}
                <sup>{ordinal(humanRank).slice(String(humanRank).length)}</sup>
              </b>
              <span>of {TEAM_COUNT}</span>
            </span>
            <span className="rr-team">
              <TeamMark code={teamCodeByTeamId.get(human.team.id) ?? ''} name={human.team.name} size="md" />
              <h2>{teamLabel(human.team)}</h2>
              <span className={`rr-tag rr-tag--t${tier.tone}`}>{tier.label}</span>
            </span>
            {challenge?.vs != null && (
              <p className="rr-risk">
                <ChallengeNote yours={human.score.composite} theirs={challenge.vs} who={challenge.vsName} />
              </p>
            )}
          </div>
          <div className="rs-kpis">
            <div className="rs-kpi rs-kpi--you">
              <b>{human.score.composite}</b>
              <span>Your team</span>
            </div>
            <div className="rs-kpi">
              <b>{top}</b>
              <span>Best</span>
            </div>
            <div className="rs-kpi">
              <b>{top > human.score.composite ? top - human.score.composite : '—'}</b>
              <span>Behind the best</span>
            </div>
          </div>
        </div>
      </header>
      <div className="rs-actions rr-actions">
        <button type="button" className="rs-primary" onClick={onNewDraft}>
          New draft
        </button>
        <button type="button" className="at-calm-btn" onClick={() => setShareOpen(true)}>
          Share
        </button>
        <button
          type="button"
          className="at-calm-btn"
          onClick={challengeFriend}
          title="Copies a link that gives a friend the exact same 16-team board, with your score to beat."
        >
          {linkCopied ? '✓ Link copied' : 'Challenge a friend'}
        </button>
        <button type="button" className="at-calm-btn at-calm-btn--ghost" onClick={onRematch} title="Same 16 teams, same draft order — try a different plan.">
          Rematch this board
        </button>
      </div>
      <h3 className="rr-section">Your five</h3>
      <RosterGrid team={human.team} />
      <h3 className="rr-section">{humanRank === 1 ? 'Why you won' : 'Why you finished here'}</h3>
      <TeamReport profile={profileRows(human.score)} comp={comp} voices={voices} extras={[]} />
        {shareOpen && (
          <ShareResultModal
            onClose={() => setShareOpen(false)}
            mode="Mini Draft"
            title={teamLabel(human.team)}
            headline={
              <>
                <b>{ordinal(humanRank)}</b>
                <i>/ {TEAM_COUNT}</i>
              </>
            }
            tier={tier}
            cells={boardCells}
            chips={barKeys.map((k) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), value: Math.round(human.score[k] as number) }))}
            five={starters.flatMap(({ slot, player }) => (player ? [{ slot, name: player.playerName, years: player.spanLabel }] : []))}
          />
        )}

      <h3 className="rr-section">Final standings</h3>
      <div className="rr-standings">
        {ranked.map((r, i) => {
          const isOpen = !r.team.isHuman && openTeamId === r.team.id;
          const row = (
            <>
              <span className="rr-rk">{i + 1}</span>
              <TeamMark code={teamCodeByTeamId.get(r.team.id) ?? ''} name={r.team.name} />
              <FitTeam className="rr-nm" name={teamLabel(r.team)} code={teamCodeByTeamId.get(r.team.id)} after={r.team.isHuman && <em> · you</em>} />
              <span className="rr-od" />
              <span className="rr-ser" />
              <span className="rr-sc">{r.score.composite}</span>
              <span className="rr-car" aria-hidden>{r.team.isHuman ? '' : isOpen ? '▾' : '▸'}</span>
            </>
          );
          return (
            <div key={r.team.id} className={`rr-rung-wrap${r.team.isHuman ? ' is-you' : ''}${isOpen ? ' is-open' : ''}`}>
              {r.team.isHuman ? (
                <div className="rr-rung">{row}</div>
              ) : (
                <button type="button" className="rr-rung" aria-expanded={isOpen} onClick={() => setOpenTeamId((cur) => (cur === r.team.id ? null : r.team.id))}>
                  {row}
                </button>
              )}
              {isOpen && (
                <div className="rr-open" style={{ ['--team-hue' as string]: teamHue(r.team.name) }}>
                  <RosterGrid team={r.team} />
                  <TeamReport profile={profileRows(r.score)} comp={compFor(r.team)} voices={[]} extras={[]} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {onNextStep && (
        <div className="path-next">
          <span>
            <b>Next step: the All-Time Draft.</b> Sixteen teams, nine rounds, a bench and a rotation to set — the same
            judge, a whole roster.
          </span>
          <button className="at-draft-btn" onClick={onNextStep}>
            Start the All-Time Draft
          </button>
        </div>
      )}
      <div className="bf-submit-row bf-result-actions end-actions">
        <button type="button" className="at-calm-btn at-calm-btn--ghost" onClick={onExit}>
          Main menu
        </button>
      </div>
    </div>
  );
}
