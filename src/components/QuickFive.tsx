import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import type { Team } from '../engine/types';
import {
  createQuickDraft,
  currentTeamIndex,
  makeQuickPick,
  resolveQuickAiPickIfNeeded,
  autoFinishQuickDraft,
  quickPickBudget,
  humanOffer,
  quickOfferTier,
  rerollHumanOffer,
  QUICK_OFFER_SIZE,
  QUICK_REROLLS,
  finalizeQuickRotation,
  QUICK_CAP_LIMIT,
  QUICK_ROUNDS,
  type QuickDraftState,
} from '../engine/quickDraft';
import { peakDraftPool } from '../engine/peakDraftPool';
import { totalFga, TEAM_COUNT, STARTER_SLOTS } from '../engine/positions';
import { bestPrimaryAssignment } from '../engine/rotation';
import { scoreLineup, WEIGHTED_AXES, WEAK_AXIS_REASON, type Lineup, type LineupScore } from '../engine/bestFive';
import { tierRank, displayTalentForSpan } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { teamCodes, teamLabel } from '../engine/teamNames';
import { Face, ShotChip, ShotsMeter, shortenName } from './ShotChip';
import { DraftPlayerCard, TIER_FRAME_COLOR } from './DraftPlayerCard';
import { TeamTile } from './TeamBadge';
import { markStepDone } from './pathProgress';
import { rankTeams } from '../engine/scoring';
import { fitScore } from '../engine/fit';
import { bestHistoricalComp, compBadge } from '../engine/historicalComps';
import DraftLottery from './DraftLottery';
import { MetricBar, ScoreChip, qualityColor, scoreBand } from './ResultsScreen';
import './QuickFive.css';
import { AI_SPEED_LABELS, useAiSpeed } from './aiSpeed';
import { AiSpeedControl, BoardToggleButton, DraftTicker, LeaveDraftDialog, RimPressureNote, TurnBudgetText, type TickerPick } from './DraftChrome';

interface Props {
  humanTeamName?: string;
  onExit: () => void;
  /** The next step of the learning path (the All-Time Draft), offered on the result screen. */
  onNextStep?: () => void;
}

type Phase = 'lottery' | 'draft' | 'results';

// 2026-09-17, user's own ask: a real "how to play?" on the lottery screen, same as the full draft
// — but this mode's own rules, not a copy of the 9-round ones (no bench/rotation step, no span
// choice, a different cap/round count).
const QUICK_HOW_TO_PLAY = [
  { title: 'Draft', body: `${TEAM_COUNT} teams take turns, ${QUICK_ROUNDS} rounds — one starter each round, no bench. You control one team; the rest are CPU.` },
  { title: 'The draw', body: `Each turn you're dealt ${QUICK_OFFER_SIZE} players who fit your caps — top tiers are rare cards. Draft one, or redraw once per draft.` },
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
export default function QuickFive({ humanTeamName, onExit, onNextStep }: Props) {
  const [state, setState] = useState<QuickDraftState>(() => createQuickDraft(humanTeamName));
  const [phase, setPhase] = useState<Phase>('lottery');
  // 2026-09-24: same CPU-speed choice as the All-Time Draft (aiSpeed.ts), a "← Menu" with a
  // confirm instead of a bare Exit at the very bottom, and every phase opening at the top.
  const aiSpeed = useAiSpeed();
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
    setPhase('lottery');
  }
  const [autoFinishing, setAutoFinishing] = useState(false);

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
          <BoardToggleButton open={boardOpen} onToggle={() => setBoardOpen((o) => !o)} />
        </div>
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
          onPick={handlePick}
          onReroll={() => setState((s) => rerollHumanOffer(s))}
          onAutoFinish={handleAutoFinish}
          autoFinishing={autoFinishing}
          teamIdx={teamIdx}
          boardOpen={boardOpen}
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
        />
      )}
    </div>
  );
}

