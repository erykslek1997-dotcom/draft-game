import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { rankTeams, offenseScoreBreakdown, teamDefensiveTalentScore, calibrateOffenseToDefenseScale, type OffenseScoreBreakdown, type ScoreBreakdown } from '../engine/scoring';
import { evaluateLeague, type TeamLeagueEvaluation } from '../engine/leagueSimulation';
import { simulateSeason, buildMatchupCache, type SeasonStandingsRow } from '../engine/seasonSimulation';
import { PLAYOFF_TEAM_COUNT, simulatePlayoffs, type PlayoffResult } from '../engine/playoffSimulation';
import { STARTER_SLOTS, CAP_LIMIT, positionFitMultiplier } from '../engine/positions';
import type { Position } from '../data/schema';
import { allAssignments, primaryStarters, type ResolvedSlotAssignment } from '../engine/rotation';
import { draftPool } from '../data/draftPool';
import type { DraftHistoryEntry, Rotation, Team } from '../engine/types';
import { teamLabel } from '../engine/teamNames';
import { computeOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
// `effectiveTalent` for every plain TAL read; `displayTalentForSpan` stays separately imported
// for the two call sites below that use the Sixth-Man-aware `tierContextWithSixthMan` context
// instead of the plain one `effectiveTalent` builds internally.
import { displayTalentForSpan, formatTal } from '../engine/grades';
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { fitScore, type FitScoreResult } from '../engine/fit';
import { defensiveHuntability } from '../engine/defensiveHuntability';
import { generateRosterInsights, insightContextFor } from '../engine/insights';
import { explainMatchup } from '../engine/matchupExplanation';
import { seasonProfile } from '../engine/seasonProfile';
import { buildTeamFeatureSnapshot } from '../engine/insightMapper';
import { archetypeDisplayName, defenseFirstBacked, teamStyleFor } from '../engine/championshipArchetype';
import { bestHistoricalComp, compBadge, type HistoricalCompMatch } from '../engine/historicalComps';
import { TeamTile } from './TeamBadge';
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
import ChampionshipOdds from './ChampionshipOdds';
import { markStepDone } from './pathProgress';
import { TEAM_EXPORT_FOR_TESTING } from './testingFlags';
import { exportLeagueText } from '../engine/teamExport';
import AllMetrics from './AllMetrics';
import { teamMetricValues, type TeamMetricValues } from '../engine/teamMetrics';
import { downloadDuelCard, type ShareCardStarter, type ShareRosterRow } from './shareCardImage';
import { CapIcon, Face, shortenName } from './ShotChip';
import { ScoreBoard } from './ScoreBoard';
import { ShareModal } from './ResultsShareModal';
import { PlayoffBracketTree } from './PlayoffBracketTree';

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

/** 2026-09-09: the "correct any team's rotation from the results screen" feature (a reused
 * `RotationBuilder`) is no longer wired in — `correctedRotations` is always empty. Kept as a
 * single module-level stable reference so the `scoredTeams` `useMemo` below actually memoizes:
 * previously it was `const correctedRotations = {}` inside the component body, a fresh object
 * every render, which busted `scoredTeams` → `leagueEval` (`evaluateLeague`, ~1.5s) on every
 * re-render (accordion toggle, season-sim click). */
const EMPTY_CORRECTED_ROTATIONS: Record<string, Rotation> = {};


/** 2026-09-11, user-reported live ("14) skala może być w czerwono-zielonym gradiencie" / "16)
 * kurde brzydkie to") — `ScoreChip`/`MetricBar` used to tint off `scoreBand`'s own 6 discrete
 * buckets, whose bottom 4 (0-67) span red→amber→green but whose TOP 2 buckets (67-100) are both
 * the same green — so a real, competitive roster (whose metrics mostly land 50-95) rendered as a
 * wall of near-identical green, reading as "no color" even though the mechanism technically has
 * some. A continuous interpolation instead of discrete bands means a 58 and a 95 — both "good" —
 * still read as visibly different shades, the actual "gradient" the ask was for. Same red/green
 * hue endpoints `MatchupMatrix.tsx`'s own diverging scale uses, for one consistent "how good is
 * this number" visual language across the app's judgment displays. */
export function qualityColor(v: number): string {
  const t = Math.max(0, Math.min(100, v)) / 100;
  const hue = 2 + t * 146;
  const saturation = 42 + Math.abs(t - 0.5) * 34;
  const lightness = 30 + t * 12;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th" — plain English ordinal for the finish-position line. */
export function ordinal(n: number): string {
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
      <ScoreBoard
        cells={[
          { label: isHuman ? 'Your team' : 'Team rating', value: overall, you: overall },
          { label: 'Best in field', value: topOverall ?? overall },
          ...(titleOdds !== null
            ? [{
                label: 'Title odds',
                value: <AnimatedPercent value={titleOdds} />,
                title: 'Chance to win a 16-team playoff seeded by the final ranking, over thousands of simulations. The season simulation below plays its own top-8 playoffs.',
              }]
            : [{ label: 'Behind the best', value: gap !== null && gap > 0 ? gap : '—' }]),
        ]}
      />
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
              {compBadge(comp.comp) && <TeamTile {...compBadge(comp.comp)!} label={comp.comp.team} />}
              <span>Plays like the <b>{comp.comp.team}</b> <small>{comp.match}% match</small></span>
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
                {offenseDetail && <MetricBar label="O-TAL" value={offenseScale(offenseDetail.otal)} hint="Team offensive talent." />}
                <MetricBar label="Creation" value={offenseScale(fitDetail.components.creationStructure)} hint="Half-court shot creation the roster can generate on its own." />
                {offenseDetail && <MetricBar label="Spacing fit" value={offenseScale(offenseDetail.spacing)} hint="Spacing as the offense uses it — shooting around your creators, where an elite playmaker can cover for a non-shooter. Not the same number as the Spacing score above, which is the roster's plain shooting average." />}
                <MetricBar label="Rim pressure" value={offenseScale(fitDetail.components.rimPressureTeam)} hint="How much the five collectively bends a defense at the rim." />
                {offenseDetail && <MetricBar label="Playmaking" value={offenseScale(offenseDetail.playmaking)} hint="Passing and table-setting — how well the roster creates shots for others, not just for itself." />}
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

/** 2026-09-27 results audit (pack B): one ranking row for both drafts — place, team, title odds
 * when the mode has them, and the rating in the same color scale as every other score. The
 * All-Time Draft puts it inside its expandable header; the Mini Draft shows it as a plain row. */
export function RankRowSummary({ rank, label, isHuman, rating, titleOdds }: { rank: number; label: string; isHuman: boolean; rating: number; titleOdds?: number | null }) {
  return (
    <>
      <span className="rank-row-pos">{rank}</span>
      <span className="rank-row-name">{label}</span>
      {isHuman && <span className="rank-row-you">You</span>}
      {titleOdds != null && (
        <span
          className="rank-row-odds"
          title="Title odds: how often this team won a 16-team bracket of best-of-7 series, simulated 20,000 times. Each series is decided by projected point differential and how the two teams match up — not by the Rating — so two teams with the same Rating can have very different odds."
        >
          🏆 {titleOdds > 0 && titleOdds < 0.01 ? '<1' : Math.round(titleOdds * 100)}%
        </span>
      )}
      <span className="rank-row-rating" style={{ background: qualityColor(rating) }}>
        {rating}
      </span>
    </>
  );
}

export function ScoreChip({ label, value }: { label: string; value: number }) {
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
export function MetricBar({ label, value, hint }: { label: string; value: number; hint?: string }) {
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


/** 2026-09-24: one concrete thing to try next draft, keyed to the human team's weakest score —
 * the results screen used to show the numbers (often a harsh 16th/16, 0% everywhere) without
 * ever saying what to do differently. */
const NEXT_DRAFT_TIP: Record<string, string> = {
  Talent: 'Top-end talent was the main gap. Spend early picks on the best player available and fill needs later.',
  'Bench Depth': 'The bench gave back ground. Save some caps for the late rounds so your 6th–9th men can hold their own.',
  Offense: 'The offense trailed the field. A second shot creator and more shooting around the stars would help.',
  Defense: "Defense was the main gap. Opponents target stars who can't defend — a mid-round rim protector or wing stopper would help.",
  Spacing: 'The floor got crowded. Two or three reliable outside shooters around your stars would open it up.',
  Fit: 'Some pieces overlapped — several players who want the ball or do the same job. Balance creators, shooters and defenders.',
  Rotation: 'The rotation cost some points. Start players at their natural positions and keep minutes within what each can handle.',
};

/** 2026-09-25, user-reported ("Too many players needed the ball — nie jest to skład który wymaga
 * dużo piłki"): Fit blends ten separate components, so one generic "too many ball-dominant
 * players" line was wrong whenever creation wasn't the problem (that roster had Creation 95 and
 * Spacing fit 95; Switchability and Rim pressure were the real gaps). The Fit tip now names the
 * weakest component. */
const FIT_COMPONENT_TIP: Record<keyof FitScoreResult['components'], string> = {
  creationStructure: 'Creation was unbalanced — too many ball-handlers, or too few. Build around one or two creators with finishers and shooters around them.',
  pairingStructure: 'No real pick-and-roll pairing. A ball-handler who runs the screen with a big who rolls hard or pops to shoot is the simplest offense there is.',
  spacingCompatibility: 'The non-shooters got in each other’s way. Pair each big who doesn’t shoot with shooters rather than another non-shooter.',
  defensiveRoleCoverage: 'One defensive job was left thin. Aim for both a rim protector and a wing who can take the other team’s best scorer.',
  switchability: 'The lineup struggled to switch. Opponents can pull your slowest big or smallest guard into pick-and-rolls — defenders who guard several positions help.',
  huntResistance: 'Opponents had a clear matchup to target. Every weaker defender you start becomes their go-to — cover him with help or limit his minutes.',
  defensiveCohesion: 'The defenders didn’t quite add up to a unit. Pair a paint anchor with perimeter stoppers instead of stacking one kind.',
  rimPressureTeam: 'Too reliant on jump shooting — the lineup lacked an inside finisher. A slasher or a big who scores at the rim and draws fouls would balance it.',
  reboundingBalance: 'Rebounding was a weakness. One real rebounder in the frontcourt would help.',
  sizeCoverage: 'The lineup was undersized for its positions. Bigger bodies at the forward spots help against physical teams.',
  championshipStructure: 'The pecking order was unclear. Title teams have one or two stars and role players built around them.',
};

/**
 * 2026-09-26, user-reported (Nash / Holiday / Durant / Jackson Jr. / Bill Russell: Offense 71 with
 * Creation 95 and Spacing fit 99, told to "draft a real shot creator and don't stack non-shooters";
 * "rozumiem że Bill Russell zaniżył atak, ale to powinno być powodem"): the Offense tip was one
 * generic sentence. It now names the heaviest drag — the rotation player (20+ min) furthest under
 * the median O-TAL of rotation players at the slot he plays most — and the weakest part of the
 * offense's own blend.
 */
const MEDIAN_OTAL_BY_SLOT: Record<Position, number> = { PG: 63, SG: 67, SF: 63, PF: 64, C: 62 };
const OFFENSE_PART_TIP: Record<'spacing' | 'rimPressure' | 'playmaking' | 'selfCreation', string> = {
  spacing: 'More shooting around your creators would open the floor.',
  rimPressure: 'The offense was too reliant on jump shooting — it lacked an inside finisher.',
  playmaking: 'A true passer would get your scorers the ball in rhythm.',
  selfCreation: 'Late in the clock it lacked someone who can create his own shot.',
};
function offenseTip(team: Team): string {
  const minutes = new Map<string, { player: ResolvedSlotAssignment['player']; total: number; bySlot: Map<Position, number> }>();
  for (const entry of allAssignments(team)) {
    const row = minutes.get(entry.player.id) ?? { player: entry.player, total: 0, bySlot: new Map<Position, number>() };
    row.total += entry.minutes;
    row.bySlot.set(entry.slot, (row.bySlot.get(entry.slot) ?? 0) + entry.minutes);
    minutes.set(entry.player.id, row);
  }
  const drag = [...minutes.values()]
    .filter((row) => row.total >= 20)
    .map((row) => {
      const slot = [...row.bySlot.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const otal = Math.round(computeOffensiveTalent(row.player));
      return { row, slot, otal, gap: MEDIAN_OTAL_BY_SLOT[slot] - otal };
    })
    .filter((d) => d.gap >= 5)
    .sort((a, b) => b.gap * b.row.total - a.gap * a.row.total)[0];
  const parts = offenseScoreBreakdown(team);
  const [weakestPart] = (['spacing', 'rimPressure', 'playmaking', 'selfCreation'] as const)
    .map((k) => [k, parts[k]] as const)
    .sort((a, b) => a[1] - b[1])[0];
  if (!drag) return `The offense trailed the field. ${OFFENSE_PART_TIP[weakestPart]}`;
  return `The offense trailed the field, and ${drag.row.player.playerName} gave it the least: O-TAL ${drag.otal} in ${Math.round(drag.row.total)} minutes at ${drag.slot}, where a typical rotation player reads ${MEDIAN_OTAL_BY_SLOT[drag.slot]}. ${OFFENSE_PART_TIP[weakestPart]}`;
}

export function nextDraftTip(label: string, team: Team): string | undefined {
  if (label === 'Offense') return offenseTip(team);
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
                      {formatTal(displayTalentForSpan(tierContextFor(e.player)))}
                    </span>
                  )}
                </div>
              );
            })}
            {spot.length > 0 && (
              <span className="rotation-spot-line" aria-label="Spot minutes at this position">
                {spot.map((e) => (
                  <span className="rotation-spot-entry" key={e.player.id} title={`${e.player.playerName} (${e.player.spanLabel}) · ${Math.round(e.minutes)} min`}>
                    <Face name={e.player.playerName} size="xs" />
                    {/* 2026-09-30, the user read a face with only "4m" next to it as a missing name. */}
                    {shortenName(e.player.playerName, 12)} {Math.round(e.minutes)}m
                  </span>
                ))}
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
export const SPOT_MINUTES = 6;

function ResultsVerdict({
  team,
  rank,
  fieldSize,
  breakdown,
  scores,
  fieldMedians,
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
  fieldMedians: Record<string, number>;
}) {
  const insights = useMemo(
    () => generateRosterInsights(buildTeamFeatureSnapshot(team), undefined, insightContextFor(breakdown, rank, fieldSize)),
    [team, breakdown, rank, fieldSize],
  );
  const won = rank === 1;
  const contender = rank > 1 && rank <= 4;
  const strengths = insights.strengths.slice(0, won ? 3 : 2);
  const concerns = insights.concerns.slice(0, won ? 1 : 2);
  const [weakestLabel] =
    Object.entries(scores).sort((a, b) => a[1] - (fieldMedians[a[0]] ?? 0) - (b[1] - (fieldMedians[b[0]] ?? 0)))[0] ?? [];
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
    </section>
  );
}

/** 2026-09-30, engine calibration session 1 (the user: "Offense 74 przy składnikach 86–100 —
 * kafelek w innej skali niż paski"): the Offense score is the ingredients' blend mapped onto the
 * Defense score's scale (`calibrateOffenseToDefenseScale`); the ingredient bars go through the same
 * mapping, so the score always sits among its bars. */
function offenseScale(value: number): number {
  return Math.round(calibrateOffenseToDefenseScale(value));
}

export default function ResultsScreen({ teams, history, onRestart, onRematch, draftSeed, challenger }: Props) {
  // Step 3 of the menu's learning path is done once a full draft reaches its results.
  useEffect(() => markStepDone('draft'), []);
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
  // 2026-09-26: the "Next draft" tip names the area furthest BELOW THE FIELD, not the lowest raw
  // number — the chips sit on different scales (Rotation reads ~95 for most teams, Offense and
  // Defense average ~74), so the raw minimum was nearly always Offense after its recalibration.
  const fieldMedians = useMemo(() => {
    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };
    const b = ranked.map((r) => r.breakdown);
    return {
      Talent: median(b.map((x) => x.talentScore)),
      'Bench Depth': median(b.map((x) => x.benchDepthScore)),
      Offense: median(b.map((x) => x.offenseScore)),
      Defense: median(b.map((x) => x.defenseScore)),
      Spacing: median(b.map((x) => x.spacingScore)),
      Fit: median(b.map((x) => x.fitScore)),
      Rotation: median(b.map((x) => x.rotationScore)),
    } as Record<string, number>;
  }, [ranked]);
  // Group C mockup 19: every metric for every team, for the field median and rank shown next to
  // each bar in "All metrics & inputs". Computed only once some team's card is open.
  const anyExpanded = expandedTeamIds.size > 0;
  const fieldMetricValues = useMemo<Map<string, TeamMetricValues>>(
    () => (anyExpanded ? new Map(scoredTeams.map((team) => [team.id, teamMetricValues(team)])) : new Map()),
    [anyExpanded, scoredTeams],
  );
  const heroStyle = teamStyleFor(
    heroFit?.inputs.primaryArchetype,
    heroFit?.inputs.secondaryArchetype,
    heroFit?.inputs.archetypeReport?.failureMode ?? null,
    heroRanked?.breakdown.defenseScore ?? 0,
    heroRanked?.breakdown.offenseScore,
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
      {/* 2026-09-27 results audit: the same "← Menu" + mode title the Mini Draft result has. */}
      <button type="button" className="at-menu-btn at-cond" onClick={onRestart}>
        ← Menu
      </button>
      <div className="at-board-brand at-cond">All-Time Draft</div>
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
          fieldMedians={fieldMedians}
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
        const bestOpponentFit = fitDetail && bestOpponent ? fitScore(displayTeam(bestOpponent)) : null;
        const worstOpponentFit = fitDetail && worstOpponent ? fitScore(displayTeam(worstOpponent)) : null;
        const bestMatchupExplanation = fitDetail && bestOpponentFit && leagueEvalRow
          ? explainMatchup({ own: fitDetail, opponent: bestOpponentFit, seriesWinProb: leagueEvalRow.bestMatchup.seriesWinProb })[0]
          : null;
        const worstMatchupExplanation = fitDetail && worstOpponentFit && leagueEvalRow
          ? explainMatchup({ own: fitDetail, opponent: worstOpponentFit, seriesWinProb: leagueEvalRow.worstMatchup.seriesWinProb })[0]
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
            <button className="team-result-header rank-row" onClick={() => toggleExpanded(team.id)} aria-expanded={isExpanded}>
              <span className="team-result-toggle">{isExpanded ? '▾' : '▸'}</span>
              <RankRowSummary
                rank={rank}
                label={teamLabel(team)}
                isHuman={team.isHuman}
                rating={breakdown.overall}
                titleOdds={leagueEvalRow?.championshipProbability ?? null}
              />
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
                      .filter((entry) => entry.archetype !== 'Defensive superteam' || defenseFirstBacked(breakdown.defenseScore, breakdown.offenseScore))
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
                        breakdown.offenseScore,
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
                        {offenseDetail && <MetricBar label="O-TAL" value={offenseScale(offenseDetail.otal)} hint="Team offensive talent." />}
                        <MetricBar label="Creation" value={offenseScale(fitDetail.components.creationStructure)} hint="Half-court shot creation the roster can generate on its own." />
                        {offenseDetail && <MetricBar label="Spacing fit" value={offenseScale(offenseDetail.spacing)} hint="Spacing as the offense uses it — shooting around your creators, where an elite playmaker can cover for a non-shooter. Not the same number as the Spacing score above, which is the roster's plain shooting average." />}
                        <MetricBar label="Rim pressure" value={offenseScale(fitDetail.components.rimPressureTeam)} hint="How much the five collectively bends a defense at the rim." />
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
                      <AllMetrics
                        values={teamMetricValues(shownTeam, fitDetail)}
                        field={[...fieldMetricValues.values()]}
                        offenseScore={breakdown.offenseScore}
                        defenseScore={breakdown.defenseScore}
                        fit={fitDetail}
                        huntability={huntability}
                        comp={bestHistoricalComp(shownTeam, breakdown, fitDetail)}
                      />
                    </details>
                  </details>
                )}
                <details className="result-accordion-section championship-section">
                  <summary>Championship odds</summary>
                  {leagueEvalRow && (
                    <ChampionshipOdds
                      row={leagueEvalRow}
                      allRows={leagueEval}
                      teamById={teamById}
                      ownFit={fitDetail}
                      bestOpponentFit={bestOpponentFit}
                      worstOpponentFit={worstOpponentFit}
                      bestExplanation={bestMatchupExplanation}
                      worstExplanation={worstMatchupExplanation}
                    />
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
      <div className="results-actions end-actions">
        {onRematch && (
          <button className="primary-btn" onClick={() => onRematch()}>New draft</button>
        )}
        {onRematch && (
          <button className="secondary-btn" onClick={() => onRematch(draftSeed)}>Rematch this board</button>
        )}
        <button className="secondary-btn" onClick={onRestart}>Main menu</button>
        {TEAM_EXPORT_FOR_TESTING && <TeamExportButton teams={scoredTeams} seed={draftSeed} leagueEval={leagueEval} />}
      </div>
    </div>
  );
}

/** Engine calibration (testing): copies every team as text to paste into a calibration session;
 * falls back to downloading a .txt where the clipboard is unavailable. */
function TeamExportButton({ teams, seed, leagueEval }: { teams: Team[]; seed: number; leagueEval: TeamLeagueEvaluation[] }) {
  const [state, setState] = useState<'idle' | 'copied' | 'saved'>('idle');
  async function handle() {
    const text = exportLeagueText(teams, { seed, titleOdds: new Map(leagueEval.map((e) => [e.teamId, e.championshipProbability])) });
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `draft-export-${seed}.txt`;
      link.click();
      URL.revokeObjectURL(url);
      setState('saved');
    }
  }
  return (
    <button className="secondary-btn team-export-btn" onClick={handle} title="Copies every team's scores, players and minutes as text">
      {state === 'copied' ? '✓ Copied — paste it in the chat' : state === 'saved' ? '✓ Saved as .txt' : 'Export all teams (testing)'}
    </button>
  );
}
