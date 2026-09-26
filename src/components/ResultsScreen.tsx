import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { realSecondaryPositions } from '../engine/positionCompetence';
import { rankTeams, offenseScoreBreakdown, teamDefensiveTalentScore, type OffenseScoreBreakdown, type ScoreBreakdown } from '../engine/scoring';
import { evaluateLeague, type TeamLeagueEvaluation } from '../engine/leagueSimulation';
import { simulateSeason, buildMatchupCache, type SeasonStandingsRow } from '../engine/seasonSimulation';
import { PLAYOFF_TEAM_COUNT, simulatePlayoffs, type PlayoffResult, type PlayoffSeriesResult } from '../engine/playoffSimulation';
import { STARTER_SLOTS, CAP_LIMIT, positionFitMultiplier } from '../engine/positions';
import type { Position } from '../data/schema';
import { allAssignments, benchWithMinutes, primaryStarters, type ResolvedSlotAssignment } from '../engine/rotation';
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
import { fitScore, type FitScoreResult } from '../engine/fit';
import { defensiveHuntability } from '../engine/defensiveHuntability';
import { generateRosterInsights, insightContextFor } from '../engine/insights';
import { explainMatchup } from '../engine/matchupExplanation';
import { seasonProfile } from '../engine/seasonProfile';
import { buildTeamFeatureSnapshot } from '../engine/insightMapper';
import { archetypeDisplayName, DEFENSE_FIRST_MIN_SCORE, teamStyleFor } from '../engine/championshipArchetype';
import { bestHistoricalComp, type HistoricalCompMatch } from '../engine/historicalComps';
import { type FeedbackEntry } from './FeedbackToggle';
// 2026-08-16, user's own ask ("dodasz to też na ostatni ekran ocen?"): reuses the exact same
// hover-stats popover the Overview grid's own drafted-pick cells already have (DraftBoard.tsx) —
// safe to import directly (not lazy) since GameShell already bundles DraftBoard and this file
// together as siblings, so nothing about the app's existing load-time split changes.
// 2026-09-14, user-reported live ("wyrzucamy historical challanges i what-if"): both panels
// dropped from this screen — `HistoricalChallengesPanel`/`WhatIfPanel` themselves are UNTOUCHED
// (not deleted), just no longer imported/rendered here. The user's own explicit plan for
// Historical Challenges is to reuse it as the base of a real separate game mode later, not to
// throw the work away — see [[player_skeleton_and_new_modes]].
import MatchupMatrix from './MatchupMatrix';
import { downloadDuelCard, type ShareCardStarter, type ShareRosterRow } from './shareCardImage';
import { CapIcon, Face, shortenName } from './ShotChip';

// 2026-09-14, user-reported live: shared scheduling helpers for both background-simulation
// features below (Title Odds precision upgrade, season-sim pool) — real work deferred until the
// browser is actually idle, so neither one competes with the results screen's own first paint.
// `requestIdleCallback` isn't in Safari; a short `setTimeout` is a reasonable stand-in (still
// yields to the current paint/interaction, just without the "only when truly idle" guarantee).
function scheduleIdle(fn: () => void): number {
  const w = window as typeof window & { requestIdleCallback?: (cb: () => void) => number };
  return w.requestIdleCallback ? w.requestIdleCallback(fn) : window.setTimeout(fn, 300);
}
function cancelIdle(handle: number): void {
  const w = window as typeof window & { cancelIdleCallback?: (handle: number) => void };
  if (w.cancelIdleCallback) w.cancelIdleCallback(handle);
  else window.clearTimeout(handle);
}

/** Fast enough to paint instantly even pre-caching; kept modest anyway since the precise pass
 * below replaces it within a moment either way. */
const FAST_TITLE_ODDS_SIMULATIONS = 500;
/** The engine's own real calibration default (`DEFAULT_SIMULATIONS`, leagueSimulation.ts) — what
 * Title Odds always meant to show, now affordable in the background instead of blocking paint. */
const PRECISE_TITLE_ODDS_SIMULATIONS = 20000;
/** How many independent season rolls the background pool builds before "Simulate an 82-game
 * season" has a real distribution to pick a representative entry from. */
const SEASON_SIM_POOL_SIZE = 60;

/** The pool entry whose win total for `humanTeamId` sits closest to the pool's own median — see
 * this screen's own docstring on the season-sim pool for why "closest to median" instead of an
 * arbitrary or purely-random pick. Ties broken by whichever entry comes first. Falls back to the
 * pool's own first entry if `humanTeamId` never appears in it (defensive; not an expected path). */
function pickRepresentativeSeason(pool: SeasonStandingsRow[][], humanTeamId: string): SeasonStandingsRow[] {
  const winsByIndex = pool.map((standings) => standings.find((row) => row.teamId === humanTeamId)?.wins ?? 0);
  const sorted = [...winsByIndex].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let bestIndex = 0;
  let bestDiff = Infinity;
  winsByIndex.forEach((wins, index) => {
    const diff = Math.abs(wins - median);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });
  return pool[bestIndex] ?? pool[0];
}

/**
 * 2026-09-14, user-reported live ("a gdyby zrobić animację cyfr?" — what if we animated the
 * digits?): tweens a displayed number toward `target` over `durationMs` using an ease-out curve,
 * instead of a silent jump — makes the Title Odds precision upgrade (500 → 20,000 trials, once the
 * browser is idle) a visible "the odds are settling in" moment rather than an invisible swap.
 * Respects `prefers-reduced-motion` (jumps straight to `target`, no animation frames at all).
 * Starts each tween from whatever's CURRENTLY displayed (not the previous target), so a second
 * update arriving mid-tween blends smoothly instead of snapping back to a stale starting point.
 */
function useAnimatedNumber(target: number, durationMs = 700): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target);
      displayRef.current = target;
      return;
    }
    const from = displayRef.current;
    if (from === target) return;
    let start: number | null = null;
    function tick(now: number) {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      const value = from + (target - from) * eased;
      displayRef.current = value;
      setDisplay(value);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  return display;
}

/** Small wrapper so the two live Title Odds displays (hero header, per-team "Championship odds"
 * section) share one tween + formatting rule instead of hand-rolling `useAnimatedNumber` twice. */
function AnimatedPercent({ value, className }: { value: number; className?: string }) {
  const animated = useAnimatedNumber(value * 100);
  return <span className={className}>{animated.toFixed(animated >= 10 ? 0 : 1)}%</span>;
}

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

interface Props {
  teams: Team[];
  /** Full draft history across every team, so each team's card can show its own pick order —
   * the user's own ask: "show team draft history in [results] screen." The live "Show Draft
   * History" toggle during the draft only covers the in-progress view; this is the same data,
   * scoped per team, on the screen that actually sticks around after the draft ends. */
  history: DraftHistoryEntry[];
  mode: 'developer' | 'player';
  onRestart: () => void;
  /** 2026-09-24: start a new draft straight from the results — `seed` given = the same board
   * again ("Rematch"), omitted = a fresh random one ("New draft"). */
  onRematch?: (seed?: number) => void;
  /** Read-only here — reactions made live during the draft (see `DraftHistory`/`GameShell`).
   * Folded into the same export as this screen's own roster-row reactions so a single downloaded
   * file has everything. */
  pickReactions: Record<number, FeedbackEntry>;
  /** Commissioner Mode's per-pick causal-reasoning notes (see `DraftHistory`/`GameShell`) — empty
   * for a normal single-human-team draft. Folded into the same export as everything else here. */
  pickReasoning: Record<number, string>;
  /** 2026-09-11, "Duel na seedzie" — the uint32 RNG seed this exact draft ran on (`DraftState.seed`,
   * already logged to the console in dev, already replayable via `?draftSeed=` — see
   * `GameShell.tsx`'s own `seedFromUrl` docstring). Threaded through here purely so the hero's
   * "Challenge a friend" button can build a shareable link — no new draft logic, this is the same
   * seed/replay mechanism that already existed, just surfaced in the UI for the first time. */
  draftSeed: number;
  /** 2026-09-17, user's own ask ("challange a friend łączy dwie osoby, ale nie ma na koniec
   * porównania obu draftów"): the original "Duel na seedzie" spec deliberately left the actual
   * comparison to the two people manually ("no backend, no automatic comparison"). This closes
   * that gap the only way a 100%-client-side game can — the challenger's own headline result
   * (name/overall/rank/fieldSize) rides along AS PART OF the shareable link itself
   * (`copyChallengeLink` below encodes it, `GameShell.tsx`'s `challengerFromUrl` decodes it), so
   * the second player's own Results screen can show a real "you vs them" comparison the moment
   * their draft finishes — still no server, the URL IS the message. `undefined` for a normal
   * (non-challenge-link) draft. */
  challenger?: ChallengeChallenger;
}

/** See the `challenger` prop's own docstring on `Props` above for the full "no backend" story.
 * 2026-09-17, same-day follow-up (user's own ask: "krótkie porównanie składów + share" — a short
 * roster comparison, plus a share action, right on the popup): `starters` reuses the exact
 * `ShareCardStarter` shape the PNG share card already builds (`shareCardImage.ts`) — same 5-slot
 * starting five, just the position+name a real user cares about for a quick "who'd you take at
 * PG" glance, not the full 9-man roster/minutes breakdown that would bloat the shareable link. */
export interface ChallengeChallenger {
  name: string;
  overall: number;
  rank: number;
  fieldSize: number;
  starters: ShareCardStarter[];
  /** 2026-09-17, same-day follow-up ("dawaj bardziej szczegółowy" — make it more detailed): the
   * same 7 `ScoreChip` values the hero's own "Team profile" row already shows for THIS team —
   * reused as-is rather than inventing a second breakdown, so a friend's popup reads exactly like
   * looking at their own Results screen would. Optional: an older-format link (before this
   * follow-up shipped) still shows the headline score + roster rows without this row. */
  scores?: { talent: number; benchDepth: number; offense: number; defense: number; spacing: number; fit: number; rotation: number };
  /** 2026-09-17, same-day follow-up (user: "dałoby radę zrobić tam rotacje tak jak na koniec
   * draftu" — do the rotation the same way the single-player Results screen does): a flat list of
   * every rotation slot assignment (one entry per contributor, so a combo guard covering both
   * PG/SG appears twice) — the same shape `results-hero-rotation`'s own `assignments` prop already
   * carries, just serializable. Optional: an older-format link falls back to `starters`-only. */
  rotation?: ChallengeRotationEntry[];
}

/** One contributor's minutes at one rotation slot — see `rotation`'s own docstring on
 * `ChallengeChallenger` above. */
