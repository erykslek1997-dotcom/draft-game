import { useMemo, useState } from 'react';
import { rankTeams, offenseScoreBreakdown } from '../engine/scoring';
import { evaluateLeague } from '../engine/leagueSimulation';
import { simulateSeason, type SeasonStandingsRow } from '../engine/seasonSimulation';
import { simulatePlayoffs, type PlayoffResult, type PlayoffSeriesResult } from '../engine/playoffSimulation';
import { STARTER_SLOTS, CAP_LIMIT } from '../engine/positions';
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
import { explainMatchup } from '../engine/matchupExplanation';
import { seasonProfile } from '../engine/seasonProfile';
import { buildTeamFeatureSnapshot } from '../engine/insightMapper';
import { type FeedbackEntry } from './FeedbackToggle';
// 2026-08-16, user's own ask ("dodasz to też na ostatni ekran ocen?"): reuses the exact same
// hover-stats popover the Overview grid's own drafted-pick cells already have (DraftBoard.tsx) —
// safe to import directly (not lazy) since GameShell already bundles DraftBoard and this file
// together as siblings, so nothing about the app's existing load-time split changes.
import { pickStatTip } from './DraftBoard';
import HistoricalChallengesPanel from './HistoricalChallengesPanel';
import MatchupMatrix from './MatchupMatrix';
import WhatIfPanel from './WhatIfPanel';

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
/** Compact the year range in dense rotation rows while keeping the full span in the hover tip. */
function compactSpanLabel(label: string): string {
  return label.replace(/\((\d{4})-(\d{2})\)/, (_, start: string, end: string) => `(${start.slice(2)}-${end})`);
}

function compactPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const first = parts[0];
  const initial = first.includes('.') ? first : `${first[0]}.`;
  return `${initial} ${parts.slice(1).join(' ')}`;
}

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

/** 2026-09-09: the "correct any team's rotation from the results screen" feature (a reused
 * `RotationBuilder`) is no longer wired in — `correctedRotations` is always empty. Kept as a
 * single module-level stable reference so the `scoredTeams` `useMemo` below actually memoizes:
 * previously it was `const correctedRotations = {}` inside the component body, a fresh object
 * every render, which busted `scoredTeams` → `leagueEval` (`evaluateLeague`, ~1.5s) on every
 * re-render (feedback keystroke, accordion toggle, season-sim click). The dead export fields
 * (`correctedRotation`/`correctedBench`/`rotationWasCorrected`) stay so the feedback JSON schema
 * is unchanged. */
const EMPTY_CORRECTED_ROTATIONS: Record<string, Rotation> = {};

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

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th" — plain English ordinal for the finish-position line. */
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

/**
 * 2026-09-09, user-reported ("końcowy screen wygląda średnio"): the results screen opened straight
 * into a plain `<h2>Final team ranking</h2>` and 16 identical accordion cards, so the one thing a
 * player actually came back to see — how their own roster did — had no more visual weight than the
 * CPU teams. This is the payoff line: finish position out of 16, the Final Power Ranking Overall
 * (the single number every team is judged by, kept dominant here), the simulated title odds (now
 * consistent with that ranking after the 2026-09-09 matchup fix), and the roster's own one-line
 * identity + honest failure mode straight from `fitScore`'s archetype report.
 */
function HeroResult({
  teamName,
  isHuman,
  rank,
  fieldSize,
  overall,
  titleOdds,
  identity,
  failureMode,
}: {
  teamName: string;
  isHuman: boolean;
  rank: number;
  fieldSize: number;
  overall: number;
  titleOdds: number | null;
  identity: string | null;
  failureMode: string | null;
}) {
  return (
    <header className="results-hero">
      <div className="results-hero-finish">
        <span className="results-hero-eyebrow">{isHuman ? 'You finished' : 'Top of the field'}</span>
        <span className="results-hero-rank">
          <b>{ordinal(rank)}</b>
          <i>/ {fieldSize}</i>
        </span>
        <span className="results-hero-team">{teamName}</span>
      </div>
      <div className="results-hero-stats">
        <div className={`results-hero-stat results-hero-overall score-t${scoreBand(overall)}`}>
          <span className="results-hero-stat-label">Final Power Ranking</span>
          <span className="results-hero-stat-value">{overall}</span>
        </div>
        {titleOdds !== null && (
          <div className="results-hero-stat">
            <span className="results-hero-stat-label">Title odds</span>
            <span className="results-hero-stat-value">{(titleOdds * 100).toFixed(titleOdds >= 0.1 ? 0 : 1)}%</span>
          </div>
        )}
      </div>
      {(identity || failureMode) && (
        <p className="results-hero-identity">
          {identity && <b>{identity}</b>}
          {identity && failureMode && ' — '}
          {failureMode && <span>{failureMode}</span>}
        </p>
      )}
    </header>
  );
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  return (
    <span className={`score-chip score-t${scoreBand(value)}`}>
      <span className="score-chip-label">{label}</span>
      <span className="score-chip-value">{value}</span>
    </span>
  );
}

