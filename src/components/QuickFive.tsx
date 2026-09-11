import { useEffect, useMemo, useState } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import type { Team } from '../engine/types';
import {
  createQuickDraft,
  currentTeamIndex,
  makeQuickPick,
  resolveQuickAiPickIfNeeded,
  autoFinishQuickDraft,
  isQuickPickLegal,
  finalizeQuickRotation,
  QUICK_CAP_LIMIT,
  QUICK_ROUNDS,
  type QuickDraftState,
} from '../engine/quickDraft';
import { activeDraftPool } from '../engine/draft';
import { totalFga, TEAM_COUNT } from '../engine/positions';
import { bestPrimaryAssignment } from '../engine/rotation';
import { scoreLineup, type Lineup, type LineupScore } from '../engine/bestFive';
import { allStarCount } from '../engine/allStarLookup';
import { tierRank, overallTierForSpan, displayTalentForSpan } from '../engine/grades';
import { teamCodes, teamLabel } from '../engine/teamNames';
import DraftLottery from './DraftLottery';
import {
  ALL_POSITIONS,
  groupByPlayer,
  OverallTierBadge,
  tierContextFor,
  naturalPosition,
  type PlayerGroup,
} from './DraftBoard';

interface Props {
  humanTeamName?: string;
  onExit: () => void;
}

type Phase = 'lottery' | 'draft' | 'results';

/**
 * "Szybka 5" — a real 16-team, pick-by-pick draft (same AI reacting live as the full 9-round
 * draft), just 5 rounds/starters-only and a 70-shot cap instead of 100.9. See `quickDraft.ts` for
 * the engine side and why this is a separate module rather than a parameterized `draft.ts`.
 *
 * Deliberately its own lean UI too — `DraftBoard.tsx`/`ResultsScreen.tsx` are both deeply
 * 9-man/100.9-cap shaped (judge-metric columns sized for 9 rounds, championship/matchup features
 * that don't translate to a bare five under a different cap) — reusing them directly would mean
 * either forking huge swaths of them or leaving dead 9-man UI chrome half-visible. This screen
 * reuses the small, genuinely generic pieces instead (`DraftLottery`, `groupByPlayer`/
 * `OverallTierBadge` from DraftBoard.tsx, `scoreLineup`/`bestPrimaryAssignment` from the bare-five
 * scoring path Best Five already validated) and builds its own compact Draft/Results.
 */
export default function QuickFive({ humanTeamName, onExit }: Props) {
  const [state, setState] = useState<QuickDraftState>(() => createQuickDraft(humanTeamName));
  const [phase, setPhase] = useState<Phase>('lottery');
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
    }, 450);
    return () => clearTimeout(timer);
  }, [state, phase, autoFinishing]);

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
      <div className="at-board-brand at-cond">Szybka 5</div>
      {phase === 'lottery' && <DraftLottery teams={state.teams} onDone={() => setPhase('draft')} />}
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
      {phase === 'results' && <QuickResults state={state} teamCodeByTeamId={teamCodeByTeamId} onExit={onExit} />}
      {phase !== 'results' && (
        <div className="game-controls">
          <button className="secondary-btn reset-btn" onClick={onExit}>
            Exit
          </button>
        </div>
      )}
    </div>
  );
}

/** The full candidate universe this quick draft draws from — the same `activeDraftPool` (module-
 * level in `draft.ts`) `quickDraft.ts` itself picks from, so what's rendered here always agrees
 * with what `state.draftedIds` is actually tracking. */
function poolFor(state: QuickDraftState): PlayerSpan[] {
  return activeDraftPool.filter((p) => !state.draftedIds.has(p.id));
}

