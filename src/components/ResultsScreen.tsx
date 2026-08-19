import { lazy, Suspense, useMemo, useState } from 'react';
import { rankTeams } from '../engine/scoring';
import { evaluateLeague } from '../engine/leagueSimulation';
import { STARTER_SLOTS } from '../engine/positions';
import { allAssignments, benchWithMinutes, primaryStarters } from '../engine/rotation';
import { draftPool } from '../data/draftPool';
import { normalizePlayerName } from '../data/schema';
import type { DraftHistoryEntry, Rotation, Team } from '../engine/types';
import { teamLabel } from '../engine/teamNames';
import { computeOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
// `effectiveTalent` for every plain TAL read; `displayTalentForSpan` stays separately imported
// for the two call sites below that use the Sixth-Man-aware `tierContextWithSixthMan` context
// instead of the plain one `effectiveTalent` builds internally.
import { effectiveTalent, displayTalentForSpan } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { computeOffensivePortability, computeDefensivePortability } from '../engine/portability';
import { computeSpacing } from '../engine/spacing';
import { computeDurability } from '../engine/durability';
import { projectedNetRating } from '../engine/netRatingProjection';
import { fitScore } from '../engine/fit';
import { defensiveHuntability } from '../engine/defensiveHuntability';
import { generateRosterInsights } from '../engine/insights';
import { buildTeamFeatureSnapshot } from '../engine/insightMapper';
import FeedbackToggle, { type FeedbackEntry } from './FeedbackToggle';
import RotationBuilder from './RotationBuilder';
// 2026-08-16, user's own ask ("dodasz to też na ostatni ekran ocen?"): reuses the exact same
// hover-stats popover the Overview grid's own drafted-pick cells already have (DraftBoard.tsx) —
// safe to import directly (not lazy) since GameShell already bundles DraftBoard and this file
// together as siblings, so nothing about the app's existing load-time split changes.
import { pickStatTip, OverallTierBadge } from './DraftBoard';
import type { PlayerSpan } from '../data/schema';

/**
 * 2026-08-15, user-reported: the Rotation/Bench bracket tag next to a player's row used to read
 * `naturalPosition(playerName)` — a whole-career majority-vote label (naturalPosition.ts), built
 * from the FULL pool of that person's spans, not the ONE span actually drafted here. That's a
 * real, deliberate feature for a different purpose (a stable identity cue — see that file's own
 * docstring), but sitting next to a specific rotation slot it reads as "this player's position,"
 * and disagrees with the SPECIFIC span's own `primaryPosition`/`secondaryPositions` whenever a
 * person's early/late-career tag differs from their overall-career majority (confirmed directly:
 * Magic Johnson's 1981-83 span is primary SG/secondary PG in the data, but naturalPosition() reads
 * "PG/SG" from his whole career — exactly the "why isn't Magic at PG" confusion this was root-
 * caused to earlier in the same investigation). Shows the actual drafted span's own tag instead —
 * the one number that really drives `positionFitMultiplier`/rotation eligibility for THIS
 * assignment, so the bracket can never again disagree with why a player is slotted where he is.
 */
function spanPositionTag(player: PlayerSpan): string {
  return [player.primaryPosition, ...player.secondaryPositions].join('/');
}

// Lazy, matching App.tsx's own lazy() call for this exact component (see GameShell.tsx's
// lazy-loading docstring) — a static import here would bundle DraftPoolBrowser (plus its own
// allStarLookup.ts/grades.ts imports) into every draft session's GameShell chunk, even for the
// far more common case of a user who finishes a draft and never opens the pool browser from here.
const DraftPoolBrowser = lazy(() => import('./DraftPoolBrowser'));

interface Props {
  teams: Team[];
  /** Full draft history across every team, so each team's card can show its own pick order —
   * the user's own ask: "show team draft history in [results] screen." The live "Show Draft
   * History" toggle during the draft only covers the in-progress view; this is the same data,
   * scoped per team, on the screen that actually sticks around after the draft ends. */
  history: DraftHistoryEntry[];
  mode: 'developer' | 'player';
  onRestart: () => void;
  /** Read-only here — reactions made live during the draft (see `DraftHistory`/`GameShell`).
   * Folded into the same export as this screen's own roster-row reactions so a single downloaded
   * file has everything. */
  pickReactions: Record<number, FeedbackEntry>;
  /** Commissioner Mode's per-pick causal-reasoning notes (see `DraftHistory`/`GameShell`) — empty
   * for a normal single-human-team draft. Folded into the same export as everything else here. */
  pickReasoning: Record<number, string>;
}

/** Keyed by roster player id — one reaction per rostered player, set directly on that player's
 * row (see `FeedbackToggle`'s own docstring for why this replaced the old
 * pick-a-player-from-a-dropdown + pick-a-direction-from-a-second-dropdown flow). */
type PlayerFeedback = Record<string, FeedbackEntry>;

interface TeamFeedback {
  /** 2026-08-09, user's explicit ask: replaces the old yes/no/unsure agreement dropdown with the
   * user's own 1-16 Power Ranking placement for this team — a direct, comparable number against
   * the algorithm's own `rank`, not just a binary "do you agree." Kept as a string (not number)
   * for the same "empty string means unset" reason every other optional text field on this type
   * uses — an actual `0`/`NaN` sentinel would be ambiguous with a real rank. */
  userRank: string;
  rankingNote: string;
  playerNotes: PlayerFeedback;
  rotationNote: string;
  otherNote: string;
}

const EMPTY_FEEDBACK: TeamFeedback = { userRank: '', rankingNote: '', playerNotes: {}, rotationNote: '', otherNote: '' };

/**
 * 2026-08-14, results-screen redesign (user's own ask, "wszystko na raz" — full pass in one go):
 * team-level 0-100 scores (Talent/Offense/Defense/Spacing/Fit/Rotation) get the same 6-band
 * amber-ladder pill the Draft tab's Overview grid already uses for per-player metrics
 * (`--at-t1`..`--at-t6` in App.css) — same "how good is this" visual language across the whole
 * app, rather than inventing a new red/yellow/green scale that would compete with it. A local
 * component (not DraftBoard.tsx's own unexported `AtDot`) since these are TEAM aggregates, a
 * different semantic axis from a single player's TAL tier — reusing the CSS variables, not the
 * player-specific component.
 */
function scoreBand(score: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (score < 17) return 1;
  if (score < 33) return 2;
  if (score < 50) return 3;
  if (score < 67) return 4;
  if (score < 83) return 5;
  return 6;
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  return (
    <span className={`score-chip score-t${scoreBand(value)}`}>
      <span className="score-chip-label">{label}</span>
      <span className="score-chip-value">{value}</span>
    </span>
  );
}

function feedbackFor(record: Record<string, TeamFeedback>, teamId: string): TeamFeedback {
  return record[teamId] ?? EMPTY_FEEDBACK;
}

/**
 * 2026-08-03, user's own ask (in Polish): a way to leave per-team feedback ("what I like / don't
 * like") on the results screen, and export it as a file with enough context that a FUTURE
 * session can actually analyze it — not just the comment text on its own, since a bare "this
 * roster feels off" without the underlying ratings/rotation/picks is nothing to act on. Exports
 * every team's full roster (every judge metric per player), rotation minutes, the complete
 * ScoreBreakdown, and that team's draft-order history alongside the comment, matching how every
 * other real-data decision this project has made needed full context, not a partial one.
 *
 * Pure client-side (no backend) — the file downloads via a Blob + a synthetic anchor click, the
 * standard no-server-needed browser download pattern. The exported JSON is meant to be handed
 * back to Claude in a later session the same way every other CSV/xlsx export in this project's
 * history has been.
 *
 * 2026-08-04, follow-up (in Polish): "give me a template I can fill in, and let me browse every
 * player the same way as during the draft." A single freeform textarea made every export equally
 * vague — this project's own established lesson (see the memory file's "Durable lessons" section)
 * is that a *specific named player + direction + reasoning* is worth far more than a general "feels
 * off" comment, so the template is structured around exactly that shape instead of open prose.
 * `DraftPoolBrowser` already existed for full-pool browsing (built for the intro screen) and is
 * reused here as-is via a full-screen toggle, rather than duplicating its search/filter/expand logic.
 */
function remainingOnBoard(teams: Team[]) {
  const draftedNames = new Set(teams.flatMap((t) => t.roster.map((p) => normalizePlayerName(p.playerName))));
  const byPlayer = new Map<string, (typeof draftPool)[number]>();
  for (const span of draftPool) {
    if (draftedNames.has(normalizePlayerName(span.playerName))) continue;
    const cur = byPlayer.get(span.playerName);
    if (!cur || effectiveTalent(span) > effectiveTalent(cur)) byPlayer.set(span.playerName, span);
  }
  return [...byPlayer.values()]
    .map((span) => ({
      playerName: span.playerName,
      spanLabel: span.spanLabel,
      primaryPosition: span.primaryPosition,
      TAL: effectiveTalent(span),
    }))
    .sort((a, b) => b.TAL - a.TAL);
}

/** Shared shape for both the original (auto-assigned) and corrected rotation in the export below
 * — same fields either way, so an ML pipeline can diff them directly without special-casing. */
function buildRotationExport(team: Team) {
  const assignments = allAssignments(team);
  const bench = benchWithMinutes(team);
  return {
    rotation: STARTER_SLOTS.map((slot) => ({
      slot,
      entries: assignments
        .filter((a) => a.slot === slot)
        .sort((a, b) => b.minutes - a.minutes)
        .map((a) => ({ playerName: a.player.playerName, spanLabel: a.player.spanLabel, minutes: a.minutes })),
    })),
    bench: bench.map(({ player, minutes }) => ({ playerName: player.playerName, spanLabel: player.spanLabel, minutes })),
  };
}

function buildFeedbackExport(
  teams: Team[],
  history: DraftHistoryEntry[],
  feedback: Record<string, TeamFeedback>,
  pickReactions: Record<number, FeedbackEntry>,
  pickReasoning: Record<number, string>,
  /** 2026-08-08, user's explicit ask: manual rotation corrections (any team, not just the
   * human's, made from this screen — see `RotationBuilder`'s reuse below) exported ALONGSIDE the
   * original auto-assigned rotation, always both fields present (not just when a correction was
   * made) — the user's own words, "do eksportu obie wersje," so an ML pipeline training "how to
   * fix a rotation given a roster" always has a consistent (original, corrected) pair per team,
   * even a same-as-original one when nothing was touched, rather than a sometimes-null field. */
  correctedRotations: Record<string, Rotation>,
) {
  const ranked = rankTeams(teams);
  const leagueEval = evaluateLeague(teams);
  const leagueEvalByTeamId = new Map(leagueEval.map((e) => [e.teamId, e]));
  // Live in-draft reactions (see DraftHistory/GameShell) — only flagged picks carry a
  // complaint, same "no flag = no complaint, don't export a wall of confirmations" convention
  // as the per-roster playerNotes below.
  const draftPickFeedback = Object.entries(pickReactions)
    .filter(([, entry]) => entry.status === 'flagged')
    .map(([pickNumberStr, entry]) => {
      const pickNumber = Number(pickNumberStr);
      const h = history.find((historyEntry) => historyEntry.pickNumber === pickNumber);
      const p = h ? draftPool.find((pl) => pl.id === h.playerId) : undefined;
      const team = h ? teams.find((t) => t.id === h.teamId) : undefined;
      return {
        pickNumber,
        teamLabel: team ? teamLabel(team) : null,
        playerName: p?.playerName ?? null,
        spanLabel: p?.spanLabel ?? null,
        reason: entry.reason,
      };
    })
    .sort((a, b) => a.pickNumber - b.pickNumber);

  return {
    exportedAt: new Date().toISOString(),
    remainingOnBoard: remainingOnBoard(teams),
    draftPickFeedback,
    teams: ranked.map(({ team, breakdown, rank }) => {
      const original = buildRotationExport(team);
      const correction = correctedRotations[team.id];
      const corrected = correction ? buildRotationExport({ ...team, rotation: correction }) : original;
      const teamHistory = history
        .filter((h) => h.teamId === team.id)
        .sort((a, b) => a.pickNumber - b.pickNumber)
        .map((h) => {
          const p = draftPool.find((pl) => pl.id === h.playerId);
          return {
            pickNumber: h.pickNumber,
            playerId: h.playerId,
            playerName: p?.playerName ?? null,
            spanLabel: p?.spanLabel ?? null,
            fga: p?.fga ?? null,
            TAL: p ? effectiveTalent(p) : null,
            // Commissioner Mode's causal note for this exact pick, if one was written — null for
            // a normal single-human-team draft (pickReasoning is empty then).
            reasoning: pickReasoning[h.pickNumber] ?? null,
          };
        });
      const roster = team.roster.map((p) => ({
        playerName: p.playerName,
        spanLabel: p.spanLabel,
        primaryPosition: p.primaryPosition,
        secondaryPositions: p.secondaryPositions,
        fga: p.fga,
        TAL: effectiveTalent(p),
        OTAL: computeOffensiveTalent(p),
        DTAL: computeDefensiveTalent(p),
        OPOR: computeOffensivePortability(p),
        DPOR: computeDefensivePortability(p),
        SPC: computeSpacing(p),
        DUR: computeDurability(p),
      }));
      const fb = feedback[team.id] ?? EMPTY_FEEDBACK;
      return {
        rank,
        teamId: team.id,
        label: teamLabel(team),
        isHuman: team.isHuman,
        overall: breakdown.overall,
        breakdown,
        netRatingProjection: projectedNetRating(team),
        leagueEvaluation: leagueEvalByTeamId.get(team.id) ?? null,
        roster,
        rotation: original.rotation,
        bench: original.bench,
        // Always present (see this function's own docstring on `correctedRotations`) — identical
        // to `rotation`/`bench` above when this team's rotation was never manually touched.
        correctedRotation: corrected.rotation,
        correctedBench: corrected.bench,
        rotationWasCorrected: Boolean(correction),
        draftOrder: teamHistory,
        feedback: {
          // The algorithm's own placement is already `rank` above — exporting the user's number
          // right alongside it (both null-able the same way) is what actually makes this
          // comparable, rather than requiring a join against the top-level field later.
          userRank: fb.userRank === '' ? null : Number(fb.userRank),
          algorithmicRank: rank,
          rankingNote: fb.rankingNote,
          rotationNote: fb.rotationNote,
          otherNote: fb.otherNote,
          playerNotes: Object.entries(fb.playerNotes)
            .filter(([, entry]) => entry.status === 'flagged')
            .map(([playerId, entry]) => {
              const p = team.roster.find((r) => r.id === playerId);
              return {
                playerName: p?.playerName ?? null,
                spanLabel: p?.spanLabel ?? null,
                reason: entry.reason,
              };
            }),
        },
      };
    }),
  };
}

function downloadFeedback(
  teams: Team[],
  history: DraftHistoryEntry[],
  feedback: Record<string, TeamFeedback>,
  pickReactions: Record<number, FeedbackEntry>,
  pickReasoning: Record<number, string>,
  correctedRotations: Record<string, Rotation>,
) {
  const data = buildFeedbackExport(teams, history, feedback, pickReactions, pickReasoning, correctedRotations);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `draft-feedback-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ResultsScreen({ teams, history, mode, onRestart, pickReactions, pickReasoning }: Props) {
  const teamById = (id: string) => teams.find((t) => t.id === id);
  const playerById = (id: string) => draftPool.find((p) => p.id === id);
  const [feedback, setFeedback] = useState<Record<string, TeamFeedback>>({});
  const [showBrowser, setShowBrowser] = useState(false);
  const leftOnBoard = remainingOnBoard(teams);
  // 2026-08-08, user's explicit ask: correct ANY team's rotation from this screen (not just the
  // human's own, pre-results one — see RotationBuilder's reuse below), kept separate from the
  // original auto-assigned `team.rotation` so the export can carry both (see
  // `buildFeedbackExport`'s own docstring on `correctedRotations`).
  const [correctedRotations, setCorrectedRotations] = useState<Record<string, Rotation>>({});
  const [editingRotationTeamId, setEditingRotationTeamId] = useState<string | null>(null);
  // 2026-08-14, results-screen redesign: 16 full team cards on one page was the single biggest
  // usability complaint (scrolling past 15 opponents to see your own team) — every card now
  // starts collapsed to a one-line summary, except the human's own team, which starts expanded
  // since that's what a player actually opens this screen to see first. `useState(() => ...)`
  // (lazy initializer) so this only runs once, not on every render.
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(
    () => new Set(teams.filter((t) => t.isHuman).map((t) => t.id)),
  );
  // Scores, ranking and matchup simulation must all read the same corrected rotations as the
  // visible card. Previously only the minutes list and DRTG used a manual correction while the
  // chips/rank/odds silently kept the original auto-rotation, producing impossible combinations
  // such as Defense 76 beside a corrected-rotation DRTG of 87.0.
  const scoredTeams = useMemo(
    () => teams.map((team) => {
      const correction = correctedRotations[team.id];
      return correction ? { ...team, rotation: correction } : team;
    }),
    [teams, correctedRotations],
  );
  // Ranking is cheap compared with the Monte Carlo evaluation and intentionally recomputes on
  // render; during local calibration HMR can replace scoring code without changing team identity.
  const ranked = rankTeams(scoredTeams);
  // Monte Carlo bracket sim (20,000 runs) is expensive, so it reruns only when the draft teams or
  // a saved rotation correction actually change — not when feedback text or expansion state does.
  const leagueEval = useMemo(() => evaluateLeague(scoredTeams), [scoredTeams]);
  const leagueEvalByTeamId = useMemo(() => new Map(leagueEval.map((entry) => [entry.teamId, entry])), [leagueEval]);
  function toggleExpanded(teamId: string) {
    setExpandedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  /** The rotation actually shown on this screen for a team — its correction if one was made,
   * otherwise the original auto-assigned one. Every display/render site below should read
   * through this, not `team.rotation` directly, so a saved correction is reflected everywhere
   * (minutes list, bench, scoring) immediately, not just in the export. */
  function displayTeam(team: Team): Team {
    const correction = correctedRotations[team.id];
    return correction ? { ...team, rotation: correction } : team;
  }

  function getFeedback(teamId: string): TeamFeedback {
    return feedbackFor(feedback, teamId);
  }

  // Every mutator reads its "current" value from `prev` inside the updater, never from the
  // outer `feedback` closure — two of these firing back-to-back before a re-render must not
  // silently drop one of them.
  function patchFeedback(teamId: string, patch: Partial<TeamFeedback>) {
    setFeedback((prev) => ({ ...prev, [teamId]: { ...feedbackFor(prev, teamId), ...patch } }));
  }

  // One reaction per rostered player, set directly on their row — see FeedbackToggle's docstring
  // for why this replaced the old add-a-row/pick-a-player/pick-a-direction flow.
  function setPlayerFeedback(teamId: string, playerId: string, entry: FeedbackEntry | undefined) {
    setFeedback((prev) => {
      const current = feedbackFor(prev, teamId);
      const notes = { ...current.playerNotes };
      if (entry) notes[playerId] = entry;
      else delete notes[playerId];
      return { ...prev, [teamId]: { ...current, playerNotes: notes } };
    });
  }

  if (showBrowser) {
    return (
      <Suspense fallback={<div className="loading-panel"><p>Loading player data…</p></div>}>
        <DraftPoolBrowser mode={mode} onBack={() => setShowBrowser(false)} />
      </Suspense>
    );
  }

  return (
    // 2026-08-16, user's own ask: same fixed-dark broadcast board as the Draft screen — see the
    // `.at-shell` token-aliasing comment in App.css for how the rest of this file's existing
    // classes (never touched here) pick up the dark palette just by being nested inside this.
    <div className="results-screen at-shell">
      <h2>Final Power Ranking</h2>
      <button className="secondary-btn" onClick={() => setShowBrowser(true)}>
        Przeglądaj wszystkich graczy
      </button>
      <div className="left-on-board">
        <strong>Zostali na boardzie (top wg TAL)</strong>
        <ul>
          {leftOnBoard.slice(0, 20).map((p) => (
            <li key={p.playerName}>
              {p.playerName} ({p.spanLabel}) — {p.primaryPosition}, TAL {p.TAL}
            </li>
          ))}
        </ul>
      </div>
      <div className="expand-all-controls">
        <button className="secondary-btn" onClick={() => setExpandedTeamIds(new Set(teams.map((t) => t.id)))}>
          Rozwiń wszystkie
        </button>
        <button
          className="secondary-btn"
          onClick={() => setExpandedTeamIds(new Set(teams.filter((t) => t.isHuman).map((t) => t.id)))}
        >
          Zwiń wszystkie
        </button>
      </div>
      {ranked.map(({ team, breakdown, rank }) => {
        const shownTeam = displayTeam(team);
        const assignments = allAssignments(shownTeam);
        const starterKeys = new Set(primaryStarters(shownTeam).map((entry) => `${entry.slot}|${entry.player.id}`));
        const bench = benchWithMinutes(shownTeam);
        const netRating = projectedNetRating(shownTeam);
        const leagueEvalRow = leagueEvalByTeamId.get(team.id);
        const teamHistory = history.filter((h) => h.teamId === team.id).sort((a, b) => a.pickNumber - b.pickNumber);
        const fb = getFeedback(team.id);
        const isEditingRotation = editingRotationTeamId === team.id;
        const isExpanded = expandedTeamIds.has(team.id);
        const fitDetail = isExpanded ? fitScore(shownTeam) : null;
        const huntability = isExpanded ? defensiveHuntability(shownTeam) : null;
        const totalFga = team.roster.reduce((sum, p) => sum + p.fga, 0);
        // 2026-08-15: Strengths/Concerns text now comes from the deterministic insight engine
        // (insights.ts + insightMapper.ts) instead of the old `breakdown.notes` split +
        // `syntheticLowScoreConcerns` catch-all — see insights.ts's own docstring for why. The
        // actual SCORE (`breakdown`/`overall`/etc.) is untouched; this only replaces the prose.
        // Only computed for expanded teams (the notes panel is the one thing that reads it) —
        // `buildTeamFeatureSnapshot` does real per-starter pool scans, not free enough to run
        // unconditionally for all `ranked.length` teams on every render.
        const insights = isExpanded ? generateRosterInsights(buildTeamFeatureSnapshot(shownTeam)) : null;
        return (
          <div key={team.id} className={`team-result rank-${rank} ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}>
            <button className="team-result-header" onClick={() => toggleExpanded(team.id)} aria-expanded={isExpanded}>
              <span className="team-result-toggle">{isExpanded ? '▾' : '▸'}</span>
              <span className="team-result-title">
                #{rank} — {teamLabel(team)} {team.isHuman ? '(You)' : ''}
              </span>
              <ScoreChip label="Overall" value={breakdown.overall} />
              {!isExpanded && (
                <span className="team-result-header-mini">
                  <ScoreChip label="TAL" value={breakdown.talentScore} />
                  <ScoreChip label="OFF" value={breakdown.offenseScore} />
                  <ScoreChip label="DEF" value={breakdown.defenseScore} />
                  {leagueEvalRow && (
                    <span className="mini-fact">🏆 {(leagueEvalRow.championshipProbability * 100).toFixed(1)}%</span>
                  )}
                </span>
              )}
            </button>
            {isExpanded && (
              <div className="team-result-body">
                <div className="subscores">
                  <ScoreChip label="Talent" value={breakdown.talentScore} />
                  <ScoreChip label="Bench Depth" value={breakdown.benchDepthScore} />
                  <ScoreChip label="Offense" value={breakdown.offenseScore} />
                  <ScoreChip label="Defense" value={breakdown.defenseScore} />
                  <ScoreChip label="Spacing" value={breakdown.spacingScore} />
                  <ScoreChip label="Fit" value={breakdown.fitScore} />
                  <ScoreChip label="Rotation" value={breakdown.rotationScore} />
                  <span className="fga-spent">FGA spent: {totalFga.toFixed(1)} / 100.9</span>
                </div>
                {fitDetail && (
                  <div className="fit-v2-shadow-panel">
                    <span className="fit-v2-shadow-label">Fit breakdown</span>
                    <span>Creation {fitDetail.components.creationStructure}</span>
                    <span>Spacing compatibility {fitDetail.components.spacingCompatibility}</span>
                    <span>Defensive roles {fitDetail.components.defensiveRoleCoverage}</span>
                    <span>Switchability {fitDetail.inputs.switchability}</span>
                    <span>Rebounding {fitDetail.components.reboundingBalance}</span>
                    <span>Functional size {fitDetail.components.sizeCoverage}</span>
                    <span className="fit-v2-shadow-detail">
                      Defense: POA {fitDetail.inputs.guardContainmentProvider ?? '—'} {Math.round(fitDetail.inputs.guardContainment)}
                      {!fitDetail.inputs.guardContainmentConfirmed && ' (inferred)'}
                      {' · '}wing {fitDetail.inputs.wingCoverageProvider ?? '—'} {Math.round(fitDetail.inputs.wingCoverage)}
                      {!fitDetail.inputs.wingCoverageConfirmed && ' (inferred)'}
                      {' · '}rim {fitDetail.inputs.rimProtectionProvider ?? '—'} {Math.round(fitDetail.inputs.rimProtection)}
                      {!fitDetail.inputs.rimProtectionConfirmed && ' (inferred)'}
                      {' · '}weak link {fitDetail.inputs.defensiveWeakLinkPlayer ?? '—'} {Math.round(fitDetail.inputs.defensiveWeakLinkResistance)}
                    </span>
                    {huntability && huntability.offenders.length > 0 && (
                      <span className="fit-v2-shadow-detail">
                        Weak-link targets: {huntability.offenders.slice(0, 4).map((offender) =>
                          `${offender.playerName} D${offender.defensiveTalent}/${offender.minutes}m`,
                        ).join(' · ')}
                      </span>
                    )}
                    <span className="fit-v2-shadow-detail">
                      Size inputs: height {Math.round(fitDetail.inputs.positionAdjustedHeightPercentile ?? 50)}
                      {' · '}strength {Math.round(fitDetail.inputs.positionAdjustedWeightPercentile ?? 50)}
                      {' · '}athleticism {Math.round(fitDetail.inputs.positionAdjustedAthleticismPercentile ?? 50)}
                      {' · '}rebounding {Math.round(fitDetail.inputs.positionAdjustedReboundingPercentile)}
                    </span>
                  </div>
                )}
                <div
                  className="subscores net-rating-projection"
                  title="Real-NBA-units estimate (points per 100 possessions), fitted against 865 real 1997-2026 team-seasons — a different, informational question from the 0-100 scores above, not a replacement for them."
                >
                  <span>
                    Projected NBA net rating: {netRating.net >= 0 ? '+' : ''}
                    {netRating.net.toFixed(1)}
                  </span>
                  <span>
                    (ORTG {netRating.offense.toFixed(1)} / DRTG {netRating.defense.toFixed(1)})
                  </span>
                </div>
                {leagueEvalRow && (
                  <div
                    className="subscores net-rating-projection"
                    title="Best-of-7 series odds against each of the other 15 rosters, and championship probability from a 20,000-run single-elimination bracket simulation seeded by Final Power Ranking."
                  >
                    <span>Championship odds: {(leagueEvalRow.championshipProbability * 100).toFixed(1)}%</span>
                    <span>Avg series win prob: {(leagueEvalRow.avgSeriesWinProb * 100).toFixed(0)}%</span>
                    <span>
                      Best matchup: vs {teamLabel(teamById(leagueEvalRow.bestMatchup.opponentId)!)} (
                      {(leagueEvalRow.bestMatchup.seriesWinProb * 100).toFixed(0)}%)
                    </span>
                    <span>
                      Worst matchup: vs {teamLabel(teamById(leagueEvalRow.worstMatchup.opponentId)!)} (
                      {(leagueEvalRow.worstMatchup.seriesWinProb * 100).toFixed(0)}%)
                    </span>
                  </div>
                )}
                {isEditingRotation ? (
                  <RotationBuilder
                    roster={team.roster}
                    initialRotation={correctedRotations[team.id] ?? team.rotation}
                    onConfirm={(rotation) => {
                      setCorrectedRotations((prev) => ({ ...prev, [team.id]: rotation }));
                      setEditingRotationTeamId(null);
                    }}
                    onCancel={() => setEditingRotationTeamId(null)}
                  />
                ) : (
                  <button className="secondary-btn" onClick={() => setEditingRotationTeamId(team.id)}>
                    {correctedRotations[team.id] ? '✏️ Edit corrected rotation' : '✏️ Correct rotation'}
                  </button>
                )}
                <div className="lineup">
                  <div>
                    <strong>Rotation</strong>
                    <ul className="rotation-slot-groups">
                      {STARTER_SLOTS.map((slot) => {
                        const entries = assignments
                          .filter((a) => a.slot === slot)
                          .sort((a, b) => {
                            const aIsStarter = starterKeys.has(`${a.slot}|${a.player.id}`);
                            const bIsStarter = starterKeys.has(`${b.slot}|${b.player.id}`);
                            if (aIsStarter !== bIsStarter) return aIsStarter ? -1 : 1;
                            return b.minutes - a.minutes;
                          });
                        return (
                          <li key={slot} className="rotation-slot-group">
                            <span className="rotation-slot-label">{slot}</span>
                            <ul className="rotation-slot-entries">
                              {entries.map((e) => (
                                <li key={e.player.id} className="player-row">
                                  <span className="player-row-name at-name-tip" tabIndex={0} data-tip={pickStatTip(e.player)}>
                                    {e.player.playerName} ({e.player.spanLabel}) [{spanPositionTag(e.player)}]
                                    {starterKeys.has(`${e.slot}|${e.player.id}`) && <span className="starter-badge">Starter</span>}
                                  </span>
                                  <span className="player-row-meta">
                                    <span className="mini-fact">{e.minutes} min</span>
                                    <span className="mini-fact">FGA {e.player.fga.toFixed(1)}</span>
                                    {/* 2026-08-19, user's explicit ask: a bare "TAL 97" chip is one
                                        number with no sense of what it means — post-draft (the pick
                                        is already locked in, nothing left to spoil), pairing it with
                                        the same named tier the draft screens use gives the number
                                        real context instead of asking the player to already know
                                        this game's own internal scale. */}
                                    <OverallTierBadge span={e.player} />
                                    <ScoreChip label="TAL" value={displayTalentForSpan(tierContextFor(e.player))} />
                                  </span>
                                  <FeedbackToggle
                                    entry={fb.playerNotes[e.player.id]}
                                    onChange={(entry) => setPlayerFeedback(team.id, e.player.id, entry)}
                                    placeholder="Co jest nie tak z tym graczem?"
                                  />
                                </li>
                              ))}
                            </ul>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div>
                    <strong>Bench</strong>
                    <ul className="rotation-slot-entries">
                      {bench.map(({ player, minutes }) => (
                        <li key={player.id} className="player-row">
                          <span className="player-row-name at-name-tip" tabIndex={0} data-tip={pickStatTip(player)}>
                            {player.playerName} ({player.spanLabel}) [{spanPositionTag(player)}]
                          </span>
                          <span className="player-row-meta">
                            <span className="mini-fact">{minutes} min</span>
                            <span className="mini-fact">FGA {player.fga.toFixed(1)}</span>
                            <OverallTierBadge span={player} />
                            <ScoreChip label="TAL" value={displayTalentForSpan(tierContextFor(player))} />
                          </span>
                          <FeedbackToggle
                            entry={fb.playerNotes[player.id]}
                            onChange={(entry) => setPlayerFeedback(team.id, player.id, entry)}
                            placeholder="Co jest nie tak z tym graczem?"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                {insights && (
                  <div className="notes notes-split">
                    <div className="notes-column notes-strengths">
                      <strong>✓ Strengths</strong>
                      <ul>
                        {insights.strengths.map((insight) => (
                          <li key={insight.id}>{insight.message}</li>
                        ))}
                      </ul>
                    </div>
                    {insights.concerns.length > 0 && (
                      <div className="notes-column notes-concerns">
                        <strong>⚠ Concerns</strong>
                        <ul>
                          {insights.concerns.map((insight) => (
                            <li key={insight.id}>{insight.message}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                <div className="draft-order">
                  <strong>Draft Order</strong>
                  <ol>
                    {teamHistory.map((entry) => {
                      const p = playerById(entry.playerId);
                      return (
                        <li key={entry.pickNumber}>
                          <span className="history-pick">#{entry.pickNumber}</span> {p ? `${p.playerName} (${p.spanLabel})` : entry.playerId}
                        </li>
                      );
                    })}
                  </ol>
                </div>
                <div className="team-feedback">
                  <strong>Feedback</strong>

                  <p className="player-notes-hint">Konkretni gracze: kliknij ✓/✗ przy graczu w Rotation/Bench powyżej.</p>

                  <div className="feedback-field">
                    <label>Uwagi do rotacji</label>
                    <textarea
                      className="feedback-textarea"
                      rows={2}
                      placeholder="Np. kto powinien grać więcej/mniej minut..."
                      value={fb.rotationNote}
                      onChange={(e) => patchFeedback(team.id, { rotationNote: e.target.value })}
                    />
                  </div>

                  <div className="feedback-field">
                    <label>Inne uwagi</label>
                    <textarea
                      className="feedback-textarea"
                      rows={2}
                      placeholder="Cokolwiek innego..."
                      value={fb.otherNote}
                      onChange={(e) => patchFeedback(team.id, { otherNote: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="user-power-ranking">
        <h3>Twój własny ranking (1-16)</h3>
        <p className="player-notes-hint">Twoja ocena miejsca każdej drużyny — porównywana obok rankingu algorytmu.</p>
        {ranked.map(({ team, rank }) => {
          const fb = getFeedback(team.id);
          const disagrees = fb.userRank !== '' && Number(fb.userRank) !== rank;
          return (
            <div key={team.id} className="user-power-ranking-row">
              <span className="user-power-ranking-label">
                #{rank} — {teamLabel(team)} {team.isHuman ? '(You)' : ''}
              </span>
              <input
                type="number"
                min={1}
                max={16}
                className="user-rank-input"
                value={fb.userRank}
                onChange={(e) => {
                  const value = e.target.value;
                  // Same "clear the stale reason" logic the old yes/no dropdown had — a reason
                  // typed for a previous disagreement shouldn't survive into the export once the
                  // user's own number matches the algorithm's again (or is cleared).
                  const stillDisagrees = value !== '' && Number(value) !== rank;
                  patchFeedback(team.id, { userRank: value, rankingNote: stillDisagrees ? fb.rankingNote : '' });
                }}
              />
              {fb.userRank !== '' && (
                <span className="user-rank-hint">{disagrees ? `(algorytm: #${rank})` : '(zgadza się z algorytmem)'}</span>
              )}
              {disagrees && (
                <textarea
                  className="feedback-textarea"
                  rows={2}
                  placeholder="Dlaczego Twoja kolejność jest inna?"
                  value={fb.rankingNote}
                  onChange={(e) => patchFeedback(team.id, { rankingNote: e.target.value })}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="results-actions">
        <button className="primary-btn" onClick={onRestart}>
          Draft Again
        </button>
        <button
          className="secondary-btn"
          onClick={() => downloadFeedback(teams, history, feedback, pickReactions, pickReasoning, correctedRotations)}
        >
          Zapisz feedback do pliku
        </button>
      </div>
    </div>
  );
}