/** A labelled 0-100 bar for the Team-analysis profile row — a fill proportional to the value,
 * tinted by the same band ladder the score chips use, so a weak axis is a short red bar and a
 * strong one a long green bar without the reader parsing 8 numbers. */
function MetricBar({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="metric-bar" title={hint}>
      <span className="metric-bar-label">{label}</span>
      <span className="metric-bar-track">
        <span className={`metric-bar-fill metric-t${scoreBand(v)}`} style={{ width: `${v}%` }} />
      </span>
      <span className="metric-bar-value">{v}</span>
    </div>
  );
}

function feedbackFor(record: Record<string, TeamFeedback>, teamId: string): TeamFeedback {
  return record[teamId] ?? EMPTY_FEEDBACK;
}

/**
 * 2026-08-19, user's own ask ("can you make playoff bracket like that?", a CBS Sports-style
 * two-side bracket screenshot): the flat per-round text list this replaces worked, but didn't
 * read as a bracket. This app's `playoffSimulation.ts` has no conference concept — one undivided
 * 16-team bracket — so rather than inventing a fake East/West split, this reuses the bracket's
 * OWN existing structure: `SEED_ORDER_16` already keeps seed 1 and seed 2 on opposite halves so
 * they can only meet in the Finals (see leagueSimulation.ts's own docstring on that array) — the
 * first 8 First Round entries are already "one side," the last 8 are already "the other." That
 * split is used here purely as a LAYOUT choice (left half / right half converging to a center
 * Finals), with no East/West labels, since it isn't a real conference.
 *
 * Positioned with plain pixel math (not CSS Grid/Flexbox auto-layout) specifically so the
 * connector lines are guaranteed to meet each match at its exact center — every card and every
 * line segment is computed from the SAME row/column formulas, so they can't disagree the way a
 * CSS-layout-driven card + a separately-hand-tuned connector overlay could. `LEAF_COUNT` (4) is
 * this app's real bracket depth (16 teams -> First Round has 4 matches per side); the row-doubling
 * math generalizes correctly for any power-of-two leaf count if that ever changes, so nothing here
 * hardcodes "4" beyond this one constant.
 *
 * Not verified live in the browser (per explicit user instruction not to touch the shared
 * dev-session tab) — logic double-checked against the known bracket structure (SEED_ORDER_16
 * pairs, round sizes 8/4/2/1) and kept deliberately simple pixel arithmetic rather than anything
 * relying on runtime-measured layout, but a first look from the user is still the real check.
 */
const BRACKET_CARD_W = 176;
const BRACKET_CARD_H = 46;
const BRACKET_ROW_UNIT = 58;
const BRACKET_COL_GAP = 48;
const BRACKET_COL_W = BRACKET_CARD_W + BRACKET_COL_GAP;
const BRACKET_LEAF_COUNT = 4; // First Round matches per side (16 teams / 2 sides / 2 teams-per-match)
const BRACKET_ROUNDS_PER_SIDE = 3; // First Round, Quarterfinals, Semifinals (Finals is the shared center column)
const BRACKET_HEIGHT = BRACKET_LEAF_COUNT * BRACKET_ROW_UNIT;
const BRACKET_WIDTH = (2 * BRACKET_ROUNDS_PER_SIDE) * BRACKET_COL_W + BRACKET_CARD_W;

/** Vertical center of match `indexInRound` within a round whose matches each span `2^round`
 * leaf-slots — round 0 (First Round) matches occupy exactly 1 slot each, round 1 (Quarterfinals)
 * 2 slots, round 2 (Semifinals) all 4. A match's center is always exactly the midpoint of the two
 * matches that feed it, by construction of this doubling — no separate "connector midpoint" math
 * needed beyond reusing this same function one round up. */
function bracketMatchCenterY(round: number, indexInRound: number): number {
  const rowSpan = 2 ** round;
  return (indexInRound * rowSpan + rowSpan / 2) * BRACKET_ROW_UNIT;
}

/** Left edge x-position for a match card. `mirrored` (the right-side bracket) counts rounds in
 * from the far right instead of the far left, so Semifinals sit nearest the center Finals column
 * on both sides and First Round sits on the outside edge on both sides — the actual visual shape
 * a bracket is supposed to have. */
function bracketMatchX(round: number, mirrored: boolean): number {
  return mirrored
    ? BRACKET_WIDTH - BRACKET_CARD_W - round * BRACKET_COL_W
    : round * BRACKET_COL_W;
}

interface BracketTeamRowProps {
  team: Team | undefined;
  seed: number;
  isWinner: boolean;
}

function BracketTeamRow({ team, seed, isWinner }: BracketTeamRowProps) {
  if (!team) return null;
  return (
    <div className={`bracket-team-row ${isWinner ? 'bracket-team-winner' : ''}`}>
      <span className="bracket-seed">#{seed}</span>
      <span className="bracket-team-name">
        {teamLabel(team)}
        {team.isHuman && <span className="bracket-you-tag">YOU</span>}
      </span>
    </div>
  );
}