function careerPosition(g: PlayerGroup): Position {
  const counts = new Map<Position, number>();
  for (const span of g.spans) counts.set(span.primaryPosition, (counts.get(span.primaryPosition) ?? 0) + 1);
  return ALL_POSITIONS.reduce((best, pos) => ((counts.get(pos) ?? 0) > (counts.get(best) ?? 0) ? pos : best), ALL_POSITIONS[0]);
}

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
  const allGroups = useMemo(() => groupByPlayer(poolFor(state)), [state]);

  const enriched = useMemo(
    () =>
      allGroups.map((g) => {
        const bestSpan = g.spans.reduce(
          (best, s) => (displayTalentForSpan(tierContextFor(s)) > displayTalentForSpan(tierContextFor(best)) ? s : best),
          g.spans[0],
        );
        return { ...g, bestSpan };
      }),
    [allGroups],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return enriched
      .filter((g) => (selectedPosition !== 'ALL' ? careerPosition(g) === selectedPosition : true))
      .filter((g) => g.playerName.toLowerCase().includes(q))
      .sort((a, b) => {
        const tierDiff =
          tierRank(overallTierForSpan(tierContextFor(b.bestSpan))) - tierRank(overallTierForSpan(tierContextFor(a.bestSpan)));
        if (tierDiff !== 0) return tierDiff;
        return allStarCount(b.playerName) - allStarCount(a.playerName);
      })
      .slice(0, 80);
  }, [enriched, search, selectedPosition]);

  const humanFgas = humanTeam.roster.map((p) => p.fga);
  // Not `capRemaining` from positions.ts — that hardcodes the real 9-man CAP_LIMIT (100.9), wrong
  // for Szybka 5's own 70-shot cap. Same rounding convention as that function otherwise.
  const humanCapRemaining = Math.round((QUICK_CAP_LIMIT - totalFga(humanFgas)) * 10) / 10;

  return (
    <div className="at-card">
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

      {!canPick && <div className="at-cpu-turn-banner">{teamLabel(currentTeam)} is picking…</div>}

      <div className="at-controls-row">
        <input
          className="at-search-input"
          placeholder="Search players…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="at-cap-label" style={{ marginLeft: 'auto' }}>
          Cap remaining: <b>{humanCapRemaining}</b> / {QUICK_CAP_LIMIT} shots
        </div>
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
        <button className="secondary-btn" style={{ marginLeft: 'auto' }} disabled={autoFinishing} onClick={onAutoFinish}>
          {autoFinishing ? 'Finishing…' : 'Auto-finish'}
        </button>
      </div>

      <div className="at-draft-groups">
        {filtered.map((g) => {
          const legal = canPick && isQuickPickLegal(state, g.bestSpan.id);
          return (
            <div className="player-group" key={g.playerName}>
              <div className="pg-summary">
                <span className="pg-name">{g.playerName}</span>
                <span className="pos-pill">{naturalPosition(g.playerName)}</span>
                <span className="pg-tier">
                  <OverallTierBadge span={g.bestSpan} />
                  <span className="lbl">{g.bestSpan.fga.toFixed(1)} shots</span>
                </span>
                <button
                  className="at-draft-btn pg-draft"
                  disabled={!legal}
                  title={
                    !canPick
                      ? `${teamLabel(currentTeam)} is picking…`
                      : !legal
                        ? 'Not a legal pick right now — over the 70-shot cap, or your roster is already full.'
                        : undefined
                  }
                  onClick={() => onPick(g.bestSpan.id)}
                >
                  Draft
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuickResults({
  state,
  teamCodeByTeamId,
  onExit,
}: {
  state: QuickDraftState;
  teamCodeByTeamId: Map<string, string>;
  onExit: () => void;
}) {
  const ranked = useMemo(() => {
    return state.teams
      .map((team) => {
        const finalized = finalizeQuickRotation(team);
        const lineup: Lineup = bestPrimaryAssignment(team.roster).assignment;
        const score = scoreLineup(lineup);
        return { team: finalized, score };
      })
      .sort((a, b) => b.score.composite - a.score.composite);
  }, [state.teams]);

  const humanRank = ranked.findIndex((r) => r.team.isHuman) + 1;
  const human = ranked[humanRank - 1];
  const barKeys: (keyof LineupScore)[] = ['talent', 'offense', 'defense', 'spacing', 'fit'];

  return (
    <div className="at-card bf-result">
      <div className="bf-grade bf-grade--par">
        <span className="bf-grade-label at-cond">
          {humanRank}
          {ordinal(humanRank)} of {TEAM_COUNT}
        </span>
        <span className="bf-grade-blurb">{teamLabel(human.team)} — {human.score.composite} composite</span>
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
      <div className="at-legend-row" style={{ marginTop: 16 }}>
        <p className="at-caption" style={{ marginTop: 0 }}>
          Field
        </p>
      </div>
      <div className="at-tag-legend">
        {ranked.map((r, i) => (
          <div key={r.team.id} className={`historical-challenge-card ${r.team.isHuman ? 'is-complete' : ''}`}>
            <strong>
              {i + 1}. {teamCodeByTeamId.get(r.team.id)} {r.team.isHuman && '(You)'}
            </strong>
            <span>{r.score.composite} composite</span>
          </div>
        ))}
      </div>
      <div className="bf-submit-row bf-result-actions">
        <button className="at-draft-btn bf-submit" onClick={onExit}>
          Exit
        </button>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