function QuickDraftBoard({
  state,
  canPick,
  currentTeam,
  humanTeam,
  teamCodeByTeamId,
  onPick,
  onReroll,
  onAutoFinish,
  autoFinishing,
  teamIdx,
  boardOpen,
}: {
  state: QuickDraftState;
  canPick: boolean;
  currentTeam: Team;
  humanTeam: Team;
  teamCodeByTeamId: Map<string, string>;
  onPick: (id: string) => void;
  onReroll: () => void;
  onAutoFinish: () => void;
  autoFinishing: boolean;
  teamIdx: number;
  boardOpen: boolean;
}) {
  // 2026-09-24: this pick's shot budget (the same "can you still fill the five?" rule every team
  // now plays under) and an "only players that fit" filter the stuck-board notice can switch on.
  const budget = useMemo(() => quickPickBudget(state), [state]);
  const priciestAvailable = useMemo(
    () => peakDraftPool.reduce((max, p) => (!state.draftedIds.has(p.id) && p.fga > max ? p.fga : max), 0),
    [state.draftedIds],
  );
  const offer = useMemo(() => (canPick ? humanOffer(state) : []), [state, canPick]);
  const drawKey = `${state.history.length}-${state.rerollsUsed}`;
  const drawHeat = useMemo(() => {
    const best = Math.max(-1, ...offer.map((p) => {
      const t = quickOfferTier(p);
      return t === 'Salary Glue' ? -1 : tierRank(t);
    }));
    if (best >= tierRank('Greatest peak')) return { level: 'jackpot', label: 'Jackpot!' };
    if (best >= tierRank('MVP')) return { level: 'hot', label: 'MVP pull' };
    return null;
  }, [offer]);
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
    <div className="at-card">
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
        <DraftTicker
          youOnClock={canPick}
          complete={state.complete}
          onClockLabel={teamLabel(currentTeam)}
          picksAway={picksAway}
          recentPicks={recentPicks}
          progress={{ picksMade: state.history.length, totalPicks: TEAM_COUNT * QUICK_ROUNDS, round: Math.min(state.round + 1, QUICK_ROUNDS), rounds: QUICK_ROUNDS }}
        />
        {!canPick ? (
          <div className="at-cpu-turn-banner">{teamLabel(currentTeam)} is picking…</div>
        ) : (
          <div className="at-your-turn-banner" role="status">
            <span className="at-your-turn-title at-cond">Your pick</span>
            <TurnBudgetText
              round={state.round + 1}
              rounds={QUICK_ROUNDS}
              capLeft={budget.capLeft}
              slotsLeft={budget.slotsLeft}
              maxThisPick={budget.maxThisPick}
              priciestAvailable={priciestAvailable}
              capTotal={QUICK_CAP_LIMIT}
            />
            <RimPressureNote starters={humanStarters} />
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
              <span className="qf-team-card-name">{p.playerName}</span>
              <span className="qf-team-card-tal">
                <span>TAL <b>{displayTalentForSpan(tierContextFor(p))}</b></span>
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
                <span className="qf-team-card-name">{p.playerName}</span>
                <ShotChip fga={p.fga} cap={QUICK_CAP_LIMIT} />
              </div>
            ))}
          </div>
        ) : null;
      })()}

      {/* 2026-09-26, the user: "brakuje tego dopaminowego hitu niczym z kasyna. Ograniczmy wybór
          do 5 graczy. Niech po każdym wyborze gracz widzi jacy gracze się losują." No browsing the
          pool: each turn deals five legal players (`humanOffer`), turned over one by one, the rare
          tiers lit up. Between turns the five cards wait face down. */}
      <section className={`qf-draw${canPick ? ' is-live' : ''}`} aria-live="polite">
        <div className="qf-draw-head">
          <span className="qf-draw-title at-cond">{canPick ? 'Your draw' : 'Next draw'}</span>
          <span className="qf-draw-sub">
            {canPick
              ? 'Five players dealt from the pool — the higher the tier, the rarer the card. Draft one.'
              : picksAway
                ? `Your cards turn over in ${picksAway} pick${picksAway === 1 ? '' : 's'}.`
                : 'Waiting for the board…'}
          </span>
          {canPick && drawHeat && (
            <span key={drawKey} className={`qf-draw-flash is-${drawHeat.level}`} style={{ '--reveal-delay': `${QUICK_OFFER_SIZE * 160 + 350}ms` } as CSSProperties}>
              {drawHeat.label}
            </span>
          )}
        </div>
        <div className="qf-draw-cards" key={canPick ? drawKey : 'waiting'}>
          {canPick
            ? offer.map((span, i) => {
                const tier = quickOfferTier(span);
                const rank = tier === 'Salary Glue' ? -1 : tierRank(tier);
                const heat = rank >= tierRank('Greatest peak') ? ' is-jackpot' : rank >= tierRank('All-NBA') ? ' is-hot' : '';
                return (
                  <div
                    key={span.id}
                    className={`qf-draw-slot${heat}`}
                    style={{ '--i': i, '--tier-frame': TIER_FRAME_COLOR[tier] } as CSSProperties}
                  >
                    <div className="qf-draw-flip">
                      <DraftPlayerCard
                        span={span}
                        cap={QUICK_CAP_LIMIT}
                        tier={tier}
                        legal
                        draftTitle={`Draft ${span.playerName}`}
                        onDraft={() => onPick(span.id)}
                      />
                      <span className="qf-draw-back" aria-hidden />
                    </div>
                  </div>
                );
              })
            : Array.from({ length: QUICK_OFFER_SIZE }, (_, i) => (
                <div key={i} className="qf-draw-slot is-waiting" aria-hidden>
                  <span className="qf-draw-back is-static" />
                </div>
              ))}
        </div>
        <div className="qf-draw-actions">
          {canPick && (
            <button
              type="button"
              className="secondary-btn"
              disabled={state.rerollsUsed >= QUICK_REROLLS}
              title="Deal five new cards for this pick — once per draft."
              onClick={onReroll}
            >
              Redraw ({QUICK_REROLLS - state.rerollsUsed} left)
            </button>
          )}
          <button className="secondary-btn" disabled={autoFinishing} onClick={onAutoFinish}>
            {autoFinishing ? 'Finishing…' : 'Auto-finish'}
          </button>
        </div>
      </section>
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
}: {
  state: QuickDraftState;
  teamCodeByTeamId: Map<string, string>;
  onExit: () => void;
  onNewDraft: () => void;
  onRematch: () => void;
  onNextStep?: () => void;
}) {
  useEffect(() => markStepDone('quickfive'), []);
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
  const weakest = [...WEIGHTED_AXES].sort((a, b) => human.score[a.key] - human.score[b.key])[0];

  const fit = useMemo(() => fitScore(human.team), [human]);
  const starters = STARTER_SLOTS.map((slot) => {
    const id = human.team.rotation?.slots[slot]?.[0]?.playerId;
    return { slot, player: id ? human.team.roster.find((p) => p.id === id) : undefined };
  });
  const top = ranked[0].score.composite;

  // 2026-09-26, the user: "ekran końcowy może być tak samo zaprojektowany jak ten w all-time
  // drafcie, po prostu mniej szczegółowy". The All-Time Draft's results hero (finish, rating,
  // style, team profile chips, a few bars, the lineup by position), cut down to a five.
  return (
    <div className="at-card bf-result qf-result">
      <header className="results-hero">
        <div className="results-hero-finish">
          <span className="results-hero-eyebrow">You finished</span>
          <span className="results-hero-rank">
            <b>{ordinal(humanRank)}</b>
            <i>/ {TEAM_COUNT}</i>
          </span>
          <span className={`results-hero-tier results-hero-tier-t${tier.tone}`}>{tier.label}</span>
          <span className="results-hero-team">{teamLabel(human.team)}</span>
        </div>
        <div className="results-hero-stats">
          <div className={`results-hero-stat results-hero-overall score-t${scoreBand(human.score.composite)}`}>
            <span className="results-hero-stat-label">Team rating</span>
            <span className="results-hero-stat-value">
              {human.score.composite}
              <small className="results-hero-stat-of">/100</small>
            </span>
          </div>
        </div>
        <p className="results-hero-gap">
          {top > human.score.composite
            ? <>Best team rating in the field: <b>{top}</b> — you're <b>{top - human.score.composite}</b> behind.</>
            : <>You have the best team rating in the field.</>}
        </p>
        {comp && (
          <p className="results-hero-identity">
            <span className="results-hero-comp">
              {compBadge(comp.comp) && <TeamTile {...compBadge(comp.comp)!} label={comp.comp.team} />}
              <span>Plays like the <b>{comp.comp.team}</b> <small>{comp.match}% match</small></span>
            </span>
          </p>
        )}
        <div className="results-hero-dashboard">
          <div className="results-hero-scores">
            <span className="share-modal-face-group-label">Team profile</span>
            <div className="results-hero-scores-row">
              {barKeys.map((key) => (
                <ScoreChip key={key} label={key[0].toUpperCase() + key.slice(1)} value={Math.round(human.score[key] as number)} />
              ))}
            </div>
            <div className="analysis-bars-split results-hero-bars">
              <div className="analysis-bars-col analysis-bars-col--offense">
                <span className="analysis-bars-col-label">Offense</span>
                <MetricBar label="Creation" value={fit.components.creationStructure} hint="Half-court shot creation the five can generate on its own." />
                <MetricBar label="Rim pressure" value={fit.components.rimPressureTeam} hint="How much the five collectively bends a defense at the rim." />
              </div>
              <div className="analysis-bars-col analysis-bars-col--defense">
                <span className="analysis-bars-col-label">Defense</span>
                <MetricBar label="Role coverage" value={fit.components.defensiveRoleCoverage} hint="Whether someone covers each defensive job — point of attack, wing, rim." />
                <MetricBar label="Hunt resistance" value={fit.components.huntResistance} hint="How well the five hides its weakest defender in a playoff series." />
              </div>
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
            </div>
          </div>
          <div className="results-hero-rotation">
            <span className="share-modal-face-group-label">Starting five</span>
            <div className="results-hero-rotation-columns">
              {starters.map(({ slot, player }) => {
                const tal = player ? displayTalentForSpan(tierContextFor(player)) : 0;
                return (
                  <div className="results-hero-rotation-col" key={slot}>
                    <span className="results-hero-rotation-col-label">{slot}</span>
                    {player && (
                      <div className="results-hero-rotation-entry" title={`${player.playerName} (${player.spanLabel})`}>
                        <Face name={player.playerName} size="sm" />
                        <span className="results-hero-rotation-entry-info">
                          <span className="results-hero-rotation-entry-name">{shortenName(player.playerName, 12)}</span>
                          <span className="results-hero-rotation-entry-min">{player.spanLabel}</span>
                        </span>
                        <span className="rotation-entry-tal" style={{ background: qualityColor(tal) }}>{tal}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <h2 className="results-section-title">Final team ranking</h2>
      <div className="qf-field">
        {ranked.map((r, i) => (
          <div key={r.team.id} className={`qf-field-card ${r.team.isHuman ? 'qf-field-card--you' : ''}`} title={teamCodeByTeamId.get(r.team.id)}>
            <strong>
              {i + 1}. {teamLabel(r.team)} {r.team.isHuman && '(You)'}
            </strong>
            <span className="qf-field-score" style={{ background: qualityColor(r.score.composite) }}>{r.score.composite}</span>
          </div>
        ))}
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