function PlayoffBracketTree({ result, teamById }: { result: PlayoffResult; teamById: (id: string) => Team | undefined }) {
  const firstRound = result.rounds[0]; // 8 series: [0-3] left side, [4-7] right side
  const quarterfinals = result.rounds[1]; // 4 series: [0-1] left, [2-3] right
  const semifinals = result.rounds[2]; // 2 series: [0] left, [1] right
  const finals = result.rounds[3]?.[0];
  if (!finals) return null;

  const sides: { mirrored: boolean; rounds: PlayoffSeriesResult[][] }[] = [
    { mirrored: false, rounds: [firstRound.slice(0, 4), quarterfinals.slice(0, 2), semifinals.slice(0, 1)] },
    { mirrored: true, rounds: [firstRound.slice(4, 8), quarterfinals.slice(2, 4), semifinals.slice(1, 2)] },
  ];

  const cards: { x: number; y: number; series: PlayoffSeriesResult }[] = [];
  const connectors: { key: string; d: string }[] = [];

  for (const { mirrored, rounds } of sides) {
    rounds.forEach((matches, round) => {
      matches.forEach((series, indexInRound) => {
        const x = bracketMatchX(round, mirrored);
        const y = bracketMatchCenterY(round, indexInRound);
        cards.push({ x, y, series });
      });
      // Connectors from this round's matches to the NEXT round's matches (Semifinals connect to
      // the shared Finals card separately, below, since that's a special single shared target).
      if (round < BRACKET_ROUNDS_PER_SIDE - 1) {
        const cardRightX = mirrored ? bracketMatchX(round, true) : bracketMatchX(round, false) + BRACKET_CARD_W;
        const nextLeftX = mirrored ? bracketMatchX(round + 1, true) + BRACKET_CARD_W : bracketMatchX(round + 1, false);
        const midX = (cardRightX + nextLeftX) / 2;
        for (let i = 0; i + 1 < matches.length; i += 2) {
          const yTop = bracketMatchCenterY(round, i);
          const yBottom = bracketMatchCenterY(round, i + 1);
          const yMid = bracketMatchCenterY(round + 1, i / 2);
          connectors.push({
            key: `${mirrored}-${round}-${i}`,
            d: `M${cardRightX},${yTop} H${midX} M${cardRightX},${yBottom} H${midX} M${midX},${yTop} V${yBottom} M${midX},${yMid} H${nextLeftX}`,
          });
        }
      }
    });
  }

  // Semifinal -> Finals connectors: both Semifinal winners already sit at the vertical center
  // (BRACKET_HEIGHT / 2, since each spans the full 4-slot height of its own side) — same
  // center-Y the Finals card itself uses, so these are simple straight horizontal lines, no
  // elbow needed.
  const finalsX = BRACKET_WIDTH / 2 - BRACKET_CARD_W / 2;
  const finalsY = BRACKET_HEIGHT / 2;
  const leftSfRightX = bracketMatchX(2, false) + BRACKET_CARD_W;
  const rightSfLeftX = bracketMatchX(2, true);
  connectors.push({ key: 'left-final', d: `M${leftSfRightX},${finalsY} H${finalsX}` });
  connectors.push({ key: 'right-final', d: `M${rightSfLeftX},${finalsY} H${finalsX + BRACKET_CARD_W}` });
  cards.push({ x: finalsX, y: finalsY, series: finals });

  const champion = teamById(result.championId);

  return (
    <div className="bracket-scroll">
      <div className="bracket-tree" style={{ width: BRACKET_WIDTH, height: BRACKET_HEIGHT + BRACKET_CARD_H }}>
        <svg
          className="bracket-lines"
          width={BRACKET_WIDTH}
          height={BRACKET_HEIGHT + BRACKET_CARD_H}
          viewBox={`0 0 ${BRACKET_WIDTH} ${BRACKET_HEIGHT + BRACKET_CARD_H}`}
        >
          {connectors.map((c) => (
            <path key={c.key} d={c.d} className="bracket-line" />
          ))}
        </svg>
        {cards.map(({ x, y, series }) => {
          const teamA = teamById(series.teamAId);
          const teamB = teamById(series.teamBId);
          const higherTally = Math.max(series.gamesWonA, series.gamesWonB);
          const lowerTally = Math.min(series.gamesWonA, series.gamesWonB);
          return (
            <div
              key={`${series.teamAId}-${series.teamBId}`}
              className="bracket-match"
              style={{ left: x, top: y - BRACKET_CARD_H / 2, width: BRACKET_CARD_W, height: BRACKET_CARD_H }}
              title={series.roundLabel}
            >
              <BracketTeamRow team={teamA} seed={series.teamASeed} isWinner={series.winnerId === series.teamAId} />
              <BracketTeamRow team={teamB} seed={series.teamBSeed} isWinner={series.winnerId === series.teamBId} />
              <span className="bracket-score">
                {higherTally}-{lowerTally}
              </span>
            </div>
          );
        })}
      </div>
      {champion && (
        <p className="playoff-champion">
          🏆 Champion: {teamLabel(champion)} {champion.isHuman ? '(You)' : ''}
        </p>
      )}
    </div>
  );
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
export function buildRotationExport(team: Team) {
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

export function buildFeedbackExport(
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
      const fb = feedbackFor(feedback, team.id);
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

export function downloadFeedback(
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

export default function ResultsScreen({ teams, history, onRestart }: Props) {
  // Lookups used inside render loops (matchup opponents, draft-order rows, the bracket tree) —
  // Maps, not repeated `.find` over `teams` / the 9451-span `draftPool`.
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const teamById = (id: string) => teamsById.get(id);
  const draftPoolById = useMemo(() => new Map(draftPool.map((p) => [p.id, p])), []);
  const playerById = (id: string) => draftPoolById.get(id);
  const leftOnBoard = useMemo(() => remainingOnBoard(teams), [teams]);
  // 2026-08-08, user's explicit ask: correct ANY team's rotation from this screen — no longer
  // wired in; `EMPTY_CORRECTED_ROTATIONS` is a stable module-level reference (see its docstring
  // for the perf reason). The `displayTeam` / `scoredTeams` plumbing stays so re-wiring a
  // corrector later is a one-line change, and the feedback-export schema is unchanged.
  const correctedRotations = EMPTY_CORRECTED_ROTATIONS;
  // 2026-08-19, user's own idea ("PR works as it works, but user can simulate 82 game season"):
  // one randomly-rolled 82-game season standings table, completely separate from the Final Power
  // Ranking above (`ranked`, still what `overall`/rank is judged by — untouched by this). `null`
  // until the button below is clicked; re-clicking re-rolls a fresh season rather than averaging.
  const [seasonStandings, setSeasonStandings] = useState<SeasonStandingsRow[] | null>(null);
  // 2026-08-19, same-day follow-up ("can we add playoffs?"): seeded by `seasonStandings` above,
  // not the Final Power Ranking — confirmed via AskUserQuestion before building. Cleared whenever
  // a new season is rolled (a bracket seeded by a now-replaced season's standings is stale), but
  // NOT cleared by re-simulating the playoffs alone from the same season — that's a real, expected
  // "same season, roll the playoffs again" use case.
  const [playoffResult, setPlayoffResult] = useState<PlayoffResult | null>(null);
  // 2026-08-14, results-screen redesign: 16 full team cards on one page was the single biggest
  // usability complaint (scrolling past 15 opponents to see your own team) — every card starts
  // collapsed to a one-line summary. 2026-09-09: the human's card starts collapsed too now that
  // the hero header above carries the finish/Overall/identity payoff — the card is just the
  // drill-down (rotation, analysis, matchups) and doesn't need to be open before the player asks.
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(() => new Set<string>());
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
  // `rankTeams` is `scoreTeam ×16` (~400ms) — memoized on the same `scoredTeams` identity as the
  // sim below so a feedback keystroke or accordion toggle doesn't re-score the whole field.
  // (During local calibration a scoring.ts HMR edit won't refresh this without a hard reload —
  // acceptable; the sim below already had the same property.)
  const ranked = useMemo(() => rankTeams(scoredTeams), [scoredTeams]);
  // Monte Carlo bracket sim (20,000 runs) is expensive, so it reruns only when the draft teams or
  // a saved rotation correction actually change — not when feedback text or expansion state does.
  // The results screen should become interactive quickly after Skip to Results. The matchup
  // matrix is descriptive, so a compact roll count is enough for whole-percent odds while
  // avoiding a long main-thread pause from the engine's full calibration default.
  const leagueEval = useMemo(() => evaluateLeague(scoredTeams, 500), [scoredTeams]);
  const leagueEvalByTeamId = useMemo(() => new Map(leagueEval.map((entry) => [entry.teamId, entry])), [leagueEval]);
  // Fed into the season / playoff sims so a re-roll doesn't re-score all 16 teams (they blend
  // `overall` into each game's margin — see `projectMatchup`'s `OVERALL_MARGIN_WEIGHT`).
  const overallByTeamId = useMemo(
    () => new Map(ranked.map(({ team, breakdown }) => [team.id, breakdown.overall])),
    [ranked],
  );

  // The one roster this screen exists to show off — the player's own, or (a defensive fallback for
  // a no-human commissioner draft) the Final Power Ranking's #1. Drives the hero header below.
  const heroRanked = ranked.find(({ team }) => team.isHuman) ?? ranked[0];
  const heroFit = useMemo(
    () => (heroRanked ? fitScore(displayTeam(heroRanked.team)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heroRanked?.team.id, scoredTeams],
  );
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

  return (
    // 2026-08-16, user's own ask: same fixed-dark broadcast board as the Draft screen — see the
    // `.at-shell` token-aliasing comment in App.css for how the rest of this file's existing
    // classes (never touched here) pick up the dark palette just by being nested inside this.
    <div className="results-screen at-shell">
      {heroRanked && (
        <HeroResult
          teamName={heroRanked.team.name}
          isHuman={heroRanked.team.isHuman}
          rank={heroRanked.rank}
          fieldSize={ranked.length}
          overall={heroRanked.breakdown.overall}
          titleOdds={leagueEvalByTeamId.get(heroRanked.team.id)?.championshipProbability ?? null}
          identity={
            heroFit?.inputs.primaryArchetype
              ? heroFit.inputs.primaryArchetype +
                (heroFit.inputs.secondaryArchetype ? ` + ${heroFit.inputs.secondaryArchetype}` : '')
              : null
          }
          failureMode={heroFit?.inputs.archetypeReport?.failureMode ?? null}
        />
      )}
      <h2 className="results-section-title">Final team ranking</h2>
      <MatchupMatrix teams={scoredTeams} evaluations={leagueEval} focusTeamId={scoredTeams.find((team) => team.isHuman)?.id} />
      {/* 2026-08-19, user's own idea: the Final Power Ranking above stays exactly what it always
          was — this is a separate, just-for-fun roll of one randomly-simulated 82-game regular
          season, game by game, using the same real per-game win probability model the Championship
          bracket sim below already relies on (see seasonSimulation.ts's own docstring). Re-clicking
          re-rolls a brand new season rather than averaging toward an "expected" record — the user's
          explicit choice over a many-seasons-averaged projection. */}
      <div className="season-sim-panel">
        <h3>Simulate an 82-game season</h3>
        <p className="player-notes-hint">
          Rolls one full regular season, game by game, using each pairing's real projected win probability. Separate from
          the Final Power Ranking above.
        </p>
        {/* 2026-08-19, user's explicit ask ("delate resimulation button for regular season and
            playoffs"): once rolled, that's the season — no re-roll button once a result exists,
            for either this or the playoff button below. */}
        {!seasonStandings && (
          <button
            className="secondary-btn"
            onClick={() => {
              setSeasonStandings(simulateSeason(scoredTeams, overallByTeamId));
              setPlayoffResult(null);
            }}
          >
            🏀 Simulate an 82-game season
          </button>
        )}
        {seasonStandings && (
          <>
            <table className="at-roster-table season-standings-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th>W</th>
                  <th>L</th>
                  <th>Win%</th>
                </tr>
              </thead>
              <tbody>
                {seasonStandings.map((row) => {
                  const rowTeam = teamById(row.teamId);
                  if (!rowTeam) return null;
                  return (
                    <tr key={row.teamId} className={rowTeam.isHuman ? 'season-standings-you' : ''}>
                      <td>{row.rank}</td>
                      <td>
                        {teamLabel(rowTeam)} {rowTeam.isHuman ? '(You)' : ''}
                      </td>
                      <td>{row.wins}</td>
                      <td>{row.losses}</td>
                      <td>{(row.winPct * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* 2026-08-19, same-day follow-up: seeded by the standings above, not the Final Power
                Ranking — every series is genuinely played out game by game (real BO7 tallies like
                "4-2"), not a single probability draw. Re-clicking re-rolls the playoffs alone,
                keeping the same season standings as the seed. */}
            {!playoffResult && (
              <button
                className="secondary-btn playoff-sim-btn"
                onClick={() => setPlayoffResult(simulatePlayoffs(scoredTeams, seasonStandings, overallByTeamId))}
              >
                🏆 Simulate the playoffs
              </button>
            )}
            {playoffResult && <PlayoffBracketTree result={playoffResult} teamById={teamById} />}
          </>
        )}
      </div>
      <div className="expand-all-controls">
        <button className="secondary-btn" onClick={() => setExpandedTeamIds(new Set(teams.map((t) => t.id)))}>
          Expand all
        </button>
        <button
          className="secondary-btn"
          onClick={() => setExpandedTeamIds(new Set<string>())}
        >
          Collapse all
        </button>
      </div>
      {ranked.map(({ team, breakdown, rank }) => {
        const shownTeam = displayTeam(team);
        const assignments = allAssignments(shownTeam);
        // A thin-bench player is genuinely split across two or three slots by `autoAssignRotation`;
        // the per-slot rows below then read as several different players. Their total minutes,
        // shown alongside each partial, make it clear it's one body covering multiple spots.
        const totalMinutesByPlayerId = new Map<string, number>();
        for (const a of assignments) {
          totalMinutesByPlayerId.set(a.player.id, (totalMinutesByPlayerId.get(a.player.id) ?? 0) + a.minutes);
        }
        const starterKeys = new Set(primaryStarters(shownTeam).map((entry) => `${entry.slot}|${entry.player.id}`));
        const netRating = projectedNetRating(shownTeam);
        const leagueEvalRow = leagueEvalByTeamId.get(team.id);
        const teamHistory = history.filter((h) => h.teamId === team.id).sort((a, b) => a.pickNumber - b.pickNumber);
        const isExpanded = expandedTeamIds.has(team.id);
        const fitDetail = isExpanded ? fitScore(shownTeam) : null;
        const offenseDetail = isExpanded ? offenseScoreBreakdown(shownTeam) : null;
        const rsPoProfile = fitDetail ? seasonProfile(breakdown, fitDetail) : null;
        const bestOpponent = leagueEvalRow ? teamById(leagueEvalRow.bestMatchup.opponentId) : undefined;
        const worstOpponent = leagueEvalRow ? teamById(leagueEvalRow.worstMatchup.opponentId) : undefined;
        const bestMatchupExplanation = fitDetail && bestOpponent && leagueEvalRow
          ? explainMatchup({ own: fitDetail, opponent: fitScore(displayTeam(bestOpponent)), seriesWinProb: leagueEvalRow.bestMatchup.seriesWinProb })[0]
          : null;
        const worstMatchupExplanation = fitDetail && worstOpponent && leagueEvalRow
          ? explainMatchup({ own: fitDetail, opponent: fitScore(displayTeam(worstOpponent)), seriesWinProb: leagueEvalRow.worstMatchup.seriesWinProb })[0]
          : null;
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
          <div key={team.id} className={`team-result rank-${rank} ${team.isHuman ? 'is-human-team' : ''} ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}>
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
                  <span className="fga-spent">FGA spent: {totalFga.toFixed(1)} / {CAP_LIMIT}</span>
                </div>
                {fitDetail && (
                  <details className="result-accordion-section team-analysis-section">
                    <summary>Team analysis</summary>
                    {insights && (
                      <div className="notes notes-split analysis-insights analysis-insights-lead">
                        <div className="notes-column notes-strengths">
                          <strong>Strengths</strong>
                          <ul>
                            {insights.strengths.map((insight) => (
                              <li key={insight.id}>{insight.message}</li>
                            ))}
                          </ul>
                        </div>
                        {insights.concerns.length > 0 && (
                          <div className="notes-column notes-concerns">
                            <strong>Concerns</strong>
                            <ul>
                              {insights.concerns.map((insight) => (
                                <li key={insight.id}>{insight.message}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                    {(fitDetail.inputs.primaryArchetype || rsPoProfile) && (
                      <div className="analysis-identity">
                        {fitDetail.inputs.primaryArchetype && (
                          <p className="analysis-identity-line">
                            <b>Identity:</b> {fitDetail.inputs.primaryArchetype}
                            {fitDetail.inputs.secondaryArchetype ? ` + ${fitDetail.inputs.secondaryArchetype}` : ''}
                            {fitDetail.inputs.archetypeReport && ` — risk: ${fitDetail.inputs.archetypeReport.failureMode}`}
                          </p>
                        )}
                        {rsPoProfile && (
                          <p className="analysis-identity-line">
                            <b>Season profile:</b> {rsPoProfile.label} (RS {rsPoProfile.regularSeason} · PO {rsPoProfile.playoffs}). {rsPoProfile.explanation}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="analysis-bars">
                      {offenseDetail && <MetricBar label="O-TAL" value={offenseDetail.otal} hint="Team offensive talent." />}
                      <MetricBar label="Creation" value={fitDetail.components.creationStructure} hint="Half-court shot creation the roster can generate on its own." />
                      {offenseDetail && <MetricBar label="Spacing" value={offenseDetail.spacing} hint="Floor spacing the five provides." />}
                      <MetricBar label="Rim pressure" value={fitDetail.components.rimPressureTeam} hint="How much the five collectively bends a defense at the rim." />
                      <MetricBar label="Defense" value={fitDetail.components.defensiveRoleCoverage} hint="Coverage of the point-of-attack / wing / rim defensive roles." />
                      <MetricBar label="Switchability" value={fitDetail.components.switchability} hint="How freely the roster can switch across a screen without a mismatch." />
                      <MetricBar label="Hunt resistance" value={fitDetail.components.huntResistance} hint="How well the roster hides its weakest defender in a playoff series." />
                      <MetricBar label="Rebounding" value={fitDetail.components.reboundingBalance} hint="Two-way rebounding balance." />
                      <MetricBar label="Size" value={fitDetail.components.sizeCoverage} hint="Functional positional size across the lineup." />
                      <MetricBar label="Title structure" value={fitDetail.components.championshipStructure} hint="How closely the roster's shape matches real championship rosters." />
                    </div>
                    <details className="analysis-raw">
                      <summary>All metrics &amp; inputs</summary>
                      {offenseDetail && (
                        <>
                          <div className="analysis-section-heading">Offense</div>
                          <span className="fit-detail-metric"><b>O-TAL</b><strong>{Math.round(offenseDetail.otal)}</strong></span>
                          <span className="fit-detail-metric"><b>Spacing</b><strong>{Math.round(offenseDetail.spacing)}</strong></span>
                          <span className="fit-detail-metric"><b>Rim pressure</b><strong>{Math.round(offenseDetail.rimPressure)}</strong></span>
                          <span className="fit-detail-metric"><b>Playmaking</b><strong>{Math.round(offenseDetail.playmaking)}</strong></span>
                          <span className="fit-detail-metric"><b>Self-creation</b><strong>{Math.round(offenseDetail.selfCreation)}</strong></span>
                          <span className="fit-detail-metric" title="Real pick-and-roll structure: an initiator paired with a screener whose own gravity forces a switch, surrounded by real spacing.">
                            <b>Mismatch structure</b><strong>{Math.round(offenseDetail.mismatchStructure)}</strong>
                          </span>
                          <span className="fit-detail-metric" title="Playmaking + self-creation blend — how dangerous this five is at hunting a mismatch on offense.">
                            <b>Hunting potential</b><strong>{Math.round(fitDetail.inputs.huntingPotential)}</strong>
                          </span>
                        </>
                      )}
                      <div className="analysis-section-heading">Fit &amp; defense</div>
                      <span className="fit-detail-metric"><b>Creation</b><strong>{Math.round(fitDetail.components.creationStructure)}</strong></span>
                      <span className="fit-detail-metric"><b>Spacing compatibility</b><strong>{Math.round(fitDetail.components.spacingCompatibility)}</strong></span>
                      <span className="fit-detail-metric"><b>Rim pressure (fit)</b><strong>{Math.round(fitDetail.components.rimPressureTeam)}</strong></span>
                      <span className="fit-detail-metric"><b>Defensive roles</b><strong>{Math.round(fitDetail.components.defensiveRoleCoverage)}</strong></span>
                      <span className="fit-detail-metric"><b>Switchability</b><strong>{Math.round(fitDetail.components.switchability)}</strong></span>
                      <span className="fit-detail-metric"><b>Hunt resistance</b><strong>{Math.round(fitDetail.components.huntResistance)}</strong></span>
                      {fitDetail.components.defensiveCohesion > 0 && (
                        <span className="fit-detail-metric"><b>Defensive cohesion</b><strong>{Math.round(fitDetail.components.defensiveCohesion)}</strong></span>
                      )}
                      <span className="fit-detail-metric"><b>Rebounding</b><strong>{Math.round(fitDetail.components.reboundingBalance)}</strong></span>
                      <span className="fit-detail-metric"><b>Functional size</b><strong>{Math.round(fitDetail.components.sizeCoverage)}</strong></span>
                      <span className="fit-detail-metric"><b>Championship structure</b><strong>{Math.round(fitDetail.components.championshipStructure)}</strong></span>
                      {fitDetail.inputs.championshipArchetypes.length > 0 && (
                        <span className="fit-detail-wide"><b>Archetypes</b> {fitDetail.inputs.championshipArchetypes.map((entry) => `${entry.archetype} ${entry.share}%`).join(' · ')}</span>
                      )}
                      {fitDetail.inputs.archetypeReport && (
                        <span className="fit-detail-wide"><b>Profile:</b> {fitDetail.inputs.archetypeReport.strengths.join(' · ')}.</span>
                      )}
                      <span className="fit-v2-shadow-detail">
                        <b>Defenders:</b> POA {fitDetail.inputs.guardContainmentProvider ?? '—'} {Math.round(fitDetail.inputs.guardContainment)}
                        {!fitDetail.inputs.guardContainmentConfirmed && ' (inferred)'}
                        {' · '}wing {fitDetail.inputs.wingCoverageProvider ?? '—'} {Math.round(fitDetail.inputs.wingCoverage)}
                        {!fitDetail.inputs.wingCoverageConfirmed && ' (inferred)'}
                        {' · '}rim {fitDetail.inputs.rimProtectionProvider ?? '—'} {Math.round(fitDetail.inputs.rimProtection)}
                        {!fitDetail.inputs.rimProtectionConfirmed && ' (inferred)'}
                        {fitDetail.inputs.defensiveWeakLinkIsHuntable &&
                          <>
                            {' · '}weak link {fitDetail.inputs.defensiveWeakLinkPlayer ?? '—'} {Math.round(fitDetail.inputs.defensiveWeakLinkResistance)}
                            {fitDetail.inputs.defensiveWeakLinkCover > 0 && ` · shell cover +${fitDetail.inputs.defensiveWeakLinkCover}`}
                          </>
                        }
                      </span>
                      {huntability && huntability.offenders.length > 0 && (
                        <span className="fit-v2-shadow-detail">
                          <b>Weak-link targets:</b> {huntability.offenders.slice(0, 4).map((offender) =>
                            `${offender.playerName} D${offender.defensiveTalent}/${offender.minutes}m`,
                          ).join(' · ')}
                        </span>
                      )}
                      <span className="fit-v2-shadow-detail">
                        <b>Size inputs:</b> height {Math.round(fitDetail.inputs.positionAdjustedHeightPercentile ?? 50)}
                        {' · '}strength {Math.round(fitDetail.inputs.positionAdjustedWeightPercentile ?? 50)}
                        {' · '}athleticism {Math.round(fitDetail.inputs.positionAdjustedAthleticismPercentile ?? 50)}
                        {' · '}rebounding {Math.round(fitDetail.inputs.positionAdjustedReboundingPercentile)}
                      </span>
                    </details>
                  </details>
                )}
                <details className="result-accordion-section championship-section">
                  <summary>Championship odds</summary>
                  {leagueEvalRow && (
                    <div className="championship-summary" title="Simulated over the full 16-team bracket, seeded by the Final Power Ranking.">
                      <div className="championship-headline">
                        <span className="championship-headline-stat">
                          <b>{(leagueEvalRow.championshipProbability * 100).toFixed(1)}%</b>
                          <i>to win it all</i>
                        </span>
                        <span className="championship-headline-stat">
                          <b>{(leagueEvalRow.avgSeriesWinProb * 100).toFixed(0)}%</b>
                          <i>avg BO7 series win</i>
                        </span>
                      </div>
                      <span>
                        Best matchup: vs {teamLabel(teamById(leagueEvalRow.bestMatchup.opponentId)!)} (
                        {(leagueEvalRow.bestMatchup.seriesWinProb * 100).toFixed(0)}%)
                        {bestMatchupExplanation && ` — ${bestMatchupExplanation}`}
                      </span>
                      <span>
                        Toughest matchup: vs {teamLabel(teamById(leagueEvalRow.worstMatchup.opponentId)!)} (
                        {(leagueEvalRow.worstMatchup.seriesWinProb * 100).toFixed(0)}%)
                        {worstMatchupExplanation && worstMatchupExplanation !== bestMatchupExplanation && ` — ${worstMatchupExplanation}`}
                      </span>
                    </div>
                  )}
                  {/* The raw regression estimate is kept for texture but demoted to a footnote: for
                      an all-time field it extrapolates past its real-NBA training range and its
                      rank order no longer drives the bracket (see matchup.ts, 2026-09-09), so it
                      shouldn't sit level with the odds it used to disagree with. */}
                  <p className="net-rating-footnote" title="Real-NBA-units regression (points per 100 possessions), fitted on real NBA team-seasons. Separate from the bracket sim above.">
                    Raw net-rating estimate: {netRating.net >= 0 ? '+' : ''}{netRating.net.toFixed(1)} (ORTG {netRating.offense.toFixed(1)} / DRTG {netRating.defense.toFixed(1)})
                  </p>
                </details>
                {fitDetail && rsPoProfile && (
                  <HistoricalChallengesPanel team={shownTeam} breakdown={breakdown} fit={fitDetail} season={rsPoProfile} />
                )}
                {team.isHuman && <WhatIfPanel team={shownTeam} />}
                <details className="result-accordion-section rotation-panel">
                  <summary>Rotation</summary>
                  <div className="lineup">
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
                                    {compactPlayerName(e.player.playerName)} ({compactSpanLabel(e.player.spanLabel)})
                                    <span className="rotation-role-badge">{starterKeys.has(`${e.slot}|${e.player.id}`) ? 'Starter' : 'Bench'}</span>
                                  </span>
                                  <span className="player-row-meta">
                                    <span className="player-row-minutes">
                                      {e.minutes} min
                                      {(totalMinutesByPlayerId.get(e.player.id) ?? e.minutes) !== e.minutes && (
                                        <span className="player-row-total-min"> ({totalMinutesByPlayerId.get(e.player.id)} total)</span>
                                      )}
                                    </span>
                                    <span className="player-row-boxscore">
                                      <span>{e.player.box.ppg.toFixed(1)} PTS</span>
                                      <span>{e.player.box.rpg.toFixed(1)} REB</span>
                                      <span>{e.player.box.apg.toFixed(1)} AST</span>
                                    </span>
                                    <span className="player-row-shooting">
                                      <span>{(e.player.box.fgPct * 100).toFixed(0)}% FG</span>
                                      <span>{(e.player.box.threePct * 100).toFixed(0)}% 3P</span>
                                    </span>
                                    {/* 2026-08-19, user's explicit ask: a bare "TAL 97" chip is one
                                        number with no sense of what it means — post-draft (the pick
                                        is already locked in, nothing left to spoil), pairing it with
                                        the same named tier the draft screens use gives the number
                                        real context instead of asking the player to already know
                                        this game's own internal scale. */}
                                    <span className="mini-fact player-talent">TAL {displayTalentForSpan(tierContextFor(e.player))}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </details>
                <details className="result-accordion-section draft-order">
                  <summary>Draft order</summary>
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
                </details>
              </div>
            )}
          </div>
        );
      })}
      <details className="left-on-board left-on-board-collapsed">
        <summary>Left on board ({leftOnBoard.length} players)</summary>
        <ul>
          {leftOnBoard.slice(0, 20).map((p) => (
            <li key={p.playerName}>{p.playerName} ({p.spanLabel}) — {p.primaryPosition}, TAL {p.TAL}</li>
          ))}
        </ul>
      </details>
      <div className="results-actions">
        <button className="secondary-btn" onClick={onRestart}>Play again</button>
      </div>
    </div>
  );
}