export interface ChallengeRotationEntry {
  slot: string;
  name: string;
  minutes: number;
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

/** 2026-09-11, user-reported live ("14) skala może być w czerwono-zielonym gradiencie" / "16)
 * kurde brzydkie to") — `ScoreChip`/`MetricBar` used to tint off `scoreBand`'s own 6 discrete
 * buckets, whose bottom 4 (0-67) span red→amber→green but whose TOP 2 buckets (67-100) are both
 * the same green — so a real, competitive roster (whose metrics mostly land 50-95) rendered as a
 * wall of near-identical green, reading as "no color" even though the mechanism technically has
 * some. A continuous interpolation instead of discrete bands means a 58 and a 95 — both "good" —
 * still read as visibly different shades, the actual "gradient" the ask was for. Same red/green
 * hue endpoints `MatchupMatrix.tsx`'s own diverging scale uses, for one consistent "how good is
 * this number" visual language across the app's judgment displays. */
function qualityColor(v: number): string {
  const t = Math.max(0, Math.min(100, v)) / 100;
  const hue = 2 + t * 146;
  const saturation = 42 + Math.abs(t - 0.5) * 34;
  const lightness = 30 + t * 12;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
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
 * 2026-09-11, competitor scouting report ("Scouting Report" artifact): every rival in this space
 * names the OUTCOME, not just the number — HoopsMatic's 73-9 game badges an 11-71 season as "TANK
 * COMMANDER". A bare "11th / 16" is correct but has no personality. Real sports vocabulary, not an
 * invented scale — six bands over a 16-team field, scored on rank (the thing a real GM/fan actually
 * says out loud) with a `tone` for the hero's accent color, reusing the existing score-band ladder
 * rather than a 7th palette.
 */
function resultTierLabel(rank: number, fieldSize: number): { label: string; tone: 1 | 2 | 3 | 4 | 5 | 6 } {
  const pct = rank / fieldSize; // lower = better
  if (rank === 1) return { label: 'Dynasty', tone: 6 };
  if (pct <= 0.2) return { label: 'Contender', tone: 5 };
  if (pct <= 0.4) return { label: 'Playoff Lock', tone: 4 };
  if (pct <= 0.6) return { label: 'Play-In Fight', tone: 3 };
  if (pct <= 0.85) return { label: 'Lottery Team', tone: 2 };
  if (rank < fieldSize) return { label: 'Full Rebuild', tone: 1 };
  return { label: 'Wooden Spoon', tone: 1 };
}

/**
 * 2026-09-09, user-reported ("końcowy screen wygląda średnio"): the results screen opened straight
 * into a plain `<h2>Final team ranking</h2>` and 16 identical accordion cards, so the one thing a
 * player actually came back to see — how their own roster did — had no more visual weight than the
 * CPU teams. This is the payoff line: finish position out of 16, the Final Power Ranking Overall
 * (the single number every team is judged by, kept dominant here), the simulated title odds (now
 * consistent with that ranking after the 2026-09-09 matchup fix), and the roster's own one-line
 * identity + honest failure mode straight from `fitScore`'s archetype report.
 *
 * 2026-09-11, "Scouting Report" competitor audit (HoopsMatic/82-0/Era Ball all end their results
 * screen the same way): three additions, none touching the engine —
 *  - a named tier badge (`resultTierLabel`) next to the raw rank, the same "name the outcome, not
 *    just the number" move all three rivals make;
 *  - a "gap to #1" caption so the Overall number has a benchmark instead of floating alone;
 *  - a "Copy result" button. This is the one the audit called the actual finding that matters for
 *    a friends-group launch — every rival treats "share this" as part of the payoff, and this
 *    screen had no path from "I just saw my result" to "I sent it to the group chat" at all.
 *    Clipboard-only, no backend, no share-sheet dependency — exactly the "closed friend group who
 *    already coordinate outside the app" case the audit scoped it to.
 */
function HeroResult({
  teamName,
  isHuman,
  rank,
  fieldSize,
  overall,
  talentScore,
  benchDepthScore,
  offenseScore,
  defenseScore,
  spacingScore,
  fitScore,
  rotationScore,
  fitDetail,
  offenseDetail,
  assignments,
  starterKeys,
  topOverall,
  titleOdds,
  draftSeed,
  identity,
  failureMode,
  weakDefenders,
  defenseTalent,
  comp,
  starters,
  roster,
  challenger,
  seasonSimSlot,
}: {
  teamName: string;
  isHuman: boolean;
  rank: number;
  fieldSize: number;
  overall: number;
  talentScore: number;
  benchDepthScore: number;
  offenseScore: number;
  defenseScore: number;
  spacingScore: number;
  fitScore: number;
  rotationScore: number;
  fitDetail: FitScoreResult | null;
  offenseDetail: OffenseScoreBreakdown | null;
  challenger?: ChallengeChallenger;
  assignments: ResolvedSlotAssignment[];
  starterKeys: Set<string>;
  topOverall: number | null;
  titleOdds: number | null;
  draftSeed: number;
  identity: string | null;
  failureMode: string | null;
  weakDefenders: { name: string; slot: Position; dtal: number; minutes: number }[];
  defenseTalent: number | null;
  comp: HistoricalCompMatch | null;
  starters: ShareCardStarter[];
  roster: ShareRosterRow[];
  /** 2026-09-18, user-reported live ("simulate season można dać nad rotacją gdzie jest empty
   * space" — the season-sim panel can go above, next to the Rotation cards, where there's empty
   * space): a pre-built JSX subtree from `ResultsScreen` itself (which owns all the season-sim
   * state) rather than threading every individual piece of that state down as its own prop — the
   * simplest way for a child this deep to render a parent-owned slot without duplicating state. */
  seasonSimSlot?: ReactNode;
}) {
  const [challengeCopied, setChallengeCopied] = useState(false);
  // 2026-09-17, user-reported live ("więcej sosu, coś jak share po zakończonym drafcie" — more
  // sauce, like the share after a finished draft): the popup's own share action only ever copied a
  // link; this gives it real visual payoff — a downloadable head-to-head card
  // (`shareCardImage.ts`'s `buildDuelCardBlob`). 'idle' | 'building' | 'done' | 'error' rather than
  // a bare boolean so a slow headshot load (or a canvas failure) has a visible state instead of the
  // button looking unresponsive.
  const [duelPngState, setDuelPngState] = useState<'idle' | 'building' | 'done' | 'error'>('idle');
  // 2026-09-11, user-reported live ("zamiast copy result to może 'share the result' i wyskakuje
  // ekran z naszymi wynikami?") — plain clipboard copy gave no preview of what you were actually
  // sending; a real card to look at matches what every rival this screen was already benchmarked
  // against does. No backend/share-sheet added — same "closed friend group" scope the original
  // Copy-result feature was built for.
  // 2026-09-12, "Copy as text" itself removed (user's own ask, "usuń copy as text") — the PNG
  // download below is now the one share action, and covers strictly more (roster + rotation, not
  // just the headline stats a text blob had room for).
  const [shareOpen, setShareOpen] = useState(false);
  const tier = resultTierLabel(rank, fieldSize);
  const gap = topOverall !== null ? topOverall - overall : null;
  // 2026-09-17, follow-up to "Duel na seedzie" (user: "nie ma na koniec porównania obu draftów" —
  // there's no comparison of both drafts at the end): auto-opens once, the moment a challenge-link
  // draft's Results screen mounts, so the second player can't miss it. Dismissible, and only ever
  // shown when `challenger` is actually present (a normal draft never sees this).
  const [compareOpen, setCompareOpen] = useState(() => challenger !== undefined);
  // 2026-09-17, user-reported live (screenshot: a tie's "Your friend" card rendered with the green
  // "winner" tint) — this used to be `overall > challenger.overall`, which is `false` for BOTH a
  // loss AND a tie; the JSX below checks `youWon === false` for "friend won" specifically, so a
  // tie was misread as a friend win. Explicit 3-way `true`/`false`/`null`, matching
  // `shareCardImage.ts`'s `buildDuelCardBlob` (which already had this right).
  const youWon = challenger ? (overall > challenger.overall ? true : overall < challenger.overall ? false : null) : null;

  /** 2026-09-11, "Duel na seedzie" — user's own spec: "Ty i znajomy dostajecie DOKŁADNIE tę samą
   * kolejność picków AI... Zero nowej logiki draftu, tylko UI do 'wygeneruj link z tym seedem,
   * wyślij znajomemu'." The seed/replay mechanism (`?draftSeed=`, `GameShell.tsx`'s own
   * `seedFromUrl`) already existed — this just copies a link carrying THIS draft's own seed, so a
   * friend who opens it and clicks Start Draft gets the identical 16-team AI sequence to react to.
   *
   * 2026-09-17, user's own follow-up ask ("nie ma na koniec porównania obu draftów" / "popup z
   * porównaniem dla drugiego gracza do wysłania znajomemu"): the original spec deliberately left
   * the actual comparison manual — "no backend, no automatic comparison." Closing that gap without
   * adding a backend means the comparison has to travel IN the link itself: this now also encodes
   * THIS result's own name/overall/rank/fieldSize as query params, so whoever opens the link and
   * finishes their own draft lands on a Results screen that already knows what it's being compared
   * against (`GameShell.tsx`'s `challengerFromUrl` decodes these same params). That second player's
   * own "Challenge a friend" click then naturally encodes THEIR result the same way — sending it
   * back (or onward) closes the loop with zero new UI needed for the reply direction.
   *
   * 2026-09-17, same-day follow-up ("krótkie porównanie składów + share" — a short roster
   * comparison too): `cs` carries the same 5-entry starting five the PNG share card already
   * builds (`starters`, `ShareCardStarter[]`), small enough for a URL without needing the full
   * 9-man roster/minutes this popup deliberately keeps out of scope (that's what the PNG share
   * card is for).
   *
   * 2026-09-17, same-day follow-up ("dawaj bardziej szczegółowy" — make it more detailed): `cv`
   * carries the same 7 numbers the hero's own "Team profile" `ScoreChip` row already shows for
   * this team (already rounded integers, same as the chips display), so the popup's per-metric
   * table can never disagree with what this exact screen shows for the person who generated the
   * link.
   *
   * 2026-09-17, same-day follow-up ("dałoby radę zrobić tam rotacje tak jak na koniec draftu"):
   * `cx` carries every rotation contributor (not just the 5 starters) + their minutes.
   *
   * 2026-09-17, user-reported live ("link do challange jest ABSURDALNIE długi" — the link is
   * absurdly long): `cs`/`cv`/`cx` used to be JSON objects with named keys (`{"slot":"PG",
   * "name":"Jason Kidd","minutes":34}`), and every key name gets repeated per entry — `cx` alone
   * can carry 9+ rotation entries, so those repeated key names (further bloated by percent-
   * encoding: `"`→`%22`, `:`→`%3A`) were the dominant cost. All three now encode as plain
   * positional tuples instead (`["PG","Jason Kidd",34]`) — same JSON.parse/Array.isArray decode
   * shape on the other end (`GameShell.tsx`'s `challengerFromUrl`), just no key names to repeat.
   * No legacy-format decode kept: this whole feature shipped within the same session, before any
   * real link was ever shared outside it. */
  async function copyChallengeLink() {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();
    params.set('draftSeed', String(draftSeed));
    params.set('cn', teamName);
    params.set('co', String(overall));
    params.set('cr', String(rank));
    params.set('cf', String(fieldSize));
    params.set('cs', JSON.stringify(starters.map((s) => [s.position, s.name])));
    params.set('cv', JSON.stringify([
      Math.round(talentScore),
      Math.round(benchDepthScore),
      Math.round(offenseScore),
      Math.round(defenseScore),
      Math.round(spacingScore),
      Math.round(fitScore),
      Math.round(rotationScore),
    ]));
    params.set('cx', JSON.stringify(
      assignments.map((a) => [a.slot, a.player.playerName, Math.round(a.minutes)]),
    ));
    url.search = `?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      setChallengeCopied(true);
      setTimeout(() => setChallengeCopied(false), 2000);
    } catch {
      // Same silent-fail shape as copyResult below — clipboard permission denied/unavailable.
    }
  }

  /** Guarded `await` so an unexpected exception inside `buildDuelCardBlob` (canvas unsupported, a
   * tainted-canvas/security error, etc.) can't leave `duelPngState` stuck at 'building' forever —
   * the button permanently disabled with no way to retry. */
  async function handleDownloadDuelCard() {
    if (!challenger) return;
    setDuelPngState('building');
    try {
      const ok = await downloadDuelCard(
        {
          you: {
            name: teamName,
            overall,
            rank,
            fieldSize,
            rotation: assignments.map((a) => ({ slot: a.slot, name: a.player.playerName, minutes: Math.round(a.minutes) })),
            scores: {
              talent: Math.round(talentScore),
              benchDepth: Math.round(benchDepthScore),
              offense: Math.round(offenseScore),
              defense: Math.round(defenseScore),
              spacing: Math.round(spacingScore),
              fit: Math.round(fitScore),
              rotation: Math.round(rotationScore),
            },
          },
          friend: {
            name: challenger.name,
            overall: challenger.overall,
            rank: challenger.rank,
            fieldSize: challenger.fieldSize,
            rotation: challenger.rotation ?? [],
            scores: challenger.scores,
          },
        },
        `all-time-draft-duel-${teamName.replace(/\s+/g, '-').toLowerCase()}.png`,
      );
      setDuelPngState(ok ? 'done' : 'error');
    } catch {
      setDuelPngState('error');
    }
    setTimeout(() => setDuelPngState('idle'), 2000);
  }

  return (
    <header className="results-hero">
      {challenger && compareOpen && (
        <div className="challenge-compare-backdrop" onClick={() => setCompareOpen(false)}>
          <div className="challenge-compare-modal" role="dialog" aria-modal="true" aria-label="Challenge comparison" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="challenge-compare-close" aria-label="Close" onClick={() => setCompareOpen(false)}>✕</button>
            <p className="challenge-compare-title">
              {youWon ? '🏆 You win the duel' : overall === challenger.overall ? '🤝 It’s a tie' : 'This one goes to your friend'}
            </p>
            <div className="challenge-compare-row">
              <div className={`challenge-compare-side ${youWon ? 'challenge-compare-side--winner' : ''}`}>
                <span className="challenge-compare-label">You</span>
                <span className="challenge-compare-team">{teamName}</span>
                <span className="challenge-compare-overall">{overall}</span>
                <span className="challenge-compare-rank">{ordinal(rank)} / {fieldSize}</span>
              </div>
              <span className="challenge-compare-vs">vs</span>
              <div className={`challenge-compare-side ${youWon === false ? 'challenge-compare-side--winner' : ''}`}>
                <span className="challenge-compare-label">Your friend</span>
                <span className="challenge-compare-team">{challenger.name}</span>
                <span className="challenge-compare-overall">{challenger.overall}</span>
                <span className="challenge-compare-rank">{ordinal(challenger.rank)} / {challenger.fieldSize}</span>
              </div>
            </div>
            {/* 2026-09-17, same-day follow-up ("dawaj bardziej szczegółowy" — make it more
                detailed): the same 7 numbers the hero's own "Team profile" chips show for this
                team, laid out as your-value / label / their-value so both sides read at a glance;
                the higher value per row gets the same green "winner" treatment the headline score
                cards use. Degrades quietly if `challenger.scores` is missing (an older-format
                link) — just skips straight to the roster comparison below. */}
            {challenger.scores && (
              <div className="challenge-compare-metrics">
                {([
                  ['Talent', Math.round(talentScore), challenger.scores.talent],
                  ['Bench Depth', Math.round(benchDepthScore), challenger.scores.benchDepth],
                  ['Offense', Math.round(offenseScore), challenger.scores.offense],
                  ['Defense', Math.round(defenseScore), challenger.scores.defense],
                  ['Spacing', Math.round(spacingScore), challenger.scores.spacing],
                  ['Fit', Math.round(fitScore), challenger.scores.fit],
                  ['Rotation', Math.round(rotationScore), challenger.scores.rotation],
                ] as [string, number, number][]).map(([label, mine, theirs]) => (
                  <div className="challenge-compare-metric-row" key={label}>
                    <span className={`challenge-compare-metric-value ${mine > theirs ? 'challenge-compare-metric-value--winner' : ''}`}>{mine}</span>
                    <span className="challenge-compare-metric-label">{label}</span>
                    <span className={`challenge-compare-metric-value ${theirs > mine ? 'challenge-compare-metric-value--winner' : ''}`}>{theirs}</span>
                  </div>
                ))}
              </div>
            )}
            {/* 2026-09-17, same-day follow-up (user: "dałoby radę zrobić tam rotacje tak jak na
                koniec draftu" — do the rotation the same way the single-player Results screen
                does): per slot, EVERY contributor (not just the starter) with their minutes, same
                grouping `results-hero-rotation` above already uses for `assignments` — a combo
                guard backing up two slots shows up in both. Falls back to the older starters-only
                row (just a name per slot, no minutes) when `challenger.rotation` is missing (a
                link generated before this follow-up shipped). */}
            {challenger.rotation && challenger.rotation.length > 0 ? (
              <div className="challenge-compare-roster">
                <span className="challenge-compare-roster-label">Rotation</span>
                {STARTER_SLOTS.map((slot) => {
                  const mineEntries = assignments
                    .filter((a) => a.slot === slot)
                    .sort((a, b) => {
                      const aIsStarter = starterKeys.has(`${a.slot}|${a.player.id}`);
                      const bIsStarter = starterKeys.has(`${b.slot}|${b.player.id}`);
                      if (aIsStarter !== bIsStarter) return aIsStarter ? -1 : 1;
                      return b.minutes - a.minutes;
                    });
                  const theirEntries = challenger.rotation!
                    .filter((e) => e.slot === slot)
                    .sort((a, b) => b.minutes - a.minutes);
                  return (
                    <div className="challenge-compare-rotation-slot" key={slot}>
                      <span className="challenge-compare-roster-slot">{slot}</span>
                      <div className="challenge-compare-rotation-cols">
                        <div className="challenge-compare-rotation-col">
                          {mineEntries.length > 0 ? mineEntries.map((a) => (
                            <div className="challenge-compare-rotation-entry" key={a.player.id}>
                              <span className="challenge-compare-rotation-name" title={a.player.playerName}>{shortenName(a.player.playerName, 14)}</span>
                              <span className="challenge-compare-rotation-min">{Math.round(a.minutes)}m</span>
                            </div>
                          )) : <span className="challenge-compare-rotation-empty">—</span>}
                        </div>
                        <div className="challenge-compare-rotation-col challenge-compare-rotation-col--right">
                          {theirEntries.length > 0 ? theirEntries.map((e, i) => (
                            <div className="challenge-compare-rotation-entry" key={`${e.name}-${i}`}>
                              <span className="challenge-compare-rotation-min">{e.minutes}m</span>
                              <span className="challenge-compare-rotation-name" title={e.name}>{shortenName(e.name, 14)}</span>
                            </div>
                          )) : <span className="challenge-compare-rotation-empty">—</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : challenger.starters.length > 0 && (
              <div className="challenge-compare-roster">
                <span className="challenge-compare-roster-label">Starting five</span>
                {STARTER_SLOTS.map((slot) => {
                  const mine = starters.find((s) => s.position === slot)?.name ?? '—';
                  const theirs = challenger.starters.find((s) => s.position === slot)?.name ?? '—';
                  return (
                    <div className="challenge-compare-roster-row" key={slot}>
                      <span className="challenge-compare-roster-slot">{slot}</span>
                      <span className="challenge-compare-roster-name" title={mine}>{mine}</span>
                      <span className="challenge-compare-roster-name" title={theirs}>{theirs}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="challenge-compare-actions">
              <button
                type="button"
                className="challenge-compare-download"
                onClick={handleDownloadDuelCard}
                disabled={duelPngState === 'building'}
              >
                {duelPngState === 'building' ? 'Building…' : duelPngState === 'done' ? '✓ Saved' : duelPngState === 'error' ? '✕ Failed' : '🖼️ Download image'}
              </button>
              <button type="button" className="challenge-compare-share" onClick={copyChallengeLink}>
                {challengeCopied ? '✓ Link copied' : '🔗 Share link'}
              </button>
            </div>
            <p className="challenge-compare-hint">Same 16-team board, same AI, two different drafts.</p>
          </div>
        </div>
      )}
      <div className="results-hero-finish">
        <span className="results-hero-eyebrow">{isHuman ? 'You finished' : 'Top of the field'}</span>
        <span className="results-hero-rank">
          <b>{ordinal(rank)}</b>
          <i>/ {fieldSize}</i>
        </span>
        <span className={`results-hero-tier results-hero-tier-t${tier.tone}`}>{tier.label}</span>
        <span className="results-hero-team">{teamName}</span>
      </div>
      <div className="results-hero-stats">
        <div className={`results-hero-stat results-hero-overall score-t${scoreBand(overall)}`}>
          {/* 2026-09-24: was "Final Power Ranking" — a bare "46" under that label read as a rank
              (46th), right next to the real rank ("16th / 16"). It's the 0-100 team rating. */}
          <span className="results-hero-stat-label">Team rating</span>
          <span className="results-hero-stat-value">
            {overall}
            <small className="results-hero-stat-of">/100</small>
          </span>
        </div>
        {titleOdds !== null && (
          <div
            className="results-hero-stat"
            title="Chance to win a 16-team playoff seeded by the final ranking, over thousands of simulations. The season simulation below plays its own top-8 playoffs."
          >
            <span className="results-hero-stat-label">Title odds</span>
            <AnimatedPercent value={titleOdds} className="results-hero-stat-value" />
          </div>
        )}
      </div>
      {gap !== null && (
        <p className="results-hero-gap">
          {gap > 0
            ? <>Best team rating in the field: <b>{topOverall}</b> — you're <b>{gap}</b> behind.</>
            : <>You have the best team rating in the field.</>}
        </p>
      )}
      {(identity || failureMode || comp) && (
        // 2026-09-24 copy pass: labelled as a STYLE ("Team style: Defense-first") and a risk, so it
        // no longer reads as a quality verdict next to a mediocre Defense score.
        <p className="results-hero-identity">
          {identity && (
            <>
              Team style: <b>{identity}</b>
            </>
          )}
          {identity && failureMode && ' — '}
          {failureMode && <span>main risk: {failureMode}</span>}
          {comp && (
            <span className="results-hero-comp" title={`Closest historical profile: ${comp.comp.blurb}. Match compares this roster's scores, as percentiles of drafted rosters, with what defined that team.`}>
              Plays like the <b>{comp.comp.team}</b> <small>{comp.match}% match</small>
            </span>
          )}
        </p>
      )}
      {/* 2026-09-14, DRAFT per user's own request ("możesz mi pokazać design zanim wprowadzisz") —
          batch item 3 ("ogromnie dużo miejsca na dużym ekranie, można zrobić cały dashboard").
          V1 (plain text numbers + a thin pill-per-player strip) drew direct criticism live
          ("myślę że stać cię na kilka razy lepszy projekt") — visually the "runt" of an otherwise
          bold hero, and two new, unproven visual treatments instead of reusing ones already on
          this screen. V2 fixed the visual weight (`ScoreChip`'s gradient pills, the ShareModal's
          own bordered `.share-modal-face-card` for the starting five) but was still, per the same
          follow-up ("nadal można dodać ławkę, offensive and defensive breakdown... to ma być
          dashboard jako podsumowanie całego draftu, teraz to jest bardzo skrócona wersja"), an
          abbreviated summary rather than the actual draft report. V3 added the two missing pieces,
          both already fully computed elsewhere on this page for the human's own expanded card —
          hoisted up here (`heroFit`/`heroOffenseDetail`) rather than recomputed: the SAME
          Offense/Defense `MetricBar` breakdown "Team analysis" shows below (`.analysis-bars-*`),
          and the bench half of `roster` (already carried all 9 players, not just the 5 starters).
          V4, two more follow-ups the same day: "chyba damy radę zmieścić wszystko w tym hero
          dashboard?" — Team profile now shows all 7 `ScoreChip`s the "Final team ranking" list
          below already has (Talent/Bench Depth/Offense/Defense/Spacing/Fit/Rotation), not just
          OFF/DEF/SPC. Then "zamiast starting 5 i bench, zróbmy tylko rotation i 5 kolumn z
          pozycjami i minutami" — Starting five/Bench (grouped by ROLE, and a bench row's own
          `.primaryPosition` label didn't reflect which slot it actually backs up) replaced by one
          "Rotation" section, 5 columns by SLOT (`heroAssignments`, the same per-slot shape the
          "Rotation" accordion further down already builds via `allAssignments`) — a split
          contributor now correctly shows under every slot they actually cover. */}
      <div className="results-hero-dashboard">
        <div className="results-hero-scores">
          <span className="share-modal-face-group-label">Team profile</span>
          <div className="results-hero-scores-row">
            <ScoreChip label="Talent" value={Math.round(talentScore)} />
            <ScoreChip label="Bench" value={Math.round(benchDepthScore)} />
            <ScoreChip label="Offense" value={Math.round(offenseScore)} />
            <ScoreChip label="Defense" value={Math.round(defenseScore)} />
            <ScoreChip label="Spacing" value={Math.round(spacingScore)} />
            <ScoreChip label="Fit" value={Math.round(fitScore)} />
            <ScoreChip label="Rotation" value={Math.round(rotationScore)} />
          </div>
          {fitDetail && (
            <div className="analysis-bars-split results-hero-bars">
              <div className="analysis-bars-col analysis-bars-col--offense">
                <span className="analysis-bars-col-label">Offense details</span>
                {offenseDetail && <MetricBar label="O-TAL" value={offenseDetail.otal} hint="Team offensive talent." />}
                <MetricBar label="Creation" value={fitDetail.components.creationStructure} hint="Half-court shot creation the roster can generate on its own." />
                {offenseDetail && <MetricBar label="Spacing fit" value={offenseDetail.spacing} hint="Spacing as the offense uses it — shooting around your creators, where an elite playmaker can cover for a non-shooter. Not the same number as the Spacing score above, which is the roster's plain shooting average." />}
                <MetricBar label="Rim pressure" value={fitDetail.components.rimPressureTeam} hint="How much the five collectively bends a defense at the rim." />
                {offenseDetail && <MetricBar label="Playmaking" value={offenseDetail.playmaking} hint="Passing and table-setting — how well the roster creates shots for others, not just for itself." />}
              </div>
              <div className="analysis-bars-col analysis-bars-col--defense">
                <span className="analysis-bars-col-label">Defense details</span>
                {defenseTalent !== null && <MetricBar label="D-TAL" value={defenseTalent} hint="Team defensive talent — the minutes-weighted D-TAL the Defense score starts from, before hunting risk and team structure." />}
                <MetricBar label="Role coverage" value={fitDetail.components.defensiveRoleCoverage} hint="Whether someone covers each defensive job — point of attack, wing, rim. A full set can still add up to a middling Defense score if the individual defenders are average." />
                <MetricBar label="Switchability" value={fitDetail.components.switchability} hint="How freely the roster can switch across a screen without a mismatch." />
                <MetricBar label="Hunt resistance" value={fitDetail.components.huntResistance} hint="How well the roster hides its weakest defender in a playoff series." />
                <MetricBar label="Rebounding" value={fitDetail.components.reboundingBalance} hint="Two-way rebounding balance." />
                {weakDefenders.length > 0 && (
                  <p className="results-hero-weak" title="The Defense score is a minutes-weighted average of each player's D-TAL, so heavy minutes from a weak defender pull it down. Weak means below the median rotation player at that position.">
                    Weakest links:{' '}
                    {weakDefenders.map((row, i) => (
                      <span key={row.name}>
                        {i > 0 && ' · '}
                        <b>{shortenName(row.name)}</b> D-TAL {row.dtal} at {row.slot} ({row.minutes} min)
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          )}
          {/* 2026-09-24, user-reported live ("defense w kafelku i niżej w pasku daje sprzeczne
              sygnały"): the bars are separate ingredients, not re-statements of the chips above —
              "Defense 69" chip vs a "Defense 85" bar read as a contradiction. The two clashing bars
              were renamed (Role coverage, Spacing fit); this line says so for touch screens too,
              where the bars' hover hints never show. */}
          {fitDetail && (
            <p className="results-hero-bars-note">
              These are the ingredients behind the scores above, measured separately — e.g. Role coverage is whether
              each defensive job is filled at all, the Defense score is how well it's done.
            </p>
          )}
          {/* 2026-09-18, user-reported live ("share the result and challenge a friend można dać
              wyżej w empty space który jest po lewej stronie") — this column's content (chips +
              bars) is routinely shorter than the Rotation column beside it, leaving dead space
              below it while these two buttons sat in their own full-width row underneath both
              columns. Moved in here, right after the bars, so they fill that gap instead — same
              "give the column's own empty space a job" move as `seasonSimSlot` in the Rotation
              column just below. */}
          <div className="results-hero-actions">
            <button type="button" className="results-hero-copy" onClick={() => setShareOpen(true)}>
              📤 Share the result
            </button>
            <button
              type="button"
              className="results-hero-copy results-hero-challenge"
              onClick={copyChallengeLink}
              title="Copies a link that gives a friend the exact same 16-team draft board to react to."
            >
              {challengeCopied ? '✓ Link copied' : '🔗 Challenge a friend'}
            </button>
          </div>
        </div>
        <div className="results-hero-rotation">
          <span className="share-modal-face-group-label">Rotation</span>
          <RotationColumns assignments={assignments} starterKeys={starterKeys} />
          {/* 2026-09-18, user-reported live ("simulate season można dać nad rotacją gdzie jest
              empty space, dzięki temu można zmieścić matchups bez potrzeby suwaka" — put it above/
              beside Rotation where there's empty space, so Matchups can fit full width without a
              scroll slider): the Rotation cards rarely fill this column's full height, and the
              season-sim panel is now a small fixed-size trigger (see its own docstring on
              `seasonSimSlot`) regardless of whether a result exists, so it fits here without ever
              growing into the huge inline table it used to become. */}
          {seasonSimSlot}
        </div>
      </div>
      {shareOpen && (
        <ShareModal
          onClose={() => setShareOpen(false)}
          teamName={teamName}
          rank={rank}
          fieldSize={fieldSize}
          tier={tier}
          overall={overall}
          topOverall={topOverall}
          gap={gap}
          titleOdds={titleOdds}
          identity={identity}
          failureMode={failureMode}
          roster={roster}
          scores={{
            talent: Math.round(talentScore),
            benchDepth: Math.round(benchDepthScore),
            offense: Math.round(offenseScore),
            defense: Math.round(defenseScore),
            spacing: Math.round(spacingScore),
            fit: Math.round(fitScore),
            rotation: Math.round(rotationScore),
          }}
        />
      )}
    </header>
  );
}

/** 2026-09-11, user-reported live ("zamiast copy result to może 'share the result' i wyskakuje
 * ekran z naszymi wynikami?") — a real card to look at before/instead of a blind clipboard copy.
 * Reuses the hero's own tier-tone language (`results-hero-tier-t{N}`) so it reads as the same
 * result, not a second visual system invented for one modal. Still no backend/share-sheet — the
 * "Copy as text" button inside is the exact same `copyResult` clipboard write the old button did. */
function ShareModal({
  onClose,
  teamName,
  rank,
  fieldSize,
  tier,
  overall,
  topOverall,
  gap,
  titleOdds,
  identity,
  failureMode,
  roster,
  scores,
}: {
  onClose: () => void;
  teamName: string;
  rank: number;
  fieldSize: number;
  tier: { label: string; tone: 1 | 2 | 3 | 4 | 5 | 6 };
  overall: number;
  topOverall: number | null;
  gap: number | null;
  titleOdds: number | null;
  identity: string | null;
  failureMode: string | null;
  roster: ShareRosterRow[];
  /** 2026-09-18, user-reported live ("można dodać tu podstawowe metryki" — the basic metrics
   * could go here too): the same 7 `ScoreChip` values the hero's own "Team profile" row already
   * shows for this team. */
  scores: { talent: number; benchDepth: number; offense: number; defense: number; spacing: number; fit: number; rotation: number };
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 2026-09-25, user-reported ("brak możliwości zapisu"): the card had no way to be saved at all
  // since the hand-drawn canvas twin was removed (see shareCardImage.ts). It is now captured
  // straight from this DOM with html-to-image, so the saved PNG always matches the card. Phones
  // get the system share sheet (save to photos) when available; otherwise a download, and the
  // image is also shown in place so an in-app browser that blocks both (Messenger) can still
  // long-press it to save.
  const cardRef = useRef<HTMLDivElement>(null);
  const [saveState, setSaveState] = useState<'idle' | 'building' | 'error'>('idle');
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  useEffect(() => () => {
    if (savedImageUrl) URL.revokeObjectURL(savedImageUrl);
  }, [savedImageUrl]);
  const saveImage = async () => {
    const card = cardRef.current;
    if (!card) return;
    setSaveState('building');
    try {
      const { toBlob } = await import('html-to-image');
      const background = getComputedStyle(card).backgroundColor;
      const blob = await toBlob(card, {
        pixelRatio: 2,
        backgroundColor: background && background !== 'rgba(0, 0, 0, 0)' ? background : '#0b0f17',
        filter: (node) => !(node instanceof HTMLElement && node.dataset.shareExclude !== undefined),
      });
      if (!blob) throw new Error('empty image');
      const filename = `${teamName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'my-team'}-all-time-draft.png`;
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `${teamName} — All-Time Draft` });
          setSaveState('idle');
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setSaveState('idle');
            return;
          }
        }
      }
      const url = URL.createObjectURL(blob);
      setSavedImageUrl(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setSaveState('idle');
    } catch {
      setSaveState('error');
    }
  };

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div ref={cardRef} className="share-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Share result">
        <button type="button" className="share-modal-close" onClick={onClose} aria-label="Close" data-share-exclude>
          ✕
        </button>
        <span className="share-modal-team">{teamName}</span>
        <div className="share-modal-rank">
          <b>{ordinal(rank)}</b>
          <i>/ {fieldSize}</i>
        </div>
        <span className={`share-modal-tier results-hero-tier-t${tier.tone}`}>{tier.label}</span>
        <div className="share-modal-stats">
          <div className="share-modal-stat">
            <span>Team rating</span>
            <b>{overall}/100</b>
          </div>
          {titleOdds !== null && (
            <div className="share-modal-stat">
              <span>Title odds</span>
              <b>{(titleOdds * 100).toFixed(titleOdds >= 0.1 ? 0 : 1)}%</b>
            </div>
          )}
        </div>
        {gap !== null && (
          <p className="share-modal-gap">
            {gap > 0 ? (
              <>
                Overall #1 in the field: <b>{topOverall}</b> — you're <b>{gap}</b> back.
              </>
            ) : (
              'You have the best Overall in the field.'
            )}
          </p>
        )}
        {(identity || failureMode) && (
          <p className="share-modal-identity">
            {identity && <b>{identity}</b>}
            {identity && failureMode && ' — '}
            {failureMode}
          </p>
        )}
        <div className="share-modal-scores">
          <ScoreChip label="Talent" value={scores.talent} />
          <ScoreChip label="Bench" value={scores.benchDepth} />
          <ScoreChip label="Offense" value={scores.offense} />
          <ScoreChip label="Defense" value={scores.defense} />
          <ScoreChip label="Spacing" value={scores.spacing} />
          <ScoreChip label="Fit" value={scores.fit} />
          <ScoreChip label="Rotation" value={scores.rotation} />
        </div>
        {roster.length > 0 && (() => {
          // 2026-09-12, user-reported live (screenshot of this exact modal): the roster section
          // was a plain two-column text grid with no faces at all — the PNG `shareCardImage.ts`
          // builds already has a real starting-five headshot row, but this in-modal preview (what
          // the user actually looks at before downloading) never matched it. Face cards added.
          // 2026-09-18, user-reported live (screenshot: Jerry West "18m" with no visible link to
          // who covers his other 30 — "brak dokładnej rotacji", "rotacja jako jedna statystyka w
          // oddzielnej linii źle wygląda"): the original "Starting five" row / "Bench" row split
          // read as two disconnected lists — you had to match position labels across two separate
          // groups by eye to see who actually backs up whom. Grouped by SLOT instead, one card per
          // position with every real contributor stacked inside (starter first, then by minutes) —
          // same shape as the hero's own "Rotation" panel above (`results-hero-rotation-columns`),
          // so a slot's full picture (e.g. West 18m / White 30m, both SG) reads at a glance instead
          // of needing to be reassembled from two separate rows.
          const bySlot = STARTER_SLOTS.map((slot) => ({
            slot,
            rows: roster
              .filter((row) => row.position === slot)
              .sort((a, b) => (a.isStarter === b.isStarter ? b.minutes - a.minutes : a.isStarter ? -1 : 1)),
          })).filter((group) => group.rows.length > 0);
          return (
            <div className="share-modal-roster">
              <span className="share-modal-roster-label">Roster &amp; rotation</span>
              <div className="share-modal-face-row">
                {bySlot.map(({ slot, rows }) => (
                  <div className="share-modal-face-group" key={slot}>
                    <span className="share-modal-face-group-label">{slot}</span>
                    {rows.filter((row) => row.minutes > 0 && (row.isStarter || row.minutes >= SPOT_MINUTES)).map((row) => (
                      <div className="share-modal-face-card" key={`${row.position}-${row.name}`}>
                        <Face name={row.name} size="sm" />
                        <span className="share-modal-face-info">
                          <span className="share-modal-face-name">{shortenName(row.name, 11)}</span>
                          <span className="share-modal-face-meta">
                            <span>{Math.round(row.minutes)}m</span>
                            <span className="share-modal-face-caps">{row.fga.toFixed(1)} caps</span>
                          </span>
                        </span>
                      </div>
                    ))}
                    {rows.some((row) => row.minutes > 0 && !row.isStarter && row.minutes < SPOT_MINUTES) && (
                      <span className="rotation-spot-line">
                        + {rows
                          .filter((row) => row.minutes > 0 && !row.isStarter && row.minutes < SPOT_MINUTES)
                          .map((row) => `${shortenName(row.name, 12)} ${Math.round(row.minutes)}m`)
                          .join(' · ')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        <div className="share-modal-save" data-share-exclude>
          <button type="button" className="primary-btn" onClick={saveImage} disabled={saveState === 'building'}>
            {saveState === 'building' ? 'Preparing image…' : '💾 Save image'}
          </button>
          {saveState === 'error' && <p className="share-modal-save-note">Couldn’t build the image here — take a screenshot instead.</p>}
          {savedImageUrl && (
            <>
              <p className="share-modal-save-note">If nothing downloaded, press and hold the image below to save it.</p>
              <img className="share-modal-save-preview" src={savedImageUrl} alt={`${teamName} result card`} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  // `borderBottomColor` only actually shows once `.subscores .score-chip` gives the chip a
  // visible bottom border (see App.css) — harmless to set unconditionally on the compact header
  // mini-chips too, which just never render a border to show it on.
  return (
    <span className="score-chip" style={{ background: qualityColor(value), color: '#fff', borderBottomColor: qualityColor(value) }}>
      <span className="score-chip-label">{label}</span>
      <span className="score-chip-value">{value}</span>
    </span>
  );
}

/** A labelled 0-100 bar for the Team-analysis profile row — a fill proportional to the value,
 * tinted by the same band ladder the score chips use, so a weak axis is a short red bar and a
 * strong one a long green bar without the reader parsing 8 numbers. */
/** 2026-09-25, user ("hover nad statystyką żeby użytkownik wiedział co jest czym"): the hint
 * used to live in a `title` attribute — invisible on phones, slow on desktop. It's a real tooltip
 * now: hover on desktop, tap/focus on touch (the row is focusable), with an "i" marker. */
function MetricBar({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`metric-bar${hint ? ' has-tip' : ''}`} tabIndex={hint ? 0 : undefined} aria-label={hint ? `${label} ${v}. ${hint}` : undefined}>
      <span className="metric-bar-label">
        {label}
        {hint && <span className="metric-bar-info" aria-hidden>i</span>}
      </span>
      <span className="metric-bar-track">
        <span className="metric-bar-fill" style={{ width: `${v}%`, background: qualityColor(v) }} />
      </span>
      <span className="metric-bar-value">{v}</span>
      {hint && <span className="metric-bar-tip" role="tooltip">{hint}</span>}
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
const BRACKET_CARD_W = 236;
const BRACKET_CARD_H = 46;
const BRACKET_ROW_UNIT = 58;
const BRACKET_COL_GAP = 22;
const BRACKET_COL_W = BRACKET_CARD_W + BRACKET_COL_GAP;

/** 2026-09-24: the bracket's size now follows the actual result (the simulated playoffs became
 * top-8, 3 rounds — see playoffSimulation.ts) instead of fixed 16-team constants. `leafCount` is
 * first-round matches per side, `roundsPerSide` every round except the shared Finals column. */
interface BracketLayout {
  leafCount: number;
  roundsPerSide: number;
  width: number;
  height: number;
}

function bracketLayout(result: PlayoffResult): BracketLayout {
  const roundsPerSide = Math.max(1, result.rounds.length - 1);
  const leafCount = Math.max(1, result.rounds[0].length / 2);
  return {
    leafCount,
    roundsPerSide,
    width: 2 * roundsPerSide * BRACKET_COL_W + BRACKET_CARD_W,
    height: leafCount * BRACKET_ROW_UNIT,
  };
}

/** Vertical center of match `indexInRound` within a round whose matches each span `2^round`
 * leaf-slots — first-round matches occupy exactly 1 slot each, the next round 2 slots, and so on.
 * A match's center is always exactly the midpoint of the two matches that feed it, by construction
 * of this doubling — no separate "connector midpoint" math needed beyond reusing this same function
 * one round up. */
function bracketMatchCenterY(round: number, indexInRound: number): number {
  const rowSpan = 2 ** round;
  return (indexInRound * rowSpan + rowSpan / 2) * BRACKET_ROW_UNIT;
}

/** Left edge x-position for a match card. `mirrored` (the right-side bracket) counts rounds in
 * from the far right instead of the far left, so the last round before the Finals sits nearest
 * the center column on both sides and the first round on the outside edge on both sides — the
 * actual visual shape a bracket is supposed to have. */
function bracketMatchX(round: number, mirrored: boolean, width: number): number {
  return mirrored ? width - BRACKET_CARD_W - round * BRACKET_COL_W : round * BRACKET_COL_W;
}

interface BracketTeamRowProps {
  team: Team | undefined;
  seed: number;
  isWinner: boolean;
}

// 2026-09-24, user-reported live ("nasz zespół powinien być lepiej zaznaczony"): the YOU tag used
// to sit INSIDE the ellipsis-truncated name, so a long name ("Wichita Mudcats…") cut it off, and
// series winners were drawn in the same blue the standings used for "you". Now: the human's row
// gets the red "you" treatment (tint + tag outside the truncated name), and a winner is marked by
// weight and a check, the loser dimmed — no colour shared with "you".
function BracketTeamRow({ team, seed, isWinner, games }: BracketTeamRowProps & { games: number }) {
  if (!team) return null;
  return (
    <div
      className={`bracket-team-row ${isWinner ? 'bracket-team-winner' : 'bracket-team-loser'} ${team.isHuman ? 'bracket-team-you' : ''}`}
      title={team.isHuman ? `${teamLabel(team)} (you)` : teamLabel(team)}
    >
      <span className="bracket-seed">#{seed}</span>
      <span className="bracket-team-name">{teamLabel(team)}</span>
      <span className="bracket-games">{games}</span>
    </div>
  );
}

// 2026-09-24, user-reported live ("dość brzydko"): the shared "4-3" badge floated over the
// second row (squeezing both names), and "you" was a tinted, struck-through row plus a big pill.
// Each row now carries its own game count (winner's in bold), and "you" is just the red accent:
// name colour + a thin left bar, with a thin red frame on the series.
function BracketMatchCard({
  series,
  teamById,
  style,
}: {
  series: PlayoffSeriesResult;
  teamById: (id: string) => Team | undefined;
  style?: React.CSSProperties;
}) {
  const teamA = teamById(series.teamAId);
  const teamB = teamById(series.teamBId);
  const involvesYou = Boolean(teamA?.isHuman || teamB?.isHuman);
  return (
    <div className={`bracket-match ${involvesYou ? 'bracket-match--you' : ''}`} style={style} title={series.roundLabel}>
      <BracketTeamRow team={teamA} seed={series.teamASeed} isWinner={series.winnerId === series.teamAId} games={series.gamesWonA} />
      <BracketTeamRow team={teamB} seed={series.teamBSeed} isWinner={series.winnerId === series.teamBId} games={series.gamesWonB} />
    </div>
  );
}

/** One sentence on how the human team's playoff run ended — the bracket alone only shows it in
 * the rounds it reached, so an early exit was easy to miss. */
function humanPlayoffRun(result: PlayoffResult, teamById: (id: string) => Team | undefined): string | null {
  const human = result.rounds.flat().find((s) => teamById(s.teamAId)?.isHuman || teamById(s.teamBId)?.isHuman);
  if (!human) return null;
  const humanId = teamById(human.teamAId)?.isHuman ? human.teamAId : human.teamBId;
  if (result.championId === humanId) return 'Your run: champions! 🏆';
  const lost = result.rounds.flat().find((s) => (s.teamAId === humanId || s.teamBId === humanId) && s.winnerId !== humanId);
  if (!lost) return null;
  const youAreA = lost.teamAId === humanId;
  const opponent = teamById(youAreA ? lost.teamBId : lost.teamAId);
  const own = youAreA ? lost.gamesWonA : lost.gamesWonB;
  const theirs = youAreA ? lost.gamesWonB : lost.gamesWonA;
  const seed = youAreA ? lost.teamBSeed : lost.teamASeed;
  const stage = lost.roundLabel === 'Finals' ? 'lost in the Finals' : `knocked out in the ${lost.roundLabel}`;
  return `Your run: ${stage}, ${own}-${theirs} vs #${seed} ${opponent ? teamLabel(opponent) : ''}.`;
}

/** Below this width the tree (even scaled) gets unreadable — rounds are listed top to bottom instead. */
const BRACKET_LIST_BREAKPOINT = 640;
/** Smallest the tree is ever scaled down to fit; narrower than that it scrolls sideways again. */
const BRACKET_MIN_SCALE = 0.72;

function PlayoffBracketTree({ result, teamById }: { result: PlayoffResult; teamById: (id: string) => Team | undefined }) {
  // 2026-09-24, user-reported live ("brak widoczności playoffs, trzeba przesuwać"): the tree is a
  // fixed-pixel layout (see the constants above) that was always wider than its modal, so it had
  // to be scrolled sideways. It's now scaled to the space it actually gets, and on a phone it
  // becomes a top-to-bottom list of rounds instead of an unreadably small tree.
  const containerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const layout = bracketLayout(result);
  const { roundsPerSide, width: BRACKET_WIDTH, height: BRACKET_HEIGHT } = layout;
  const finals = result.rounds[result.rounds.length - 1]?.[0];
  if (!finals) return null;

  // Each non-final round splits in half: the first half of its series feeds the left side of the
  // bracket, the second half the right (the engine plays rounds in seed order, so halves stay
  // together all the way to the Finals).
  const sideRounds = (half: 0 | 1) =>
    result.rounds.slice(0, roundsPerSide).map((round) => {
      const mid = round.length / 2;
      return half === 0 ? round.slice(0, mid) : round.slice(mid);
    });
  const sides: { mirrored: boolean; rounds: PlayoffSeriesResult[][] }[] = [
    { mirrored: false, rounds: sideRounds(0) },
    { mirrored: true, rounds: sideRounds(1) },
  ];

  const cards: { x: number; y: number; series: PlayoffSeriesResult }[] = [];
  const connectors: { key: string; d: string }[] = [];

  for (const { mirrored, rounds } of sides) {
    rounds.forEach((matches, round) => {
      matches.forEach((series, indexInRound) => {
        const x = bracketMatchX(round, mirrored, BRACKET_WIDTH);
        const y = bracketMatchCenterY(round, indexInRound);
        cards.push({ x, y, series });
      });
      // Connectors from this round's matches to the NEXT round's matches (the last side round
      // connects to the shared Finals card separately, below).
      if (round < roundsPerSide - 1) {
        const cardRightX = mirrored ? bracketMatchX(round, true, BRACKET_WIDTH) : bracketMatchX(round, false, BRACKET_WIDTH) + BRACKET_CARD_W;
        const nextLeftX = mirrored
          ? bracketMatchX(round + 1, true, BRACKET_WIDTH) + BRACKET_CARD_W
          : bracketMatchX(round + 1, false, BRACKET_WIDTH);
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

  // Last side round -> Finals: both of those winners sit at the vertical center (each spans its
  // side's full height), the same center-Y the Finals card uses, so these are straight lines.
  const finalsX = BRACKET_WIDTH / 2 - BRACKET_CARD_W / 2;
  const finalsY = BRACKET_HEIGHT / 2;
  const leftLastRightX = bracketMatchX(roundsPerSide - 1, false, BRACKET_WIDTH) + BRACKET_CARD_W;
  const rightLastLeftX = bracketMatchX(roundsPerSide - 1, true, BRACKET_WIDTH);
  connectors.push({ key: 'left-final', d: `M${leftLastRightX},${finalsY} H${finalsX}` });
  connectors.push({ key: 'right-final', d: `M${rightLastLeftX},${finalsY} H${finalsX + BRACKET_CARD_W}` });
  cards.push({ x: finalsX, y: finalsY, series: finals });

  const champion = teamById(result.championId);

  const runLine = humanPlayoffRun(result, teamById);
  const championLine = champion && (
    <p className={`playoff-champion ${champion.isHuman ? 'playoff-champion--you' : ''}`}>
      🏆 Champion: {teamLabel(champion)} {champion.isHuman ? '(You)' : ''}
    </p>
  );

  if (available !== null && available < BRACKET_LIST_BREAKPOINT) {
    return (
      <div className="bracket-scroll" ref={containerRef}>
        {runLine && <p className="playoff-run">{runLine}</p>}
        {result.rounds.map((round, i) => (
          <div className="bracket-list-round" key={i}>
            <span className="bracket-list-round-label at-cond">{round[0]?.roundLabel}</span>
            <div className="bracket-list-grid">
              {round.map((series) => (
                <BracketMatchCard key={`${series.teamAId}-${series.teamBId}`} series={series} teamById={teamById} />
              ))}
            </div>
          </div>
        ))}
        {championLine}
      </div>
    );
  }

  const treeHeight = BRACKET_HEIGHT + BRACKET_CARD_H;
  const scale = available === null ? 1 : Math.min(1, Math.max(BRACKET_MIN_SCALE, available / BRACKET_WIDTH));

  return (
    <div className="bracket-scroll" ref={containerRef}>
      {runLine && <p className="playoff-run">{runLine}</p>}
      <div style={{ width: BRACKET_WIDTH * scale, height: treeHeight * scale }}>
      <div
        className="bracket-tree"
        style={{ width: BRACKET_WIDTH, height: treeHeight, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
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
        {cards.map(({ x, y, series }) => (
          <BracketMatchCard
            key={`${series.teamAId}-${series.teamBId}`}
            series={series}
            teamById={teamById}
            style={{ position: 'absolute', left: x, top: y - BRACKET_CARD_H / 2, width: BRACKET_CARD_W, height: BRACKET_CARD_H }}
          />
        ))}
      </div>
      </div>
      {championLine}
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
        secondaryPositions: realSecondaryPositions(p),
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

/** 2026-09-24: one concrete thing to try next draft, keyed to the human team's weakest score —
 * the results screen used to show the numbers (often a harsh 16th/16, 0% everywhere) without
 * ever saying what to do differently. */
const NEXT_DRAFT_TIP: Record<string, string> = {
  Talent: 'Your top-end talent was the gap. Spend your early picks on the best player available, then fill needs later.',
  'Bench Depth': 'Your bench gave back too much. Keep some caps for the last rounds so your 6th–9th men can actually play.',
  Offense: "Your offense stalled. Draft at least one real shot creator, and don't stack non-shooters in the starting five.",
  Defense: "Defense sank this team. Opponents hunt stars who can't defend — spend a mid-round pick on a rim protector or a wing stopper.",
  Spacing: 'The floor was too cramped. Put two or three real outside shooters around your stars.',
  Fit: "The pieces overlapped. Too many players who need the ball, or who do the same job — balance creators, shooters and defenders.",
  Rotation: 'Your rotation cost you. Start players at their own positions and don’t play anyone more minutes than he can handle.',
};

/** 2026-09-25, user-reported ("Too many players needed the ball — nie jest to skład który wymaga
 * dużo piłki"): Fit blends ten separate components, so one generic "too many ball-dominant
 * players" line was wrong whenever creation wasn't the problem (that roster had Creation 95 and
 * Spacing fit 95; Switchability and Rim pressure were the real gaps). The Fit tip now names the
 * weakest component. */
const FIT_COMPONENT_TIP: Record<keyof FitScoreResult['components'], string> = {
  creationStructure: 'The ball had too many owners, or none. Build around one or two creators and surround them with finishers and shooters.',
  spacingCompatibility: 'Your non-shooters got in each other’s way. Pair every big who can’t shoot with shooters, not with another non-shooter.',
  defensiveRoleCoverage: 'A defensive job was left empty. Make sure you have both a rim protector and a wing who can take the other team’s best scorer.',
  switchability: 'Your lineup couldn’t switch. Opponents drag your slowest big or smallest guard into pick-and-rolls — add defenders who can guard several positions.',
  huntResistance: 'Opponents had someone to pick on. Every weak defender you start becomes their go-to matchup — cover him or bench him.',
  defensiveCohesion: 'Your defenders didn’t add up to a unit. Anchor the paint and the perimeter together instead of stacking one kind of stopper.',
  rimPressureTeam: 'Nobody attacked the rim. Add a slasher or a big who finishes inside and draws fouls, so the defense can’t just stay home on shooters.',
  reboundingBalance: 'You lost the glass. Start at least one real rebounder in the frontcourt.',
  sizeCoverage: 'You were too small for your positions. Bigger bodies at the forward spots stop teams from bullying you inside.',
  championshipStructure: 'There was no clear pecking order. Title teams have one or two stars and role players who fit around them.',
};

function nextDraftTip(label: string, team: Team): string | undefined {
  if (label !== 'Fit') return NEXT_DRAFT_TIP[label];
  const components = fitScore(team).components;
  const [weakest] = (Object.entries(components) as [keyof typeof components, number][]).sort((a, b) => a[1] - b[1])[0] ?? [];
  return weakest ? FIT_COMPONENT_TIP[weakest] : NEXT_DRAFT_TIP.Fit;
}

/**
 * One tile per position with every contributor's face, name and minutes — the hero's Rotation
 * panel, and (since 2026-09-24) every team's own Rotation section in the ranking below. `detailed`
 * adds each player's TAL, a total when a player is split across positions, and the natural
 * position of anyone playing a real mismatch (same `< 0.9` fit bar `rotationScore` uses).
 */
function RotationColumns({
  assignments,
  starterKeys,
  totalMinutesByPlayerId,
  detailed = false,
}: {
  assignments: ResolvedSlotAssignment[];
  starterKeys: Set<string>;
  totalMinutesByPlayerId?: Map<string, number>;
  detailed?: boolean;
}) {
  return (
    <div className={`results-hero-rotation-columns ${detailed ? 'rotation-columns--detailed' : ''}`}>
      {STARTER_SLOTS.map((slot) => {
        const entries = assignments
          .filter((a) => a.slot === slot)
          .sort((a, b) => {
            const aIsStarter = starterKeys.has(`${a.slot}|${a.player.id}`);
            const bIsStarter = starterKeys.has(`${b.slot}|${b.player.id}`);
            if (aIsStarter !== bIsStarter) return aIsStarter ? -1 : 1;
            return b.minutes - a.minutes;
          });
        // 2026-09-25, user ("trzeba coś z tymi graczami po 2 minuty zrobić, psują wizualnie"): a
        // backup with a few spot minutes at a slot no longer gets a full row — they're listed on
        // one quiet line under the column; zero-minute rows are dropped.
        const isSpot = (e: ResolvedSlotAssignment) =>
          e.minutes < SPOT_MINUTES && !starterKeys.has(`${e.slot}|${e.player.id}`);
        const spot = entries.filter((e) => e.minutes > 0 && isSpot(e));
        return (
          <div className="results-hero-rotation-col" key={slot}>
            <span className="results-hero-rotation-col-label">{slot}</span>
            {entries.filter((e) => e.minutes > 0 && !isSpot(e)).map((e) => {
              const total = totalMinutesByPlayerId?.get(e.player.id) ?? e.minutes;
              const offPosition = positionFitMultiplier(e.player, slot) < 0.9;
              return (
                <div className="results-hero-rotation-entry" key={e.player.id} title={`${e.player.playerName} (${e.player.spanLabel})`}>
                  <Face name={e.player.playerName} size="sm" />
                  <span className="results-hero-rotation-entry-info">
                    <span className="results-hero-rotation-entry-name">
                      {shortenName(e.player.playerName, 12)}
                      {detailed && offPosition && (
                        <sup className="rotation-natural-pos" title={`Natural position: ${e.player.primaryPosition}`}>
                          {e.player.primaryPosition}
                        </sup>
                      )}
                    </span>
                    <span className="results-hero-rotation-entry-min">
                      {Math.round(e.minutes)}m
                      {detailed && total !== e.minutes && <span className="rotation-entry-total"> · {Math.round(total)} total</span>}
                    </span>
                  </span>
                  {detailed && (
                    <span className="rotation-entry-tal" style={{ background: qualityColor(displayTalentForSpan(tierContextFor(e.player))) }}>
                      {displayTalentForSpan(tierContextFor(e.player))}
                    </span>
                  )}
                </div>
              );
            })}
            {spot.length > 0 && (
              <span className="rotation-spot-line" title="Spot minutes at this position">
                + {spot.map((e) => `${shortenName(e.player.playerName, 12)} ${Math.round(e.minutes)}m`).join(' · ')}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Rotation players below their slot's value are named under the hero's Defense details.
 * 2026-09-26, the user ("50 dla słabego obrońcy zbyt ogólne, zależy od pozycji"; then, of a bottom-
 * third cut, "zbyt mało surowe"): the MEDIAN D-TAL of rotation-calibre spans (TAL 55+) at each
 * position — a C at 55 is a below-average C, a PG at 45 a below-average PG.
 */
const WEAK_DEFENDER_DTAL: Record<Position, number> = { PG: 49, SG: 43, SF: 47, PF: 58, C: 61 };
/** Below this many minutes at a slot, a non-starter is shown on the column's spot line. */
const SPOT_MINUTES = 6;

function ResultsVerdict({
  team,
  rank,
  fieldSize,
  breakdown,
  scores,
  onNewDraft,
  onRematch,
  onMenu,
}: {
  team: Team;
  fieldSize: number;
  breakdown: ScoreBreakdown;
  /** Final ranking place — the card's tone follows it (2026-09-24, user-reported live: "wygrałem,
   * czy jest sens żeby mnie pouczało?" — a champion got a "what held you back" list and a
   * "Next draft:" lecture). 1st: why you won + the one thing a rival could exploit, no advice.
   * 2nd-4th: the tip becomes "to get over the top". Everyone else: as before. */
  rank: number;
  scores: Record<string, number>;
  onNewDraft?: () => void;
  onRematch?: () => void;
  onMenu: () => void;
}) {
  const insights = useMemo(
    () => generateRosterInsights(buildTeamFeatureSnapshot(team), undefined, insightContextFor(breakdown, rank, fieldSize)),
    [team, breakdown, rank, fieldSize],
  );
  const won = rank === 1;
  const contender = rank > 1 && rank <= 4;
  const strengths = insights.strengths.slice(0, won ? 3 : 2);
  const concerns = insights.concerns.slice(0, won ? 1 : 2);
  const [weakestLabel] = Object.entries(scores).sort((a, b) => a[1] - b[1])[0] ?? [];
  const tip = !won && weakestLabel ? nextDraftTip(weakestLabel, team) : undefined;
  const title = won ? 'Why you won' : 'Why you finished here';
  return (
    <section className={`results-verdict ${won ? 'results-verdict--won' : ''}`} aria-label={title}>
      <h2 className="results-verdict-title at-cond">{title}</h2>
      <div className="results-verdict-cols">
        {strengths.length > 0 && (
          <div className="results-verdict-col results-verdict-col--good">
            <span className="results-verdict-label">{won ? 'What won it' : 'What worked'}</span>
            <ul>
              {strengths.map((i) => (
                <li key={i.id}>{i.message}</li>
              ))}
            </ul>
          </div>
        )}
        {concerns.length > 0 && (
          <div className="results-verdict-col results-verdict-col--bad">
            <span className="results-verdict-label">{won ? 'Where a rival could still hurt you' : 'What held you back'}</span>
            <ul>
              {concerns.map((i) => (
                <li key={i.id}>{i.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {tip && (
        <p className="results-verdict-tip">
          <b>{contender ? 'To get over the top:' : 'Next draft:'}</b> {tip}
        </p>
      )}
      <div className="results-verdict-actions">
        {onNewDraft && (
          <button type="button" className="primary-btn" onClick={onNewDraft}>
            New draft
          </button>
        )}
        {onRematch && (
          <button type="button" className="secondary-btn" onClick={onRematch} title="Same 16 teams, same draft order — try a different plan.">
            Rematch this board
          </button>
        )}
        <button type="button" className="secondary-btn" onClick={onMenu}>
          Main menu
        </button>
      </div>
    </section>
  );
}

export default function ResultsScreen({ teams, history, onRestart, onRematch, draftSeed, challenger }: Props) {
  // Lookups used inside render loops (matchup opponents, draft-order rows, the bracket tree) —
  // Maps, not repeated `.find` over `teams` / the 9451-span `draftPool`.
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const teamById = (id: string) => teamsById.get(id);
  const draftPoolById = useMemo(() => new Map(draftPool.map((p) => [p.id, p])), []);
  const playerById = (id: string) => draftPoolById.get(id);
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
  // 2026-09-18, user-reported live ("może zamiast rozwijanej listy, niech to będzie popup, po
  // symulacji można zamknąć i zamiast 'simulate season' w tym samym miejscu będzie 'see season
  // results'" — a popup instead of an inline-growing list; closeable, with the trigger button
  // relabeling itself once a result exists): the standings table + playoff bracket used to render
  // inline and grow the whole panel tall the moment a season existed. Opens on the FIRST simulate
  // click (so the payoff is immediate) and again on any later "See season results" click; closing
  // it never discards `seasonStandings`/`playoffResult` — same "no re-roll once a result exists"
  // rule as before, just now reachable without permanently occupying page space.
  const [seasonModalOpen, setSeasonModalOpen] = useState(false);
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
  // 2026-09-14, user-reported live (asking for more background simulation so results feel more
  // real): one shared per-team cache (overall/netRating/huntingPotential/huntability — see
  // `buildMatchupCache`'s own docstring, seasonSimulation.ts) built ONCE per completed draft.
  // Replaces the narrower `overallByTeamId` this screen used to build just for the season/playoff
  // sim buttons — profiling found `fitScore` (read here for `huntingPotential`), not `overall`, was
  // the real dominant cost of every matchup projection, and this same cache is what makes both
  // background features below (the Title Odds precision upgrade and the season-sim pool) actually
  // affordable instead of blocking the main thread for seconds.
  const matchupCache = useMemo(() => buildMatchupCache(scoredTeams), [scoredTeams]);

  // 2026-09-14, user-reported live: Title Odds used to be a single 500-trial Monte Carlo estimate,
  // chosen specifically because the engine's real 20,000-trial default used to take ~1s and would
  // have blocked the results screen's first paint. Now that `matchupCache` above eliminates the
  // real bottleneck (`fitScore` re-derived per pair, not `evaluateLeague`'s own trial count —
  // measured, `scripts/_simPerfDiag.ts`, run once and discarded), the 500-trial pass below still
  // renders instantly, but a second, precise pass at the engine's own full default now runs once
  // the browser is idle and REPLACES it — the user watches the page immediately, then the odds
  // quietly firm up to the real number a moment later. `useAnimatedNumber` below turns that swap
  // into a visible tween instead of a silent jump.
  const fastLeagueEval = useMemo(() => evaluateLeague(scoredTeams, FAST_TITLE_ODDS_SIMULATIONS), [scoredTeams]);
  const [preciseLeagueEval, setPreciseLeagueEval] = useState<TeamLeagueEvaluation[] | null>(null);
  useEffect(() => {
    setPreciseLeagueEval(null);
    const handle = scheduleIdle(() => setPreciseLeagueEval(evaluateLeague(scoredTeams, PRECISE_TITLE_ODDS_SIMULATIONS)));
    return () => cancelIdle(handle);
  }, [scoredTeams]);
  const leagueEval = preciseLeagueEval ?? fastLeagueEval;
  const leagueEvalByTeamId = useMemo(() => new Map(leagueEval.map((entry) => [entry.teamId, entry])), [leagueEval]);

  // 2026-09-14, user-reported live ("chodzi mi o większą liczbę symulacji w tle żeby wynik był
  // bardziej realny" — more background simulations so the result feels more real): a background
  // pool of real, independent `simulateSeason` rolls (same unchanged primitive — see its own
  // docstring, seasonSimulation.ts) computed once idle. "Simulate an 82-game season" below no
  // longer rolls one arbitrary season on click; it reveals whichever pool entry landed closest to
  // the pool's own median win total for the human's team — still one genuine, concrete season with
  // real standings, just a REPRESENTATIVE one instead of an arbitrary one. Falls back to a single
  // direct roll if the pool isn't ready yet (a very fast click, or `requestIdleCallback` never
  // firing) so the button always works. A deliberate, CONFIRMED reversal of this screen's own
  // earlier "simulate once, don't average many seasons" choice (AskUserQuestion, this session) —
  // not a silent regression of it.
  const [seasonPool, setSeasonPool] = useState<SeasonStandingsRow[][] | null>(null);
  useEffect(() => {
    setSeasonPool(null);
    const handle = scheduleIdle(() => {
      const pool: SeasonStandingsRow[][] = [];
      for (let i = 0; i < SEASON_SIM_POOL_SIZE; i++) pool.push(simulateSeason(scoredTeams, matchupCache));
      setSeasonPool(pool);
    });
    return () => cancelIdle(handle);
  }, [scoredTeams, matchupCache]);

  // The one roster this screen exists to show off — the player's own, or (a defensive fallback for
  // a no-human commissioner draft) the Final Power Ranking's #1. Drives the hero header below.
  const heroRanked = ranked.find(({ team }) => team.isHuman) ?? ranked[0];
  const heroFit = useMemo(
    () => (heroRanked ? fitScore(displayTeam(heroRanked.team)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heroRanked?.team.id, scoredTeams],
  );
  // 2026-09-14, user-reported live ("można dodać ławkę, offensive and defensive breakdown... to ma
  // być dashboard jako podsumowanie całego draftu") — same O-TAL/Creation/Spacing/Rim-pressure
  // split the per-team "Team analysis" accordion already computes for `offenseDetail` below, just
  // hoisted up here so the hero dashboard can show it unconditionally instead of only after
  // expanding the human's own card further down the page.
  const heroOffenseDetail = useMemo(
    () => (heroRanked ? offenseScoreBreakdown(displayTeam(heroRanked.team)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heroRanked?.team.id, scoredTeams],
  );
  const heroStyle = teamStyleFor(
    heroFit?.inputs.primaryArchetype,
    heroFit?.inputs.secondaryArchetype,
    heroFit?.inputs.archetypeReport?.failureMode ?? null,
    heroRanked?.breakdown.defenseScore ?? 0,
  );
  // 2026-09-25, user-reported live ("super skład, dlaczego dostał tak po dupie w defense?"): the
  // Defense score is a minutes-weighted D-TAL average, so one or two weak defenders playing big
  // minutes drag it down — and nothing on screen said who. Rotation players (15+ min) under
  // `WEAK_DEFENDER_DTAL` for the slot they play most, furthest below it first, at most two.
  const heroWeakDefenders = useMemo(() => {
    if (!heroRanked) return [];
    const minutes = new Map<string, { player: ResolvedSlotAssignment['player']; minutes: number; bySlot: Map<Position, number> }>();
    for (const entry of allAssignments(displayTeam(heroRanked.team))) {
      const row = minutes.get(entry.player.id) ?? { player: entry.player, minutes: 0, bySlot: new Map<Position, number>() };
      row.minutes += entry.minutes;
      row.bySlot.set(entry.slot, (row.bySlot.get(entry.slot) ?? 0) + entry.minutes);
      minutes.set(entry.player.id, row);
    }
    return [...minutes.values()]
      .filter((row) => row.minutes >= 15)
      .map((row) => {
        const slot = [...row.bySlot.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const dtal = Math.round(computeDefensiveTalent(row.player));
        return { name: row.player.playerName, slot, dtal, minutes: Math.round(row.minutes), gap: WEAK_DEFENDER_DTAL[slot] - dtal };
      })
      .filter((row) => row.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroRanked?.team.id, scoredTeams]);
  // 2026-09-16, user-reported live ("zamiast starting 5 i bench, zróbmy tylko rotation i 5 kolumn
  // z pozycjami i minutami"): the hero's own "Starting five"/"Bench" split named a player's
  // CARD position (their primary position for bench rows — see `heroRoster` above), not which
  // SLOT(s) they actually play minutes at, so a combo guard backing up two positions would only
  // ever show once, under one label. Same per-slot shape the "Rotation" accordion further down
  // already builds (`allAssignments`, grouped by `STARTER_SLOTS`) — reused directly rather than
  // reshaping `heroRoster`, so a player split across slots shows under every slot they actually
  // cover, exactly like that accordion already does.
  const heroAssignments: ResolvedSlotAssignment[] = useMemo(
    () => (heroRanked ? allAssignments(displayTeam(heroRanked.team)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heroRanked, correctedRotations],
  );
  // 2026-09-16, user-reported live ("KD był starterem a pokazuje Iguodale w s5"): the hero
  // Rotation panel's own entries were sorted purely by minutes, unlike the "Rotation" accordion
  // further down (which already keys off `primaryStarters` — see `starterKeys` there). Whenever a
  // bench player's actual minutes exceed the real starter's (a durability cap, an injury-style
  // rotation correction, etc.), the higher-minutes bench name floated to the TOP of the column,
  // reading as "this is the starter" even though the real lineup slot is still the other player.
  // Same fix, same shape as the accordion's `starterKeys` — computed once here and reused by the
  // hero panel's own sort below instead of duplicating `primaryStarters` a second time.
  const heroStarterKeys: Set<string> = useMemo(
    () => new Set(heroRanked ? primaryStarters(displayTeam(heroRanked.team)).map((entry) => `${entry.slot}|${entry.player.id}`) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heroRanked, correctedRotations],
  );
  // 2026-09-18, user-reported live (screenshot: Jerry West showing "18m" with no visible pairing
  // to who covers his other 30, "brak dokładnej rotacji") — this used to be built separately from
  // `primaryStarters`/`benchWithMinutes`, labelling each bench row with the player's own
  // `primaryPosition` rather than the SLOT they actually cover. That's approximate at best (right
  // only when a bench player's natural position happens to match his backup slot) and can't
  // represent a combo backup covering two slots at all — exactly the gap the hero's own "Rotation"
  // panel above solved by switching to real per-slot `allAssignments` data. Rebuilt directly from
  // `heroAssignments`/`heroStarterKeys` instead of recomputing a second, looser approximation, so
  // the share modal/PNG's roster can never again disagree with what the on-screen Rotation panel
  // already shows.
  const heroRoster: ShareRosterRow[] = useMemo(() => {
    if (!heroRanked) return [];
    const assigned: ShareRosterRow[] = heroAssignments.map((a) => ({
      position: a.slot,
      name: a.player.playerName,
      fga: a.player.fga,
      minutes: a.minutes,
      isStarter: heroStarterKeys.has(`${a.slot}|${a.player.id}`),
    }));
    // `heroAssignments` only carries players the rotation actually gave minutes to — a genuine
    // 0-minute deep-bench roster spot (see `benchWithMinutes`'s own docstring: "including 0-minute
    // deep bench") never appears there at all. Fall back to the player's own `primaryPosition` for
    // exactly that remainder, same as before, so the roster still shows all 9 picks rather than
    // silently dropping whoever isn't in the active rotation.
    const assignedIds = new Set(heroAssignments.map((a) => a.player.id));
    const deepBench: ShareRosterRow[] = displayTeam(heroRanked.team).roster
      .filter((p) => !assignedIds.has(p.id))
      .map((p) => ({ position: p.primaryPosition, name: p.playerName, fga: p.fga, minutes: 0, isStarter: false }));
    return [...assigned, ...deepBench];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroAssignments, heroStarterKeys, heroRanked]);
  // Still needed for `HeroResult`'s own "Challenge a friend" link (`copyChallengeLink`'s `cs` param)
  // and the challenge-comparison table's per-slot name lookup — unrelated to the removed PNG/
  // ShareModal-headshot-row use, which is the only consumer that went away with it.
  const heroStarters: ShareCardStarter[] = useMemo(
    () => heroRoster.filter((row) => row.isStarter).map((row) => ({ position: row.position, name: row.name })),
    [heroRoster],
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

  // 2026-09-18, user-reported live (see `seasonModalOpen`'s own docstring above for the full
  // "popup instead of inline" story, and `seasonSimSlot`'s docstring on `HeroResult` for why this
  // whole thing is built here and handed down as one prop): the compact trigger always renders at
  // the same size whether or not a result exists — only the modal's own presence varies — which is
  // what lets it live inside the hero's Rotation column without ever pushing that column's height
  // around.
  const seasonSimSlot = (
    <div className="season-sim-panel">
      <h3>{seasonStandings ? 'Season results' : 'Simulate an 82-game season'}</h3>
      <p className="player-notes-hint">
        Rolls a full regular season, game by game, using each pairing's real projected win probability — the roll shown
        is whichever of {SEASON_SIM_POOL_SIZE} background simulations landed closest to the typical outcome for your
        team. Separate from the final ranking above.
      </p>
      <button
        className="primary-btn season-sim-btn"
        onClick={() => {
          if (!seasonStandings) {
            // 2026-09-14: prefers the background pool's representative pick; falls back to one
            // direct roll on the rare chance the pool hasn't finished yet (a very fast click, or
            // `requestIdleCallback` never firing) so the button always works either way.
            const humanTeamId = scoredTeams.find((team) => team.isHuman)?.id;
            const picked = seasonPool && humanTeamId
              ? pickRepresentativeSeason(seasonPool, humanTeamId)
              : simulateSeason(scoredTeams, matchupCache);
            setSeasonStandings(picked);
            setPlayoffResult(null);
          }
          setSeasonModalOpen(true);
        }}
      >
        {seasonStandings ? '📊 See season results' : '🏀 Simulate an 82-game season'}
      </button>
      {seasonModalOpen && seasonStandings && (
        <div className="season-sim-backdrop" onClick={() => setSeasonModalOpen(false)}>
          <div
            className={`season-sim-modal ${playoffResult ? 'season-sim-modal--wide' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="Season results"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="season-sim-close" aria-label="Close" onClick={() => setSeasonModalOpen(false)}>
              ✕
            </button>
            <h3>Season results</h3>
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
                    <tr
                      key={row.teamId}
                      className={`${rowTeam.isHuman ? 'season-standings-you' : ''} ${row.rank === PLAYOFF_TEAM_COUNT ? 'season-standings-cutoff' : ''} ${row.rank > PLAYOFF_TEAM_COUNT ? 'season-standings-out' : ''}`}
                    >
                      <td>{row.rank}</td>
                      <td>
                        {teamLabel(rowTeam)}
                        {rowTeam.isHuman && <span className="bracket-you-tag">YOU</span>}
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
                className="primary-btn playoff-sim-btn"
                onClick={() => setPlayoffResult(simulatePlayoffs(scoredTeams, seasonStandings, matchupCache))}
              >
                🏆 Simulate the playoffs
              </button>
            )}
            {/* 2026-09-24: only the season's top 8 make these playoffs (playoffSimulation.ts). */}
            <p className="season-playoff-note">
              {(() => {
                const humanRow = seasonStandings.find((row) => teamById(row.teamId)?.isHuman);
                if (!humanRow) return `Top ${PLAYOFF_TEAM_COUNT} make the playoffs.`;
                return humanRow.rank <= PLAYOFF_TEAM_COUNT
                  ? `Top ${PLAYOFF_TEAM_COUNT} make the playoffs — you're in as the #${humanRow.rank} seed.`
                  : `Top ${PLAYOFF_TEAM_COUNT} make the playoffs — you finished ${humanRow.rank}th and missed out.`;
              })()}
            </p>
            {playoffResult && <PlayoffBracketTree result={playoffResult} teamById={teamById} />}
          </div>
        </div>
      )}
    </div>
  );

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
          talentScore={heroRanked.breakdown.talentScore}
          benchDepthScore={heroRanked.breakdown.benchDepthScore}
          offenseScore={heroRanked.breakdown.offenseScore}
          defenseScore={heroRanked.breakdown.defenseScore}
          spacingScore={heroRanked.breakdown.spacingScore}
          fitScore={heroRanked.breakdown.fitScore}
          rotationScore={heroRanked.breakdown.rotationScore}
          fitDetail={heroFit}
          offenseDetail={heroOffenseDetail}
          assignments={heroAssignments}
          starterKeys={heroStarterKeys}
          topOverall={ranked[0]?.breakdown.overall ?? null}
          titleOdds={leagueEvalByTeamId.get(heroRanked.team.id)?.championshipProbability ?? null}
          draftSeed={draftSeed}
          challenger={challenger}
          seasonSimSlot={seasonSimSlot}
          identity={heroStyle.label}
          failureMode={heroStyle.failureMode}
          weakDefenders={heroWeakDefenders}
          comp={heroRanked && heroFit ? bestHistoricalComp(displayTeam(heroRanked.team), heroRanked.breakdown, heroFit) : null}
          defenseTalent={heroRanked ? Math.round(teamDefensiveTalentScore(displayTeam(heroRanked.team))) : null}
          starters={heroStarters}
          roster={heroRoster}
        />
      )}
      {heroRanked?.team.isHuman && (
        <ResultsVerdict
          team={displayTeam(heroRanked.team)}
          rank={heroRanked.rank}
          fieldSize={ranked.length}
          breakdown={heroRanked.breakdown}
          scores={{
            Talent: heroRanked.breakdown.talentScore,
            'Bench Depth': heroRanked.breakdown.benchDepthScore,
            Offense: heroRanked.breakdown.offenseScore,
            Defense: heroRanked.breakdown.defenseScore,
            Spacing: heroRanked.breakdown.spacingScore,
            Fit: heroRanked.breakdown.fitScore,
            Rotation: heroRanked.breakdown.rotationScore,
          }}
          onNewDraft={onRematch ? () => onRematch() : undefined}
          onRematch={onRematch ? () => onRematch(draftSeed) : undefined}
          onMenu={onRestart}
        />
      )}
      {/* 2026-09-14, user-reported live ("ogromnie dużo miejsca na dużym ekranie, można zrobić
          cały dashboard"): FIRST version of this fix put the matchup matrix + season sim in a
          persistent sidebar next to the (much longer) team-card list. User-reported live again,
          against a real screenshot: the matrix still got cut off inside that narrower column (it
          wants real width — `.matchup-matrix-table`'s own 760px floor), and a sidebar that runs out
          of content halfway down a 16-card list reads as an awkward, unbalanced split rather than a
          real dashboard — "jesteśmy w stanie zmieścić wszystkie informacje na samej górze, nie
          widzę sensu w rozbijaniu tego" (we can fit it all at the top, no point splitting this).
          Reworked into `.results-top-panels`: the matrix + season sim sit side by side in one
          full-width band right under the hero, each finally getting real width instead of sharing a
          cramped column — the team-card list below goes back to full width too, since there's no
          longer a second column competing with it for space. Below the dashboard breakpoint
          `.results-top-panels` is `display: contents` (pure CSS, no JS) — its children become
          direct flex items of `.results-screen` again, same `order`-based placement (this file's
          own CSS, unchanged) as before any of this dashboard work existed. */}
      {/* 2026-09-18, user-reported live ("simulate season można dać nad rotacją... dzięki temu
          można zmieścić matchups bez potrzeby suwaka" — freeing full width removes the need for
          the matrix's own horizontal scroll slider): the season-sim panel that used to share this
          row moved into the hero's Rotation column (see `seasonSimSlot` above) once it became a
          small, fixed-size popup trigger instead of an inline-growing table — the matrix no longer
          has anything to share this row with, so it renders alone at full width. */}
      <MatchupMatrix teams={scoredTeams} evaluations={leagueEval} focusTeamId={scoredTeams.find((team) => team.isHuman)?.id} />
      <h2 className="results-section-title">Final team ranking</h2>
      <div className="expand-all-controls">
        <button className="secondary-btn retro-btn" onClick={() => setExpandedTeamIds(new Set(teams.map((t) => t.id)))}>
          Expand all
        </button>
        <button
          className="secondary-btn retro-btn"
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
        const insights = isExpanded
          ? generateRosterInsights(buildTeamFeatureSnapshot(shownTeam), undefined, insightContextFor(breakdown, rank, ranked.length))
          : null;
        return (
          <div key={team.id} className={`team-result rank-${rank} ${team.isHuman ? 'is-human-team' : ''} ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}>
            <button className="team-result-header" onClick={() => toggleExpanded(team.id)} aria-expanded={isExpanded}>
              <span className="team-result-toggle">{isExpanded ? '▾' : '▸'}</span>
              <span className="team-result-title">
                #{rank} — {teamLabel(team)} {team.isHuman ? '(You)' : ''}
              </span>
              <ScoreChip label="Rating" value={breakdown.overall} />
              {!isExpanded && (
                <span className="team-result-header-mini">
                  <ScoreChip label="TAL" value={breakdown.talentScore} />
                  <ScoreChip label="OFF" value={breakdown.offenseScore} />
                  <ScoreChip label="DEF" value={breakdown.defenseScore} />
                  {leagueEvalRow && (
                    <span
                      className="mini-fact"
                      title="Title odds: how often this team won a 16-team bracket of best-of-7 series, simulated 20,000 times. Each series is decided by projected point differential and how the two teams match up — not by the Rating — so two teams with the same Rating can have very different odds."
                    >
                      🏆 {(leagueEvalRow.championshipProbability * 100).toFixed(1)}%
                    </span>
                  )}
                </span>
              )}
            </button>
            {isExpanded && (
              <div className="team-result-body">
                <div className="subscores">
                  <ScoreChip label="Talent" value={breakdown.talentScore} />
                  <ScoreChip label="Bench" value={breakdown.benchDepthScore} />
                  <ScoreChip label="Offense" value={breakdown.offenseScore} />
                  <ScoreChip label="Defense" value={breakdown.defenseScore} />
                  <ScoreChip label="Spacing" value={breakdown.spacingScore} />
                  <ScoreChip label="Fit" value={breakdown.fitScore} />
                  <ScoreChip label="Rotation" value={breakdown.rotationScore} />
                  <span className="fga-spent"><CapIcon /> Caps spent: {totalFga.toFixed(1)} / {CAP_LIMIT}</span>
                </div>
                {/* 2026-09-11, Scouting Report finding: Era Ball surfaces its named archetype tags
                    right on the player list; ours was only visible after opening "Team analysis".
                    Same data (`fitDetail.inputs.primaryArchetype`), already computed for this card
                    the moment it's expanded — just promoted up here instead of a second lookup.
                    2026-09-11 follow-up, user-reported live: "1 tag to też mało, trzeba więcej" +
                    "a ten opisek można dać tam gdzie jest drugi screen" — the engine already scores
                    up to 3 archetype matches (`championshipArchetype.ts`'s own `archetypes`,
                    `.slice(0, 3)`), this row was just reading the two singular
                    primary/secondaryArchetype fields instead of the full list, silently dropping
                    a real 3rd match when one existed. Maps the full array now, and the risk line
                    that used to live down in "Team analysis" as a separate "Identity:" paragraph
                    moved up here next to the tags it's actually describing. */}
                {fitDetail && fitDetail.inputs.championshipArchetypes.length > 0 && (
                  <div className="identity-chip-row">
                    {fitDetail.inputs.championshipArchetypes
                      .filter((entry) => entry.archetype !== 'Defensive superteam' || breakdown.defenseScore >= DEFENSE_FIRST_MIN_SCORE)
                      .map((entry, i) => (
                        <span key={entry.archetype} className={`identity-chip ${i > 0 ? 'identity-chip-secondary' : ''}`}>
                          {archetypeDisplayName(entry.archetype)}
                        </span>
                      ))}
                    {(() => {
                      const risk = teamStyleFor(
                        fitDetail.inputs.primaryArchetype,
                        fitDetail.inputs.secondaryArchetype,
                        fitDetail.inputs.archetypeReport?.failureMode ?? null,
                        breakdown.defenseScore,
                      ).failureMode;
                      return risk && <span className="identity-risk">main risk: {risk}</span>;
                    })()}
                  </div>
                )}
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
                    {/* 2026-09-11, user-reported live ("a ten opisek można dać tam gdzie jest
                        drugi screen") — the "Identity:" line moved up to the header's own
                        `identity-chip-row`, right next to the tags it describes, instead of
                        repeating the same primary/secondary archetype text a second time down
                        here. Season profile is a different read (RS-vs-playoffs shape) and stays. */}
                    {rsPoProfile && (
                      <div className="analysis-identity">
                        <p className="analysis-identity-line">
                          <b>Season profile:</b> {rsPoProfile.label} (regular season {rsPoProfile.regularSeason} · playoffs {rsPoProfile.playoffs}). {rsPoProfile.explanation}
                        </p>
                      </div>
                    )}
                    {/* 2026-09-11, user-reported live ("można te ofensywne statystyki dać po
                        lewej stronie a po prawej defensywne"): the old single 2-col grid filled
                        row-major, so reading straight down the left column mixed offense and
                        defense metrics (O-TAL, Spacing, Defense, Hunt resistance, Size all landed
                        together purely by row-fill accident). Two explicit columns instead of one
                        auto-flowing grid — offense metrics stay grouped left, defense right,
                        regardless of how many of each side there are. Title structure is a
                        whole-roster read (neither purely offense nor defense), so it gets its own
                        full-width row below both columns rather than an arbitrary side. */}
                    <div className="analysis-bars-split">
                      <div className="analysis-bars-col analysis-bars-col--offense">
                        <span className="analysis-bars-col-label">Offense details</span>
                        {offenseDetail && <MetricBar label="O-TAL" value={offenseDetail.otal} hint="Team offensive talent." />}
                        <MetricBar label="Creation" value={fitDetail.components.creationStructure} hint="Half-court shot creation the roster can generate on its own." />
                        {offenseDetail && <MetricBar label="Spacing fit" value={offenseDetail.spacing} hint="Spacing as the offense uses it — shooting around your creators, where an elite playmaker can cover for a non-shooter. Not the same number as the Spacing score above, which is the roster's plain shooting average." />}
                        <MetricBar label="Rim pressure" value={fitDetail.components.rimPressureTeam} hint="How much the five collectively bends a defense at the rim." />
                      </div>
                      <div className="analysis-bars-col analysis-bars-col--defense">
                        <span className="analysis-bars-col-label">Defense details</span>
                        <MetricBar label="Role coverage" value={fitDetail.components.defensiveRoleCoverage} hint="Whether someone covers each defensive job — point of attack, wing, rim. A full set can still add up to a middling Defense score if the individual defenders are average." />
                        <MetricBar label="Switchability" value={fitDetail.components.switchability} hint="How freely the roster can switch across a screen without a mismatch." />
                        <MetricBar label="Hunt resistance" value={fitDetail.components.huntResistance} hint="How well the roster hides its weakest defender in a playoff series." />
                        <MetricBar label="Rebounding" value={fitDetail.components.reboundingBalance} hint="Two-way rebounding balance." />
                        <MetricBar label="Size" value={fitDetail.components.sizeCoverage} hint="Functional positional size across the lineup." />
                      </div>
                    </div>
                    <div className="analysis-bars-full">
                      <MetricBar label="Title structure" value={fitDetail.components.championshipStructure} hint="How closely the roster's shape matches real championship rosters." />
                    </div>
                    <details className="analysis-raw">
                      <summary>All metrics &amp; inputs</summary>
                      {offenseDetail && (
                        <>
                          <div className="analysis-section-heading">Offense</div>
                          <span className="fit-detail-metric"><b>O-TAL</b><strong>{Math.round(offenseDetail.otal)}</strong></span>
                          <span className="fit-detail-metric"><b>Spacing fit</b><strong>{Math.round(offenseDetail.spacing)}</strong></span>
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
                      <span className="fit-detail-metric"><b>Lineup spacing</b><strong>{Math.round(fitDetail.components.spacingCompatibility)}</strong></span>
                      <span className="fit-detail-metric"><b>Rim pressure (fit)</b><strong>{Math.round(fitDetail.components.rimPressureTeam)}</strong></span>
                      <span className="fit-detail-metric"><b>Role coverage</b><strong>{Math.round(fitDetail.components.defensiveRoleCoverage)}</strong></span>
                      <span className="fit-detail-metric"><b>Switchability</b><strong>{Math.round(fitDetail.components.switchability)}</strong></span>
                      <span className="fit-detail-metric"><b>Hunt resistance</b><strong>{Math.round(fitDetail.components.huntResistance)}</strong></span>
                      {fitDetail.components.defensiveCohesion > 0 && (
                        <span className="fit-detail-metric"><b>Defensive cohesion</b><strong>{Math.round(fitDetail.components.defensiveCohesion)}</strong></span>
                      )}
                      <span className="fit-detail-metric"><b>Rebounding</b><strong>{Math.round(fitDetail.components.reboundingBalance)}</strong></span>
                      <span className="fit-detail-metric"><b>Functional size</b><strong>{Math.round(fitDetail.components.sizeCoverage)}</strong></span>
                      <span className="fit-detail-metric"><b>Championship structure</b><strong>{Math.round(fitDetail.components.championshipStructure)}</strong></span>
                      {fitDetail.inputs.championshipArchetypes.length > 0 && (
                        <span className="fit-detail-wide"><b>Style match</b> {fitDetail.inputs.championshipArchetypes.map((entry) => `${archetypeDisplayName(entry.archetype)} ${entry.share}%`).join(' · ')}</span>
                      )}
                      {fitDetail.inputs.archetypeReport && (
                        <span className="fit-detail-wide"><b>Profile:</b> {fitDetail.inputs.archetypeReport.strengths.join(' · ')}.</span>
                      )}
                      <span className="fit-v2-shadow-detail">
                        <b>Defenders:</b> on-ball {fitDetail.inputs.guardContainmentProvider ?? '—'} {Math.round(fitDetail.inputs.guardContainment)}
                        {!fitDetail.inputs.guardContainmentConfirmed && ' (estimated)'}
                        {' · '}wing {fitDetail.inputs.wingCoverageProvider ?? '—'} {Math.round(fitDetail.inputs.wingCoverage)}
                        {!fitDetail.inputs.wingCoverageConfirmed && ' (estimated)'}
                        {' · '}rim {fitDetail.inputs.rimProtectionProvider ?? '—'} {Math.round(fitDetail.inputs.rimProtection)}
                        {!fitDetail.inputs.rimProtectionConfirmed && ' (estimated)'}
                        {fitDetail.inputs.defensiveWeakLinkIsHuntable &&
                          <>
                            {' · '}weak link {fitDetail.inputs.defensiveWeakLinkPlayer ?? '—'} {Math.round(fitDetail.inputs.defensiveWeakLinkResistance)}
                            {fitDetail.inputs.defensiveWeakLinkCover > 0 && ` · team help +${fitDetail.inputs.defensiveWeakLinkCover}`}
                          </>
                        }
                      </span>
                      {huntability && huntability.offenders.length > 0 && (
                        <span className="fit-v2-shadow-detail">
                          <b>Weakest defenders:</b> {huntability.offenders.slice(0, 4).map((offender) =>
                            `${offender.playerName} (defense ${offender.defensiveTalent}, ${offender.minutes} min)`,
                          ).join(' · ')}
                        </span>
                      )}
                      <span className="fit-v2-shadow-detail">
                        <b>Size vs. position:</b> height {Math.round(fitDetail.inputs.positionAdjustedHeightPercentile ?? 50)}
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
                    <div className="championship-summary" title="Simulated over the full 16-team bracket, seeded by the final ranking.">
                      <div className="championship-headline">
                        <span className="championship-headline-stat">
                          <b><AnimatedPercent value={leagueEvalRow.championshipProbability} /></b>
                          <i>to win it all</i>
                        </span>
                        <span className="championship-headline-stat">
                          <b>{(leagueEvalRow.avgSeriesWinProb * 100).toFixed(0)}%</b>
                          <i>avg chance to win a series</i>
                        </span>
                      </div>
                      <span>
                        Your best chance: vs {teamLabel(teamById(leagueEvalRow.bestMatchup.opponentId)!)} (
                        {(leagueEvalRow.bestMatchup.seriesWinProb * 100).toFixed(0)}% to win the series)
                        {bestMatchupExplanation && ` — ${bestMatchupExplanation}`}
                      </span>
                      <span>
                        Toughest opponent: vs {teamLabel(teamById(leagueEvalRow.worstMatchup.opponentId)!)} (
                        {(leagueEvalRow.worstMatchup.seriesWinProb * 100).toFixed(0)}% to win the series)
                        {worstMatchupExplanation && worstMatchupExplanation !== bestMatchupExplanation && ` — ${worstMatchupExplanation}`}
                      </span>
                    </div>
                  )}
                  {/* 2026-09-24 copy pass: the "Raw net-rating estimate" footnote is gone from the player
                      view — a separate regression that routinely disagreed with the ranking and odds
                      right above it (e.g. +8.2 net for a 16th-place, 0%-odds team). */}
                </details>
                <details className="result-accordion-section rotation-panel">
                  <summary>Rotation</summary>
                  {/* 2026-09-24, user's own ask ("a gdyby to dla wszystkich takimi kafelkami
                      zastąpić?"): every team's rotation now uses the same per-position tiles as the
                      hero's own Rotation panel, instead of a long one-row-per-stint list. */}
                  <RotationColumns
                    assignments={assignments}
                    starterKeys={starterKeys}
                    totalMinutesByPlayerId={totalMinutesByPlayerId}
                    detailed
                  />
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
      <div className="results-actions">
        {onRematch && (
          <button className="primary-btn" onClick={() => onRematch()}>New draft</button>
        )}
        {onRematch && (
          <button className="secondary-btn" onClick={() => onRematch(draftSeed)}>Rematch this board</button>
        )}
        <button className="secondary-btn" onClick={onRestart}>Main menu</button>
      </div>
    </div>
  );
}
