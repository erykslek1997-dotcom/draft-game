import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { rankTeams, offenseScoreBreakdown, teamDefensiveTalentScore, calibrateOffenseToDefenseScale, type ScoreBreakdown } from '../engine/scoring';
import { evaluateLeague, type TeamLeagueEvaluation } from '../engine/leagueSimulation';
import { seasonSeed, simulateLivePlayoffsAsync, simulateLiveSeasonAsync, type SimProgress } from '../engine/liveSeason';
import { STARTER_SLOTS } from '../engine/positions';
import type { Position } from '../data/schema';
import { allAssignments, primaryStarters, type ResolvedSlotAssignment } from '../engine/rotation';
import { draftPool } from '../data/draftPool';
import type { DraftHistoryEntry, Rotation, Team } from '../engine/types';
import { teamCodes, teamLabel } from '../engine/teamNames';
import { computeOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { fitScore, type FitScoreResult } from '../engine/fit';
import { defensiveHuntability } from '../engine/defensiveHuntability';
import { generateRosterInsights, insightContextFor } from '../engine/insights';
import { explainMatchup } from '../engine/matchupExplanation';
import { seasonProfile } from '../engine/seasonProfile';
import { buildTeamFeatureSnapshot } from '../engine/insightMapper';
import { teamStyleFor } from '../engine/championshipArchetype';
import { bestHistoricalComp } from '../engine/historicalComps';
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
import ChampionshipOdds from './ChampionshipOdds';
import { markStepDone } from './pathProgress';
import { TEAM_EXPORT_FOR_TESTING } from './testingFlags';
import AllMetrics from './AllMetrics';
import { teamMetricValues, type TeamMetricValues } from '../engine/teamMetrics';
import { downloadDuelCard, type ShareCardStarter, type ShareRosterRow } from './shareCardImage';
import { shortenName } from './ShotChip';
import { ShareModal } from './ResultsShareModal';
import SeasonView, { type SeasonState } from './SeasonView';
import { styleClashBreakdown, styleProfile, type StyleClashKey } from '../engine/matchup';
import {
  RosterGrid,
  TeamMark,
  TeamReport,
  VsYou,
  fieldGrade,
  teamHue,
  voicesFor,
  type DeskVoice,
  type ProfileRow,
  type ReportExtra,
} from './ResultsReport';
import { FitName, FitTeam } from './FitName';
import { exportFullDraft } from '../engine/draftExport';

// 2026-09-14, user-reported live: shared scheduling helpers for both background-simulation
// features below (Title Odds precision upgrade, the live season) — real work deferred until the
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
  assignments,
  starterKeys,
  topOverall,
  titleOdds,
  draftSeed,
  identity,
  failureMode,
  starters,
  challenger,
  seasonSimSlot,
  teamCode,
  rosterTeam,
  profile,
  quote,
  report,
  standings,
  aiEdge,
  onNewDraft,
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
  challenger?: ChallengeChallenger;
  assignments: ResolvedSlotAssignment[];
  starterKeys: Set<string>;
  topOverall: number | null;
  titleOdds: number | null;
  draftSeed: number;
  identity: string | null;
  failureMode: string | null;
  starters: ShareCardStarter[];
  /** 2026-09-18, user-reported live ("simulate season można dać nad rotacją gdzie jest empty
   * space" — the season-sim panel can go above, next to the Rotation cards, where there's empty
   * space): a pre-built JSX subtree from `ResultsScreen` itself (which owns all the season-sim
   * state) rather than threading every individual piece of that state down as its own prop — the
   * simplest way for a child this deep to render a parent-owned slot without duplicating state. */
  seasonSimSlot?: ReactNode;
  /** 2026-10-08, results look C: the hero's team mark and roster, the Draft Desk line under the
   * hero, the team report (profile + desk voices) and the standings with every rival's report. */
  teamCode: string;
  rosterTeam: Team;
  /** The profile bars the report shows — the share card shows the same ones. */
  profile: ProfileRow[];
  quote: DeskVoice | null;
  report: ReactNode;
  standings: ReactNode;
  /** "Where the AI beat you" (yours only). */
  aiEdge?: ReactNode;
  onNewDraft?: () => void;
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
    <>
    <header className={`rs-hero rr-hero${rank === 1 ? ' is-champ' : ''}`}>
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
                <FitTeam className="challenge-compare-team" name={teamName} />
                <span className="challenge-compare-overall">{overall}</span>
                <span className="challenge-compare-rank">{ordinal(rank)} / {fieldSize}</span>
              </div>
              <span className="challenge-compare-vs">vs</span>
              <div className={`challenge-compare-side ${youWon === false ? 'challenge-compare-side--winner' : ''}`}>
                <span className="challenge-compare-label">Your friend</span>
                <FitTeam className="challenge-compare-team" name={challenger.name} />
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
                              <FitName className="challenge-compare-rotation-name" name={a.player.playerName} />
                              <span className="challenge-compare-rotation-min">{Math.round(a.minutes)}m</span>
                            </div>
                          )) : <span className="challenge-compare-rotation-empty">—</span>}
                        </div>
                        <div className="challenge-compare-rotation-col challenge-compare-rotation-col--right">
                          {theirEntries.length > 0 ? theirEntries.map((e, i) => (
                            <div className="challenge-compare-rotation-entry" key={`${e.name}-${i}`}>
                              <span className="challenge-compare-rotation-min">{e.minutes}m</span>
                              <FitName className="challenge-compare-rotation-name" name={e.name} />
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
                      <FitName className="challenge-compare-roster-name" name={mine} />
                      <FitName className="challenge-compare-roster-name" name={theirs} />
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
      <div className="rr-hero-grid">
        <div className="rr-hero-main">
          <span className="rr-label">{isHuman ? 'Final standings' : 'Top of the field'}</span>
          <span className="rr-place">
            <b>
              {rank}
              <sup>{ordinal(rank).slice(String(rank).length)}</sup>
            </b>
            <span>of {fieldSize}</span>
          </span>
          <span className="rr-team">
            <TeamMark code={teamCode} name={teamName} size="md" />
            <h2>{teamName}</h2>
            <span className={`rr-tag rr-tag--t${tier.tone}`}>{tier.label}</span>
          </span>
          {/* 2026-09-24 copy pass: labelled as a STYLE and a risk, so it doesn't read as a verdict. */}
          {identity && <p className="rr-headline">{identity}.</p>}
          {failureMode && <p className="rr-risk">Main risk: {failureMode}</p>}
        </div>
        <div className="rs-kpis">
          <div className="rs-kpi rs-kpi--you" title="The Final Power Ranking overall every team is judged by">
            <b>{overall}</b>
            <span>{isHuman ? 'Your team' : 'Team rating'}</span>
          </div>
          <div className="rs-kpi">
            <b>{topOverall ?? overall}</b>
            <span>Best</span>
            {gap !== null && <small className="rr-kpi-gap">{gap > 0 ? `−${gap}` : rank === 1 ? 'that’s you' : 'tied'}</small>}
          </div>
          {titleOdds !== null ? (
            <div className="rs-kpi" title="Chance to win a 16-team playoff seeded by the final ranking, over thousands of simulations. The season simulation plays its own top-8 playoffs.">
              <b>
                <AnimatedPercent value={titleOdds} />
              </b>
              <span>Title odds</span>
            </div>
          ) : (
            <div className="rs-kpi">
              <b>{gap !== null && gap > 0 ? gap : '—'}</b>
              <span>Behind the best</span>
            </div>
          )}
        </div>
      </div>
      {quote && (
        <p className="rr-quote">
          <span>{quote.who}</span>
          <q>{quote.text}</q>
        </p>
      )}
    </header>
    <div className="rs-actions rr-actions">
      {seasonSimSlot}
      <button type="button" className="at-calm-btn" onClick={() => setShareOpen(true)}>
        Share
      </button>
      <button
        type="button"
        className="at-calm-btn"
        onClick={copyChallengeLink}
        title="Copies a link that gives a friend the exact same 16-team draft board to react to."
      >
        {challengeCopied ? '✓ Link copied' : 'Challenge a friend'}
      </button>
      {onNewDraft && (
        <button type="button" className="at-calm-btn at-calm-btn--ghost" onClick={onNewDraft}>
          New draft
        </button>
      )}
    </div>
    {/* 2026-10-08, the user: first where the AI was better, then how the field finished; the
        roster and the why after that (the playoff-odds talk sits last, in the report's extras). */}
    {aiEdge}
    <h3 className="rr-section">
      Final standings
      <small>Series = your chance to beat them in a best-of-7</small>
    </h3>
    {standings}
    <h3 className="rr-section">{isHuman ? 'Your roster' : 'Roster'}</h3>
    <RosterGrid team={rosterTeam} />
    <h3 className="rr-section">{rank === 1 ? (isHuman ? 'Why you won' : 'Why they won') : isHuman ? 'Why you finished here' : 'Why they finished here'}</h3>
    {report}
      {shareOpen && (
        <ShareModal
          onClose={() => setShareOpen(false)}
          teamName={teamName}
          teamCode={teamCode}
          rank={rank}
          fieldSize={fieldSize}
          tier={tier}
          overall={overall}
          topOverall={topOverall}
          gap={gap}
          titleOdds={titleOdds}
          identity={identity}
          profile={profile}
          team={rosterTeam}
        />
      )}
  </>
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
 * Rotation players below their slot's value are named under the hero's Defense details.
 * 2026-09-26, the user ("50 dla słabego obrońcy zbyt ogólne, zależy od pozycji"; then, of a bottom-
 * third cut, "zbyt mało surowe"): the MEDIAN D-TAL of rotation-calibre spans (TAL 55+) at each
 * position — a C at 55 is a below-average C, a PG at 45 a below-average PG.
 */
const WEAK_DEFENDER_DTAL: Record<Position, number> = { PG: 49, SG: 43, SF: 47, PF: 58, C: 61 };
/** Below this many minutes at a slot, a non-starter is shown on the column's spot line. */
export const SPOT_MINUTES = 6;

/** Your report's Draft Desk voices. The tone follows the final place (2026-09-24, user-reported
 * live: "wygrałem, czy jest sens żeby mnie pouczało?" — a champion got a "what held you back" list
 * and a "Next draft:" lecture). 1st: why you won + the one thing a rival could exploit, no advice.
 * 2026-10-08 (TODO "ton wyniku według miejsca"): the whole podium reads that way — 2nd and 3rd get
 * no lecture either, their weak spot only as what could threaten them. 4th: "to get over the top".
 * Everyone else: what worked, what held you back, and one thing to try next draft. */
function yourVoices({
  team,
  rank,
  fieldSize,
  breakdown,
  fieldMedians,
}: {
  team: Team;
  rank: number;
  fieldSize: number;
  breakdown: ScoreBreakdown;
  fieldMedians: Record<string, number>;
}): DeskVoice[] {
  const insights = generateRosterInsights(buildTeamFeatureSnapshot(team), undefined, insightContextFor(breakdown, rank, fieldSize));
  const won = rank === 1;
  const podium = rank <= 3;
  const contender = rank === 4;
  const scores: Record<string, number> = {
    Talent: breakdown.talentScore,
    'Bench Depth': breakdown.benchDepthScore,
    Offense: breakdown.offenseScore,
    Defense: breakdown.defenseScore,
    Spacing: breakdown.spacingScore,
    Fit: breakdown.fitScore,
    Rotation: breakdown.rotationScore,
  };
  const [weakestLabel] =
    Object.entries(scores).sort((a, b) => a[1] - (fieldMedians[a[0]] ?? 0) - (b[1] - (fieldMedians[b[0]] ?? 0)))[0] ?? [];
  return voicesFor({
    strengths: insights.strengths.slice(0, podium ? 3 : 2).map((i) => i.message),
    concerns: insights.concerns.slice(0, podium ? 1 : 2).map((i) => i.message),
    tip: !podium && weakestLabel ? nextDraftTip(weakestLabel, team) : undefined,
    strengthLabel: won ? 'what won it' : podium ? 'what put you on the podium' : 'what worked',
    concernLabel: podium ? 'where a rival could still hurt you' : 'what held you back',
    tipLabel: contender ? 'to get over the top' : 'next draft',
  });
}

/** A rival's voices — the same insight engine, about them: what works, and what can sink them. */
function theirVoices(team: Team, breakdown: ScoreBreakdown, rank: number, fieldSize: number): DeskVoice[] {
  const insights = generateRosterInsights(buildTeamFeatureSnapshot(team), undefined, insightContextFor(breakdown, rank, fieldSize));
  const podium = rank <= 3;
  return voicesFor({
    strengths: insights.strengths.slice(0, podium ? 3 : 2).map((i) => i.message),
    concerns: insights.concerns.slice(0, 2).map((i) => i.message),
    strengthLabel: rank === 1 ? 'what won it' : 'what works',
    concernLabel: 'what can sink them',
    third: true,
  });
}

/** Rotation players below their slot's value — named under Defense details. See
 * `WEAK_DEFENDER_DTAL`. */
function weakDefendersFor(team: Team): { name: string; slot: Position; dtal: number; minutes: number }[] {
  const minutes = new Map<string, { player: ResolvedSlotAssignment['player']; minutes: number; bySlot: Map<Position, number> }>();
  for (const entry of allAssignments(team)) {
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
}

/** "Show what's behind each score": the ingredient bars, the season profile and every metric. */
function ScoreDetails({ team, breakdown, fit, field }: { team: Team; breakdown: ScoreBreakdown; fit: FitScoreResult; field: () => TeamMetricValues[] }) {
  const offenseDetail = offenseScoreBreakdown(team);
  const defenseTalent = Math.round(teamDefensiveTalentScore(team));
  const weakDefenders = weakDefendersFor(team);
  const profile = seasonProfile(breakdown, fit);
  return (
    <>
      <div className="analysis-bars-split rs-details">
        <div className="analysis-bars-col analysis-bars-col--offense">
          <span className="analysis-bars-col-label">Offense details</span>
          <MetricBar label="O-TAL" value={offenseScale(offenseDetail.otal)} hint="Team offensive talent." />
          <MetricBar label="Creation" value={offenseScale(fit.components.creationStructure)} hint="Half-court shot creation the roster can generate on its own." />
          <MetricBar label="Rim pressure" value={offenseScale(fit.components.rimPressureTeam)} hint="How much the five collectively bends a defense at the rim." />
          <MetricBar label="Playmaking" value={offenseScale(offenseDetail.playmaking)} hint="Passing and table-setting — how well the roster creates shots for others, not just for itself." />
        </div>
        <div className="analysis-bars-col analysis-bars-col--defense">
          <span className="analysis-bars-col-label">Defense details</span>
          <MetricBar label="D-TAL" value={defenseTalent} hint="Team defensive talent — the minutes-weighted D-TAL the Defense score starts from, before hunting risk and team structure." />
          <MetricBar label="Role coverage" value={fit.components.defensiveRoleCoverage} hint="Whether someone covers each defensive job — point of attack, wing, rim. A full set can still add up to a middling Defense score if the individual defenders are average." />
          <MetricBar label="Switchability" value={fit.components.switchability} hint="How freely the roster can switch across a screen without a mismatch." />
          <MetricBar label="Hunt resistance" value={fit.components.huntResistance} hint="How well the roster hides its weakest defender in a playoff series." />
          <MetricBar label="Rebounding" value={fit.components.reboundingBalance} hint="Two-way rebounding balance." />
          <MetricBar label="Size" value={fit.components.sizeCoverage} hint="Functional positional size across the lineup." />
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
      <div className="analysis-bars-full">
        <MetricBar label="Title structure" value={fit.components.championshipStructure} hint="How closely the roster's shape matches real championship rosters." />
      </div>
      <p className="analysis-identity-line">
        <b>Season profile:</b> {profile.label} (regular season {profile.regularSeason} · playoffs {profile.playoffs}). {profile.explanation}
      </p>
      <p className="results-hero-bars-note">
        These are the ingredients behind the scores above, measured separately — e.g. Role coverage is whether each defensive job is
        filled at all, the Defense score is how well it's done.
      </p>
      <details className="analysis-raw">
        <summary>All metrics &amp; inputs</summary>
        <AllMetrics
          values={teamMetricValues(team, fit)}
          field={field()}
          offenseScore={breakdown.offenseScore}
          defenseScore={breakdown.defenseScore}
          fit={fit}
          huntability={defensiveHuntability(team)}
          comp={bestHistoricalComp(team, breakdown, fit)}
        />
      </details>
    </>
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
  // 2026-10-08, the season on the live engine (the user: one season per draft, recap B, watch your
  // own playoff games): played in the background as soon as this screen opens — a few seconds,
  // in slices, so the page stays usable — and opened from the hero's "Your season".
  const [seasonState, setSeasonState] = useState<SeasonState>({ status: 'running', progress: null });
  const [seasonOpen, setSeasonOpen] = useState(false);
  const seasonOpenRef = useRef(false);
  seasonOpenRef.current = seasonOpen;
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

  useEffect(() => {
    const abort = new AbortController();
    setSeasonState({ status: 'running', progress: null });
    let lastShown = 0;
    // Progress re-renders this whole screen, so only while the season sheet is open, 4x a second.
    const onProgress = (progress: SimProgress) => {
      const now = Date.now();
      if (!seasonOpenRef.current || now - lastShown < 250) return;
      lastShown = now;
      setSeasonState({ status: 'running', progress });
    };
    const seed = seasonSeed(scoredTeams);
    const handle = scheduleIdle(() => {
      simulateLiveSeasonAsync(scoredTeams, seed, onProgress, abort.signal)
        .then(async (season) => {
          const playoffs = await simulateLivePlayoffsAsync(scoredTeams, season.standings, seed, abort.signal);
          setSeasonState({ status: 'done', season, playoffs });
        })
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name !== 'AbortError') throw error;
        });
    });
    return () => {
      cancelIdle(handle);
      abort.abort();
    };
  }, [scoredTeams]);

  // The one roster this screen exists to show off — the player's own, or (a defensive fallback for
  // a no-human commissioner draft) the Final Power Ranking's #1. Drives the hero header below.
  const heroRanked = ranked.find(({ team }) => team.isHuman) ?? ranked[0];
  const heroFit = useMemo(
    () => (heroRanked ? fitScore(displayTeam(heroRanked.team)) : null),
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
  // each bar in "All metrics & inputs". Computed the first time any team's details are opened.
  const fieldMetricsRef = useRef<{ teams: Team[]; values: TeamMetricValues[] } | null>(null);
  const fieldMetrics = () => {
    if (fieldMetricsRef.current?.teams !== scoredTeams) {
      fieldMetricsRef.current = { teams: scoredTeams, values: scoredTeams.map((team) => teamMetricValues(team)) };
    }
    return fieldMetricsRef.current.values;
  };
  const heroStyle = teamStyleFor(
    heroFit?.inputs.primaryArchetype,
    heroFit?.inputs.secondaryArchetype,
    heroFit?.inputs.archetypeReport?.failureMode ?? null,
    heroRanked?.breakdown.defenseScore ?? 0,
    heroRanked?.breakdown.offenseScore,
  );
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
  const codeByTeamId = useMemo(() => teamCodes(teams), [teams]);
  const seasonSimSlot = (
    <>
      <button
        type="button"
        className="rs-primary season-sim-btn"
        title="An 82-game season and the playoffs, every game played on the game engine. The same draft always plays the same season."
        onClick={() => setSeasonOpen(true)}
      >
        Your season
      </button>
      {seasonOpen && <SeasonView teams={scoredTeams} codes={codeByTeamId} state={seasonState} onClose={() => setSeasonOpen(false)} />}
    </>
  );

  // 2026-10-08, results look C: every team's report is built from the same pieces.
  const fieldScores = useMemo(() => {
    const b = ranked.map((r) => r.breakdown);
    return {
      talent: b.map((x) => x.talentScore),
      offense: b.map((x) => x.offenseScore),
      defense: b.map((x) => x.defenseScore),
      spacing: b.map((x) => x.spacingScore),
      fit: b.map((x) => x.fitScore),
      bench: b.map((x) => x.benchDepthScore),
      rotation: b.map((x) => x.rotationScore),
    };
  }, [ranked]);
  const profileRows = (b: ScoreBreakdown): ProfileRow[] => [
    { label: 'Talent', value: b.talentScore, grade: fieldGrade(b.talentScore, fieldScores.talent) },
    { label: 'Offense', value: b.offenseScore, grade: fieldGrade(b.offenseScore, fieldScores.offense) },
    { label: 'Defense', value: b.defenseScore, grade: fieldGrade(b.defenseScore, fieldScores.defense) },
    { label: 'Spacing', value: b.spacingScore, grade: fieldGrade(b.spacingScore, fieldScores.spacing) },
    { label: 'Fit', value: b.fitScore, grade: fieldGrade(b.fitScore, fieldScores.fit) },
    { label: 'Bench', value: b.benchDepthScore, grade: fieldGrade(b.benchDepthScore, fieldScores.bench) },
    { label: 'Rotation', value: b.rotationScore, grade: fieldGrade(b.rotationScore, fieldScores.rotation) },
  ];
  const humanTeam = scoredTeams.find((team) => team.isHuman);
  const humanEval = humanTeam ? leagueEvalByTeamId.get(humanTeam.id) : undefined;
  const humanStyle = useMemo(() => (humanTeam ? styleProfile(humanTeam) : null), [humanTeam]);
  const heroVoices = useMemo(
    () =>
      heroRanked?.team.isHuman
        ? yourVoices({ team: displayTeam(heroRanked.team), rank: heroRanked.rank, fieldSize: ranked.length, breakdown: heroRanked.breakdown, fieldMedians })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heroRanked, ranked.length, fieldMedians],
  );
  /** The extras under a team's profile: the score ingredients, the title path, the draft order. */
  const reportExtras = (team: Team, breakdown: ScoreBreakdown, fit: FitScoreResult): ReportExtra[] => {
    const evalRow = leagueEvalByTeamId.get(team.id);
    const teamHistory = history.filter((h) => h.teamId === team.id).sort((a, b) => a.pickNumber - b.pickNumber);
    const extras: ReportExtra[] = [
      { id: 'details', label: "What's behind each score", content: () => <ScoreDetails team={team} breakdown={breakdown} fit={fit} field={fieldMetrics} /> },
    ];
    if (evalRow) {
      extras.push({
        id: 'title',
        label: 'Title path',
        content: () => {
          const best = teamById(evalRow.bestMatchup.opponentId);
          const worst = teamById(evalRow.worstMatchup.opponentId);
          const bestFit = best ? fitScore(displayTeam(best)) : null;
          const worstFit = worst ? fitScore(displayTeam(worst)) : null;
          return (
            <ChampionshipOdds
              row={evalRow}
              allRows={leagueEval}
              teamById={teamById}
              ownFit={fit}
              bestOpponentFit={bestFit}
              worstOpponentFit={worstFit}
              bestExplanation={bestFit ? explainMatchup({ own: fit, opponent: bestFit, seriesWinProb: evalRow.bestMatchup.seriesWinProb })[0] : null}
              worstExplanation={worstFit ? explainMatchup({ own: fit, opponent: worstFit, seriesWinProb: evalRow.worstMatchup.seriesWinProb })[0] : null}
            />
          );
        },
      });
    }
    extras.push({
      id: 'order',
      label: 'Draft order',
      content: () => (
        <ol className="rr-draft-order">
          {teamHistory.map((entry) => {
            const p = playerById(entry.playerId);
            return (
              <li key={entry.pickNumber}>
                <span className="history-pick">#{entry.pickNumber}</span> {p ? `${p.playerName} (${p.spanLabel})` : entry.playerId}
              </li>
            );
          })}
        </ol>
      ),
    });
    return extras;
  };
  const CLASH_LABELS: Record<StyleClashKey, string> = {
    rim: 'Attacking the rim vs rim protection',
    spacing: 'Shooting vs perimeter defense',
    star: 'Best scorer vs best stopper',
    glass: 'Rebounding',
  };

  const heroReport =
    heroRanked && heroFit ? (
      <TeamReport
        profile={profileRows(heroRanked.breakdown)}
        comp={bestHistoricalComp(displayTeam(heroRanked.team), heroRanked.breakdown, heroFit)}
        voices={heroVoices.slice(1)}
        extras={reportExtras(displayTeam(heroRanked.team), heroRanked.breakdown, heroFit)}
      />
    ) : null;

  // 2026-10-08, the user ("gracza bardziej interesuje na początku gdzie AI było lepsze"): right
  // under the result, the three scores where an AI team beat yours by the most, and which team.
  // Won it all: where the field came closest instead.
  const aiEdge = (() => {
    if (!heroRanked?.team.isHuman) return null;
    const mine = profileRows(heroRanked.breakdown);
    const rivals = ranked.filter((r) => r.team.id !== heroRanked.team.id);
    const rows = mine
      .map((row, k) => {
        const best = rivals.reduce((top, r) => (profileRows(r.breakdown)[k].value > profileRows(top.breakdown)[k].value ? r : top), rivals[0]);
        const theirs = profileRows(best.breakdown)[k].value;
        return { label: row.label, mine: Math.round(row.value), theirs: Math.round(theirs), team: best.team, gap: Math.round(theirs) - Math.round(row.value) };
      })
      .sort((x, y) => y.gap - x.gap)
      .slice(0, 3);
    const beaten = rows.some((r) => r.gap > 0);
    return (
      <>
        <h3 className="rr-section">{beaten ? 'Where the AI beat you' : 'Where the AI came closest'}</h3>
        <div className="rr-edge">
          {rows.map((r) => {
            const t = displayTeam(r.team);
            return (
              <div className="rr-edge-row" key={r.label}>
                <span className="rr-edge-label">{r.label}</span>
                <TeamMark code={codeByTeamId.get(r.team.id) ?? ''} name={t.name} />
                <span className="rr-edge-team">
                  <FitTeam name={teamLabel(t)} code={codeByTeamId.get(r.team.id)} />
                  <small>
                    {r.theirs} vs your {r.mine}
                  </small>
                </span>
                <b className={r.gap > 0 ? 'is-bad' : 'is-good'}>{r.gap > 0 ? `+${r.gap}` : r.gap === 0 ? '=' : r.gap}</b>
              </div>
            );
          })}
        </div>
      </>
    );
  })();

  const standings = (
    <div className="rr-standings">
      {ranked.map(({ team, breakdown, rank }) => {
        const shownTeam = displayTeam(team);
        const evalRow = leagueEvalByTeamId.get(team.id);
        const vs = humanEval?.matchups.find((m) => m.opponentId === team.id);
        const seriesPct = vs ? Math.round(vs.seriesWinProb * 100) : null;
        const isExpanded = !team.isHuman && expandedTeamIds.has(team.id);
        const odds = evalRow?.championshipProbability ?? null;
        const row = (
          <>
            <span className="rr-rk">{rank}</span>
            <TeamMark code={codeByTeamId.get(team.id) ?? ''} name={team.name} />
            <FitTeam className="rr-nm" name={teamLabel(team)} code={codeByTeamId.get(team.id)} after={team.isHuman && <em> · you</em>} />
            <span className="rr-od" title="Title odds: how often this team won a 16-team bracket of best-of-7 series, simulated 20,000 times.">
              {odds !== null ? `🏆 ${odds > 0 && odds < 0.01 ? '<1' : Math.round(odds * 100)}%` : ''}
            </span>
            <span className={`rr-ser${seriesPct === null ? '' : seriesPct >= 60 ? ' is-good' : seriesPct <= 40 ? ' is-bad' : ' is-even'}`}>
              {seriesPct === null ? '—' : `${seriesPct}%`}
            </span>
            <span className="rr-sc">{breakdown.overall}</span>
            <span className="rr-car" aria-hidden>{team.isHuman ? '' : isExpanded ? '▾' : '▸'}</span>
          </>
        );
        let body: ReactNode = null;
        if (isExpanded) {
          const fit = fitScore(shownTeam);
          const style = teamStyleFor(fit.inputs.primaryArchetype, fit.inputs.secondaryArchetype, fit.inputs.archetypeReport?.failureMode ?? null, breakdown.defenseScore, breakdown.offenseScore);
          const tier = resultTierLabel(rank, ranked.length);
          const theirStyle = humanStyle ? styleProfile(shownTeam) : null;
          const humanFit = humanTeam ? fitScore(humanTeam) : null;
          body = (
            <div className="rr-open" style={{ ['--team-hue' as string]: teamHue(team.name) }}>
              <div className="rr-open-head">
                <span className={`rr-tag rr-tag--t${tier.tone}`}>{tier.label}</span>
                <span className="rr-stat">Rating<b>{breakdown.overall}</b></span>
                {odds !== null && <span className="rr-stat">Title odds<b>{odds > 0 && odds < 0.01 ? '<1' : Math.round(odds * 100)}%</b></span>}
                {style.label && <span className="rr-stat">Style<b className="rr-stat-text">{style.label}</b></span>}
                {style.failureMode && <span className="rr-stat">Main risk<b className="rr-stat-text">{style.failureMode}</b></span>}
              </div>
              <RosterGrid team={shownTeam} />
              {vs && humanStyle && theirStyle && humanFit && (
                <VsYou
                  seriesPct={seriesPct ?? 50}
                  margin={vs.marginA}
                  explanation={explainMatchup({ own: humanFit, opponent: fit, seriesWinProb: vs.seriesWinProb })[0] ?? null}
                  clashes={styleClashBreakdown(humanStyle, theirStyle).map((c) => ({ label: CLASH_LABELS[c.key], net: c.a - c.b }))}
                />
              )}
              <TeamReport
                profile={profileRows(breakdown)}
                comp={bestHistoricalComp(shownTeam, breakdown, fit)}
                voices={theirVoices(shownTeam, breakdown, rank, ranked.length)}
                extras={reportExtras(shownTeam, breakdown, fit)}
              />
            </div>
          );
        }
        return (
          <div key={team.id} className={`rr-rung-wrap${team.isHuman ? ' is-you' : ''}${isExpanded ? ' is-open' : ''}`}>
            {team.isHuman ? (
              <div className="rr-rung">{row}</div>
            ) : (
              <button type="button" className="rr-rung" onClick={() => toggleExpanded(team.id)} aria-expanded={isExpanded}>
                {row}
              </button>
            )}
            {body}
          </div>
        );
      })}
    </div>
  );

  return (
    // 2026-08-16, user's own ask: same fixed-dark broadcast board as the Draft screen — see the
    // `.at-shell` token-aliasing comment in App.css for how the rest of this file's existing
    // classes (never touched here) pick up the dark palette just by being nested inside this.
    <div className="results-screen at-shell at-calm" style={heroRanked ? { ['--team-hue' as string]: teamHue(heroRanked.team.name) } : undefined}>
      {/* 2026-10-07, the UI simplification (approved mockup): the draft screen's one-row header. */}
      <div className="at-calm-header">
        <button type="button" className="at-calm-btn at-calm-btn--ghost" onClick={onRestart}>
          ← Menu
        </button>
        <h1 className="at-calm-title">All-Time Draft</h1>
        <span className="rs-header-spacer" aria-hidden />
      </div>
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
          assignments={heroAssignments}
          starterKeys={heroStarterKeys}
          topOverall={ranked[0]?.breakdown.overall ?? null}
          titleOdds={leagueEvalByTeamId.get(heroRanked.team.id)?.championshipProbability ?? null}
          draftSeed={draftSeed}
          challenger={challenger}
          seasonSimSlot={seasonSimSlot}
          identity={heroStyle.label}
          failureMode={heroStyle.failureMode}
          starters={heroStarters}
          teamCode={codeByTeamId.get(heroRanked.team.id) ?? ''}
          rosterTeam={displayTeam(heroRanked.team)}
          profile={profileRows(heroRanked.breakdown)}
          quote={heroVoices[0] ?? null}
          report={heroReport}
          standings={standings}
          aiEdge={aiEdge}
          onNewDraft={onRematch ? () => onRematch() : undefined}
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
      <div className="results-actions end-actions">
        {onRematch && (
          <button type="button" className="at-calm-btn" onClick={() => onRematch(draftSeed)}>Rematch this board</button>
        )}
        <button type="button" className="at-calm-btn at-calm-btn--ghost" onClick={onRestart}>Main menu</button>
        {TEAM_EXPORT_FOR_TESTING && (
          <FullExportButton
            build={() =>
              exportFullDraft({
                seed: draftSeed,
                teams: scoredTeams,
                history,
                codes: codeByTeamId,
                titleOdds: new Map(leagueEval.map((e) => [e.teamId, e.championshipProbability])),
                voices: (team) => {
                  const r = ranked.find((x) => x.team.id === team.id);
                  if (!r) return [];
                  return team.isHuman
                    ? yourVoices({ team: displayTeam(team), rank: r.rank, fieldSize: ranked.length, breakdown: r.breakdown, fieldMedians })
                    : theirVoices(displayTeam(team), r.breakdown, r.rank, ranked.length);
                },
                season: seasonState.status === 'done' ? seasonState.season : null,
                playoffs: seasonState.status === 'done' ? seasonState.playoffs : null,
              })
            }
            seed={draftSeed}
            seasonReady={seasonState.status === 'done'}
          />
        )}
      </div>
    </div>
  );
}

/** Engine calibration (testing): copies every team as text to paste into a calibration session;
 * falls back to downloading a .txt where the clipboard is unavailable. */
/** 2026-10-08, the user: one button that exports the whole draft — picks, scores, reports, the
 * season and the playoffs (`exportFullDraft`). It waits for the season so the file is complete,
 * saves a .txt and copies the same text. */
function FullExportButton({ build, seed, seasonReady }: { build: () => string; seed: number; seasonReady: boolean }) {
  const [state, setState] = useState<'idle' | 'done'>('idle');
  async function handle() {
    const text = build();
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `draftverse-${seed}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // The file is the export; the copy is a convenience.
    }
    setState('done');
  }
  return (
    <button className="secondary-btn team-export-btn" onClick={handle} disabled={!seasonReady} title="Every pick, every team's scores and report, the season and the playoffs, as one text file">
      {!seasonReady ? 'Export the draft (season still simulating…)' : state === 'done' ? `✓ Saved draftverse-${seed}.txt (also copied)` : 'Export the whole draft (testing)'}
    </button>
  );
}
