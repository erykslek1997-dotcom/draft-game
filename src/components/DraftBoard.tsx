import { useMemo, useState } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { TEAM_COUNT, ROUNDS, currentTeamIndex, availablePlayers, isPickLegal, type DraftState } from '../engine/draft';
import { CAP_LIMIT, capRemaining, totalFga } from '../engine/positions';
import { computeTalent, computeOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { computeOffensivePortability, computeDefensivePortability } from '../engine/portability';
import { computeSpacing, spacingTier, type SpacingTier } from '../engine/spacing';
import { spanEndYears } from '../engine/era';
import { allStarCount } from '../engine/allStarLookup';
import { offensiveGrade, defensiveGrade, offensivePortabilityGrade, defensivePortabilityGrade, overallTierForSpan, displayTalentForSpan, displayNumberForSpan, type OverallTier } from '../engine/grades';
import { playoffPerformanceTier, type PlayoffPerformanceTier } from '../engine/playoffPerformanceLookup';
import { computeDurability, durabilityTier, type DurabilityTier } from '../engine/durability';
import DraftHistory from './DraftHistory';
import { teamLabel } from '../engine/teamNames';
import type { FeedbackEntry } from './FeedbackToggle';

interface Props {
  state: DraftState;
  onPick: (playerId: string) => void;
  /** 'player' hides every judge-metric (TAL/O-TAL/D-TAL/POR/SPC) and sorts by real-world
   * reputation (career All-Star count, then a stable random tiebreak) instead of TAL, so a
   * draft plays like an actual blind scouting exercise off real box stats alone; 'developer'
   * (default) shows everything and sorts by TAL. */
  mode: 'developer' | 'player';
  /** Passed straight through to `DraftHistory` — see its own docstring. Owned by `GameShell` so
   * it survives the phase transition into the results screen's export. */
  pickReactions: Record<number, FeedbackEntry>;
  onPickReactionChange: (pickNumber: number, entry: FeedbackEntry | undefined) => void;
  /** Commissioner Mode's per-pick causal-reasoning notes — same lift-to-GameShell shape as
   * `pickReactions` above, passed straight through to `DraftHistory`. */
  pickReasoning: Record<number, string>;
  onPickReasoningChange: (pickNumber: number, reasoning: string) => void;
}

export const ALL_POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

export interface PlayerGroup {
  playerName: string;
  spans: PlayerSpan[];
}

/** Maps a tier to its CSS modifier class. Kept as an explicit record rather than deriving a
 * class from the label so a renamed tier fails at the type level instead of silently losing
 * its colour. */
const SPACING_TIER_CLASS: Record<SpacingTier, string> = {
  'Non-shooter': 'tier-non',
  'Bad shooter': 'tier-bad',
  'Average shooter': 'tier-avg',
  'Good shooter': 'tier-good',
  'Great shooter': 'tier-great',
  'Walking gravity': 'tier-gravity',
  'Shooting anomaly': 'tier-anomaly',
};

export function SpacingTierBadge({ span }: { span: PlayerSpan }) {
  const tier = spacingTier(span);
  return <span className={`tier-badge ${SPACING_TIER_CLASS[tier]}`}>{tier}</span>;
}

/** Same pill shape/pattern as `SpacingTierBadge`, one hue family per band — kept fully distinct
 * from SPACING's own palette (see .rating-* in App.css) so the two badge columns never look like
 * they're describing the same scale when they sit in the same row. Takes a full span rather than
 * the raw TAL value — 2026-08-05, the user's position-based tier-cap rules (`overallTierForSpan`)
 * need O-TAL/D-TAL/FGA/position alongside TAL, the same reason `SpacingTierBadge` already needed
 * the player's identity for the Curry exception, not just the number. */
const OVERALL_TIER_CLASS: Record<OverallTier, string> = {
  'Cigarette Butt': 'rating-cigarette',
  'Bench Warmer': 'rating-bench',
  'Role Player': 'rating-role',
  Starter: 'rating-starter',
  'All-star': 'rating-allstar',
  'All-NBA': 'rating-allnba',
  MVP: 'rating-mvp',
  'Greatest peak': 'rating-peak',
  GOAT: 'rating-goat',
};

/** Shared by `OverallTierBadge` and every "TAL {number}" display site — building this once and
 * reusing it for both the badge and the number next to it is what guarantees they can never
 * disagree (see `displayTalentForSpan`'s own docstring for why they used to). `playerName` is
 * needed for the GOAT-tier check (grades.ts) — every other field already came from `span`. */
export function tierContextFor(span: PlayerSpan) {
  return {
    position: span.primaryPosition,
    tal: computeTalent(span),
    otal: computeOffensiveTalent(span),
    dtal: computeDefensiveTalent(span),
    fga: span.fga,
    playerName: span.playerName,
  };
}

export function OverallTierBadge({ span }: { span: PlayerSpan }) {
  const tier = overallTierForSpan(tierContextFor(span));
  return <span className={`tier-badge ${OVERALL_TIER_CLASS[tier]}`}>{tier}</span>;
}

/** Real playoff-performance tag (see `playoffPerformanceLookup.ts`) — a third, fully distinct
 * palette (red family = dropped efficiency, green family = rose above it) so it can't be
 * mistaken for either SPACING's or the overall-rating's own colour scales. Most spans don't
 * carry a tag at all, so this renders nothing rather than a "None" pill when absent — matches
 * how a below-median SPACING/rating span still always gets SOME tier, but this one is
 * deliberately rare. */
const PLAYOFF_TIER_CLASS: Record<PlayoffPerformanceTier, string> = {
  'Platinum Dropper': 'playoff-platinum-drop',
  'Gold Dropper': 'playoff-gold-drop',
  'Silver Dropper': 'playoff-silver-drop',
  'Bronze Dropper': 'playoff-bronze-drop',
  'Bronze Riser': 'playoff-bronze-rise',
  'Silver Riser': 'playoff-silver-rise',
  'Gold Riser': 'playoff-gold-rise',
  'Platinum Riser': 'playoff-platinum-rise',
};

export function PlayoffPerformanceBadge({ span }: { span: PlayerSpan }) {
  const tier = playoffPerformanceTier(span);
  if (!tier) return null;
  return <span className={`tier-badge ${PLAYOFF_TIER_CLASS[tier]}`}>{tier}</span>;
}

/** DUR tier pills (`durability.ts`) — a fourth distinct palette, cool blue-to-violet ladder so
 * it can't be mistaken for SPACING (warm cool-to-warm), the overall rating (grey-to-gold), or
 * playoff performance (red/green). DNP/Walking Glass/Street Clothes are included for
 * completeness even though no real span in the current dataset reaches them (the source data's
 * own floor is 66.7% availability) — if a future data update ever adds a genuinely fragile
 * span, the badge is already correct for it. */
const DURABILITY_TIER_CLASS: Record<DurabilityTier, string> = {
  DNP: 'dur-dnp',
  'Walking Glass': 'dur-walking-glass',
  'Street Clothes': 'dur-street-clothes',
  'Load Management': 'dur-load-management',
  Reliable: 'dur-reliable',
  Unbreakable: 'dur-unbreakable',
  Ironman: 'dur-ironman',
};

export function DurabilityTierBadge({ span }: { span: PlayerSpan }) {
  const tier = durabilityTier(span);
  return <span className={`tier-badge ${DURABILITY_TIER_CLASS[tier]}`}>{tier}</span>;
}

/** Spans arrive in dataset order, which for the generated players is effectively arbitrary —
 * a player's rows would jump around (2010-12, 2015-17, 2009-11...). Sorted chronologically so
 * an expanded player reads as a career from earliest to latest. `spanEndYears` is the same
 * label-parsing helper the engine uses, so an unparseable label degrades to a stable string
 * compare rather than throwing the order out. */
export function byChronology(a: PlayerSpan, b: PlayerSpan): number {
  const aYears = spanEndYears(a.spanLabel);
  const bYears = spanEndYears(b.spanLabel);
  if (aYears.length > 0 && bYears.length > 0 && aYears[0] !== bYears[0]) return aYears[0] - bYears[0];
  return a.spanLabel.localeCompare(b.spanLabel);
}

export function groupByPlayer(list: PlayerSpan[]): PlayerGroup[] {
  const map = new Map<string, PlayerSpan[]>();
  for (const p of list) {
    const arr = map.get(p.playerName);
    if (arr) arr.push(p);
    else map.set(p.playerName, [p]);
  }
  return Array.from(map.entries()).map(([playerName, spans]) => ({
    playerName,
    spans: [...spans].sort(byChronology),
  }));
}

export default function DraftBoard({ state, onPick, mode, pickReactions, onPickReactionChange, pickReasoning, onPickReasoningChange }: Props) {
  const showJudgeMetrics = mode === 'developer';
  const [search, setSearch] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<Position | 'ALL' | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Defaults open in Commissioner Mode: every pick needs its reasoning box reachable right after
  // it's made, across up to 144 picks — an extra click to reveal it every single time would be a
  // real friction cost at that volume.
  const [showHistory, setShowHistory] = useState(state.commissionerMode);

  const teamIdx = currentTeamIndex(state);
  const currentTeam = state.teams[teamIdx];
  const pickNumber = state.round * TEAM_COUNT + state.pickInRound + 1;
  const totalPicks = TEAM_COUNT * ROUNDS;

  const available = useMemo(() => availablePlayers(state), [state]);
  const currentFgas = currentTeam.roster.map((p) => p.fga);

  const isSearching = search.trim() !== '';
  const isBrowsing = selectedPosition !== null || isSearching;

  const allGroups = useMemo(() => groupByPlayer(available), [available]);

  // A stable per-pool random tiebreak for player-mode sorting — generated once per pool
  // (recomputed only when `available` actually changes, e.g. after a pick), not on every
  // render, so the list doesn't visibly reshuffle while just typing a search or expanding a row.
  const randomTiebreak = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of available) if (!map.has(p.playerName)) map.set(p.playerName, Math.random());
    return map;
  }, [available]);

  // The position he played the most seasons at, so a player appears under exactly one
  // position column instead of every position any single span's primary/secondary touched.
  function careerPosition(g: PlayerGroup): Position {
    const counts = new Map<Position, number>();
    for (const span of g.spans) counts.set(span.primaryPosition, (counts.get(span.primaryPosition) ?? 0) + 1);
    return ALL_POSITIONS.reduce((best, pos) => ((counts.get(pos) ?? 0) > (counts.get(best) ?? 0) ? pos : best), ALL_POSITIONS[0]);
  }

  // Only spans the current team can actually afford - an unaffordable span shouldn't linger
  // in the list as a disabled row, it should simply not be an option anymore.
  const legalGroups = allGroups
    .map((g) => ({ ...g, spans: g.spans.filter((s) => isPickLegal(state, s.id)) }))
    .filter((g) => g.spans.length > 0);

  const positionCounts = new Map<Position, number>(
    ALL_POSITIONS.map((pos) => [pos, legalGroups.filter((g) => careerPosition(g) === pos).length]),
  );

  // Every judge metric computed exactly once per visible player here, not once per sort
  // comparison and again for display. `Array.sort` on ~325 players calls its comparator
  // roughly n*log2(n) ≈ 2,700 times — the previous version called `computeTalent` fresh
  // inside the comparator every single time (measured: ~2s of a ~2.6s render, purely from
  // that redundancy), then the render below recomputed the same values a second time for
  // display. `showJudgeMetrics` gates the other five so player mode — which never displays
  // or sorts by them — doesn't pay for them at all.
  //
  // Skipped entirely (`[]`) when `!isBrowsing`: the position-grid view below only reads
  // `legalGroups.length`/`positionCounts`, never `groups` — found live, 2026-07-31, via a
  // `longtask` trace showing the "← Positions" click (which renders nothing but counts)
  // paying the exact same ~465ms as an actual browse click, because this ran unconditionally
  // on every render regardless of which view was showing.
  const groups = !isBrowsing
    ? []
    : legalGroups
        .filter((g) => (selectedPosition && selectedPosition !== 'ALL' ? careerPosition(g) === selectedPosition : true))
        .filter((g) => g.playerName.toLowerCase().includes(search.toLowerCase()))
        .map((g) => {
          // The specific span behind this player's best TAL — found once here and reused for
          // both the sort key and the header's displayed number/badge below, so a player never
          // sorts by one number while showing another. 2026-08-05: sorting used to read the raw
          // uncapped `computeTalent` while the header displayed the position-tier-capped number
          // (`displayTalentForSpan`) — a capped player (real TAL high, displayed TAL knocked down
          // to their tier's ceiling) could sort *above* an uncapped player with a genuinely
          // higher displayed number, reading as a broken/random order in the list. Both now use
          // the same capped value.
          // 2026-08-05 follow-up: picking by raw `computeTalent` could surface a span whose own
          // tier gate caps it *harder* than a different, lower-raw-TAL span of the same player —
          // David Robinson's highest-TAL span (1993-95, A+ defense) caps to MVP, while a slightly
          // lower-TAL span (1990-92, true S-grade defense) reaches "Greatest peak" uncapped, so
          // showing his max-raw-TAL span was hiding his actual best achievable tier. Picks by the
          // capped/displayed value instead, so "this player's best" always means their best real,
          // in-game result, not just their highest hidden number.
          const bestTalentSpan = showJudgeMetrics
            ? g.spans.reduce(
                (best, s) =>
                  displayTalentForSpan(tierContextFor(s)) > displayTalentForSpan(tierContextFor(best)) ? s : best,
                g.spans[0],
              )
            : g.spans[0];
          return {
            ...g,
            bestTalentSpan,
            bestTalent: showJudgeMetrics ? displayTalentForSpan(tierContextFor(bestTalentSpan)) : 0,
            bestOffensiveTalent: showJudgeMetrics ? Math.max(...g.spans.map(computeOffensiveTalent)) : 0,
            bestDefensiveTalent: showJudgeMetrics ? Math.max(...g.spans.map(computeDefensiveTalent)) : 0,
            bestOffensivePortability: showJudgeMetrics ? Math.max(...g.spans.map(computeOffensivePortability)) : 0,
            bestDefensivePortability: showJudgeMetrics ? Math.max(...g.spans.map(computeDefensivePortability)) : 0,
            bestSpacing: showJudgeMetrics ? Math.max(...g.spans.map(computeSpacing)) : 0,
            bestDurability: showJudgeMetrics ? Math.max(...g.spans.map(computeDurability)) : 0,
          };
        })
        .sort((a, b) => {
          if (mode === 'player') {
            const starDiff = allStarCount(b.playerName) - allStarCount(a.playerName);
            if (starDiff !== 0) return starDiff;
            return (randomTiebreak.get(a.playerName) ?? 0) - (randomTiebreak.get(b.playerName) ?? 0);
          }
          return b.bestTalent - a.bestTalent;
        });

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function backToPositions() {
    setSelectedPosition(null);
    setSearch('');
  }

  return (
    <div className="draft-board">
      <div className="draft-status">
        <strong>
          Pick {pickNumber} of {totalPicks}
        </strong>{' '}
        — Round {state.round + 1} —{' '}
        {state.commissionerMode
          ? `Your pick as ${teamLabel(currentTeam)}`
          : currentTeam.isHuman
            ? 'Your pick'
            : `${teamLabel(currentTeam)} is picking…`}
        <button className="history-toggle" onClick={() => setShowHistory((s) => !s)}>
          {showHistory ? 'Hide' : 'Show'} Draft History
        </button>
      </div>

      {showHistory && (
        <DraftHistory
          history={state.history}
          teams={state.teams}
          reactions={pickReactions}
          onReactionChange={onPickReactionChange}
          commissionerMode={state.commissionerMode}
          reasoning={pickReasoning}
          onReasoningChange={onPickReasoningChange}
        />
      )}

      <div className="team-panels">
        {state.teams.map((team, i) => (
          <div key={team.id} className={`team-panel ${i === teamIdx ? 'active' : ''}`}>
            <h4>
              {teamLabel(team)} {team.isHuman ? '(You)' : ''}
            </h4>
            <div className="cap-meter">
              {totalFga(team.roster.map((p) => p.fga)).toFixed(1)} / {CAP_LIMIT} FGA
            </div>
            <div className="roster-count">{team.roster.length} / 9 picked</div>
            <ul className="mini-roster">
              {team.roster.map((p) => (
                <li key={p.id}>
                  {p.primaryPosition} — {p.playerName} ({p.spanLabel})
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {currentTeam.isHuman || state.commissionerMode ? (
        <div className="player-pool">
          <div className="pool-controls">
            <input
              placeholder="Search players…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="cap-remaining">Cap remaining: {capRemaining(currentFgas)} FGA</div>
          </div>

          {!isBrowsing ? (
            <div className="position-grid">
              <button key="ALL" className="position-card" onClick={() => setSelectedPosition('ALL')}>
                <span className="position-card-label">ALL</span>
                <span className="position-card-count">{legalGroups.length} players</span>
              </button>
              {ALL_POSITIONS.map((pos) => (
                <button key={pos} className="position-card" onClick={() => setSelectedPosition(pos)}>
                  <span className="position-card-label">{pos}</span>
                  <span className="position-card-count">{positionCounts.get(pos)} players</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="browse-header">
                <button className="secondary-btn" onClick={backToPositions}>
                  ← Positions
                </button>
                <span className="browse-title">
                  {selectedPosition
                    ? `${selectedPosition === 'ALL' ? 'All positions' : selectedPosition} — sorted by ${mode === 'player' ? 'All-Star appearances' : 'talent'}`
                    : `Search results for "${search}"`}
                </span>
              </div>

              <div className="player-groups">
            {groups.map((group) => {
              const isOpen = expanded.has(group.playerName);
              const fgas = group.spans.map((s) => s.fga);
              const minFga = Math.min(...fgas);
              const maxFga = Math.max(...fgas);
              const {
                bestTalentSpan,
                bestOffensiveTalent,
                bestDefensiveTalent,
                bestOffensivePortability,
                bestDefensivePortability,
                bestSpacing,
                bestDurability,
              } = group;
              return (
                <div key={group.playerName} className="player-group">
                  <button className="player-group-header" onClick={() => toggleExpand(group.playerName)}>
                    <span className="pg-caret">{isOpen ? '▾' : '▸'}</span>
                    <span className="pg-name">{group.playerName}</span>
                    <span className="pg-meta">
                      {group.spans.length} season{group.spans.length > 1 ? 's' : ''}
                    </span>
                    <span className="pg-fga">
                      {minFga === maxFga ? minFga.toFixed(1) : `${minFga.toFixed(1)}–${maxFga.toFixed(1)}`} FGA
                    </span>
                    {showJudgeMetrics && (
                      <span className="pg-tal">
                        TAL {displayNumberForSpan(bestTalentSpan, tierContextFor(bestTalentSpan))} <OverallTierBadge span={bestTalentSpan} />
                      </span>
                    )}
                    {showJudgeMetrics && <span className="pg-otal">O-TAL {offensiveGrade(bestOffensiveTalent)}</span>}
                    {showJudgeMetrics && <span className="pg-dtal">D-TAL {defensiveGrade(bestDefensiveTalent)}</span>}
                    {showJudgeMetrics && (
                      <span className="pg-opor">O-POR {offensivePortabilityGrade(bestOffensivePortability)}</span>
                    )}
                    {showJudgeMetrics && (
                      <span className="pg-dpor">D-POR {defensivePortabilityGrade(bestDefensivePortability)}</span>
                    )}
                    {showJudgeMetrics && <span className="pg-spc">SPC {bestSpacing}</span>}
                    {showJudgeMetrics && <span className="pg-dur">DUR {bestDurability}</span>}
                  </button>
                  {isOpen && (
                    <div className="table-scroll">
                      <table className="span-table">
                        <thead>
                          <tr>
                            <th>Span</th>
                            <th>Pos</th>
                            <th>FGA</th>
                            {showJudgeMetrics && <th>TAL</th>}
                            {showJudgeMetrics && <th>Tier</th>}
                            {showJudgeMetrics && <th>O-TAL</th>}
                            {showJudgeMetrics && <th>D-TAL</th>}
                            {showJudgeMetrics && <th>O-POR</th>}
                            {showJudgeMetrics && <th>D-POR</th>}
                            {showJudgeMetrics && <th>SPC</th>}
                            {showJudgeMetrics && <th>Shooter</th>}
                            {showJudgeMetrics && <th>Playoffs</th>}
                            {showJudgeMetrics && <th>DUR</th>}
                            <th>PTS</th>
                            <th>REB</th>
                            <th>AST</th>
                            <th>3PT%</th>
                            <th>Archetype</th>
                            <th>Defense</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.spans.map((span) => (
                            <tr key={span.id}>
                              <td>{span.spanLabel}</td>
                              <td>
                                {span.primaryPosition}
                                {span.secondaryPositions.length ? ` / ${span.secondaryPositions.join(',')}` : ''}
                              </td>
                              <td>{span.fga.toFixed(1)}</td>
                              {showJudgeMetrics && <td>{displayNumberForSpan(span, tierContextFor(span))}</td>}
                              {showJudgeMetrics && (
                                <td>
                                  <OverallTierBadge span={span} />
                                </td>
                              )}
                              {showJudgeMetrics && <td>{offensiveGrade(computeOffensiveTalent(span))}</td>}
                              {showJudgeMetrics && <td>{defensiveGrade(computeDefensiveTalent(span))}</td>}
                              {showJudgeMetrics && <td>{offensivePortabilityGrade(computeOffensivePortability(span))}</td>}
                              {showJudgeMetrics && <td>{defensivePortabilityGrade(computeDefensivePortability(span))}</td>}
                              {showJudgeMetrics && <td>{computeSpacing(span)}</td>}
                              {showJudgeMetrics && (
                                <td>
                                  <SpacingTierBadge span={span} />
                                </td>
                              )}
                              {showJudgeMetrics && (
                                <td>
                                  <PlayoffPerformanceBadge span={span} />
                                </td>
                              )}
                              {showJudgeMetrics && (
                                <td>
                                  {computeDurability(span)} <DurabilityTierBadge span={span} />
                                </td>
                              )}
                              <td>{span.box.ppg.toFixed(1)}</td>
                              <td>{span.box.rpg.toFixed(1)}</td>
                              <td>{span.box.apg.toFixed(1)}</td>
                              <td>{(span.box.threePct * 100).toFixed(1)}%</td>
                              <td>{span.offensiveArchetype}</td>
                              <td>{span.defensiveRole}</td>
                              <td>
                                <button onClick={() => onPick(span.id)}>Draft</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="cpu-thinking">{teamLabel(currentTeam)} is thinking…</div>
      )}
    </div>
  );
}
