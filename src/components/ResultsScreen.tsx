import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { rankTeams, offenseScoreBreakdown, teamDefensiveTalentScore, calibrateOffenseToDefenseScale, talentOnDefenseScale, type ScoreBreakdown } from '../engine/scoring';
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
import { scoutStyleLine } from '../engine/styleLines';
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
import AllMetrics, { RivalEdge } from './AllMetrics';
import { teamMetricValues, type TeamMetricValues } from '../engine/teamMetrics';
import { downloadDuelCard, type ShareCardStarter, type ShareRosterRow } from './shareCardImage';
import { shortenName } from './ShotChip';
import SeasonView, { seasonPlayed, type SeasonState } from './SeasonView';
import { bestNight } from './SeasonCalendar';
import { teamNickname } from '../engine/teamNames';
import {
  fieldGrade,
  type ProfileRow,
  type ReportExtra,
} from './ResultsReport';
import { DESK_CAST, buildDesk, buildRivalDesk, theirVoice, type DeskLine } from '../engine/desk';
import { exportFullDraft } from '../engine/draftExport';
import type { DailyDraftDay } from '../dailyDraftDay';
import { saveDailyDraftResult, saveDailyDraftSeason } from './dailyDraftProgress';
import { DAILY_REPLAY_FOR_TESTING } from './dailyProgress';
import { copyLink } from './shareSave';
import { BombReveal } from './BombCards';
import { maskText } from './bombMask';
import type { PlayerSpan } from '../data/schema';
import { CAP_LIMIT } from '../engine/positions';
import { MetricTable } from './MetricTable';
import { Actions, Btn, Dialog, H3, Kv, Mast, NightGame, NightVoices, RosterList, Tally, fmtCaps } from '../night/ui';
import { LeagueMark } from '../night/league';
import { NightConfirm } from '../night/Dialogs';
import { ShareNight, type PosterData } from '../night/Share';

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
  /** Today's daily draft (2026-10-16): the result is saved for the day (place, Overall, then the
   * season) and shared as text; `onRematch` replays it only while testing. */
  daily?: DailyDraftDay;
  /** The Bomb daily: his reveal tops the results; `onNamed` lifts his mask everywhere. */
  bomb?: { span: PlayerSpan; gem: boolean; named: boolean; onNamed: () => void };
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

/** The link that gives a friend this exact board (`?draftSeed=`) with this result to beat: the
 * name, Overall, place, field, starting five, the seven scores and the rotation travel in the link
 * as positional tuples (`GameShell.tsx`'s `challengerFromUrl` decodes them), so their results screen
 * compares without a backend. */
function challengeUrl(o: {
  draftSeed: number;
  teamName: string;
  overall: number;
  rank: number;
  fieldSize: number;
  starters: ShareCardStarter[];
  scores: number[];
  assignments: ResolvedSlotAssignment[];
}): string {
  const url = new URL(window.location.href);
  const params = new URLSearchParams();
  params.set('draftSeed', String(o.draftSeed));
  params.set('cn', o.teamName);
  params.set('co', String(o.overall));
  params.set('cr', String(o.rank));
  params.set('cf', String(o.fieldSize));
  params.set('cs', JSON.stringify(o.starters.map((st) => [st.position, st.name])));
  params.set('cv', JSON.stringify(o.scores.map((v) => Math.round(v))));
  params.set('cx', JSON.stringify(o.assignments.map((x) => [x.slot, x.player.playerName, Math.round(x.minutes)])));
  url.search = `?${params.toString()}`;
  return url.toString();
}

/** A friend's challenge link opened this board: the two results side by side, the seven scores,
 * and the duel card to save. */
function ChallengeDuel({
  you,
  friend,
  scores,
  rotation,
  onClose,
}: {
  you: { name: string; overall: number; rank: number; fieldSize: number };
  friend: ChallengeChallenger;
  scores: number[];
  rotation: ResolvedSlotAssignment[];
  onClose: () => void;
}) {
  const [png, setPng] = useState<'idle' | 'building' | 'done' | 'error'>('idle');
  const won = you.overall > friend.overall ? true : you.overall < friend.overall ? false : null;
  const labels = ['Talent', 'Bench', 'Offense', 'Defense', 'Spacing', 'Fit', 'Rotation'];
  const theirs = friend.scores ? [friend.scores.talent, friend.scores.benchDepth, friend.scores.offense, friend.scores.defense, friend.scores.spacing, friend.scores.fit, friend.scores.rotation] : null;
  async function save() {
    setPng('building');
    try {
      const keys = ['talent', 'benchDepth', 'offense', 'defense', 'spacing', 'fit', 'rotation'] as const;
      const ok = await downloadDuelCard(
        {
          you: {
            ...you,
            rotation: rotation.map((x) => ({ slot: x.slot, name: x.player.playerName, minutes: Math.round(x.minutes) })),
            scores: Object.fromEntries(keys.map((k, i) => [k, Math.round(scores[i])])) as Record<(typeof keys)[number], number>,
          },
          friend: { name: friend.name, overall: friend.overall, rank: friend.rank, fieldSize: friend.fieldSize, rotation: friend.rotation ?? [], scores: friend.scores },
        },
        `all-time-draft-duel-${you.name.replace(/\s+/g, '-').toLowerCase()}.png`,
      );
      setPng(ok ? 'done' : 'error');
    } catch {
      setPng('error');
    }
    setTimeout(() => setPng('idle'), 2000);
  }
  return (
    <Dialog title={won ? 'You win the duel' : won === false ? 'Your friend wins this one' : 'A tie'} onClose={onClose}>
      <p className="lead">Same 16-team board, same AI, two different drafts.</p>
      <table className="stand2 duel-t">
        <thead>
          <tr>
            <th />
            <th>You</th>
            <th>{friend.name}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="you">
            <td className="nm">Rating</td>
            <td>{you.overall}</td>
            <td>{friend.overall}</td>
          </tr>
          <tr>
            <td className="nm">Place</td>
            <td>
              {ordinal(you.rank)} / {you.fieldSize}
            </td>
            <td>
              {ordinal(friend.rank)} / {friend.fieldSize}
            </td>
          </tr>
          {theirs &&
            labels.map((l, i) => (
              <tr key={l}>
                <td className="nm">{l}</td>
                <td>
                  {Math.round(scores[i])}
                  {Math.round(scores[i]) > theirs[i] && <span className="up"> ▲</span>}
                </td>
                <td>
                  {theirs[i]}
                  {theirs[i] > Math.round(scores[i]) && <span className="up"> ▲</span>}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="btn2" style={{ marginTop: 16 }}>
        <Btn onClick={save} disabled={png === 'building'}>
          {png === 'building' ? 'Building…' : png === 'done' ? '✓ Saved' : png === 'error' ? 'Failed, try again' : 'Save the duel card'}
        </Btn>
        <Btn kind="line" onClick={onClose}>
          Back to the results
        </Btn>
      </div>
    </Dialog>
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
  seed,
}: {
  team: Team;
  rank: number;
  fieldSize: number;
  breakdown: ScoreBreakdown;
  fieldMedians: Record<string, number>;
  seed: number;
}): DeskLine[] {
  const snapshot = buildTeamFeatureSnapshot(team);
  const insights = generateRosterInsights(snapshot, undefined, insightContextFor(breakdown, rank, fieldSize));
  const podium = rank <= 3;
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
  // 2026-10-14: "The Desk" (engine/desk.ts) — the same findings, voiced by the panel; the host
  // closes with next draft's tip, which the podium never hears.
  return buildDesk({
    team,
    strengths: insights.strengths,
    concerns: insights.concerns,
    rank,
    fieldSize,
    style: scoutStyleLine(snapshot, insights.strengths.slice(0, podium ? 3 : 2).map((i) => i.id))?.text,
    tip: !podium && weakestLabel ? nextDraftTip(weakestLabel, team) : undefined,
    seed,
  });
}

/** A rival's panel — the same insight engine, about them: what works, and what can sink them. */
function theirVoices(team: Team, breakdown: ScoreBreakdown, rank: number, fieldSize: number, seed: number): DeskLine[] {
  const snapshot = buildTeamFeatureSnapshot(team);
  const insights = generateRosterInsights(snapshot, undefined, insightContextFor(breakdown, rank, fieldSize));
  return buildRivalDesk({
    strengths: insights.strengths,
    concerns: insights.concerns,
    style: scoutStyleLine(snapshot, insights.strengths.slice(0, rank <= 3 ? 3 : 2).map((i) => i.id))?.text,
    rank,
    seed: seed + team.draftSlot,
    third: theirVoice,
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
  const [all, setAll] = useState(false);
  const offenseDetail = offenseScoreBreakdown(team);
  const defenseTalent = Math.round(teamDefensiveTalentScore(team));
  const weakDefenders = weakDefendersFor(team);
  const profile = seasonProfile(breakdown, fit);
  return (
    <>
      <div className="split">
        <section>
          <H3 note={`score ${Math.round(breakdown.offenseScore)}`}>Offense details</H3>
          <MetricTable
            rows={[
              { label: 'O-TAL', value: offenseScale(offenseDetail.otal), hint: 'Team offensive talent.' },
              { label: 'Creation', value: offenseScale(fit.components.creationStructure), hint: 'Half-court shot creation the roster can generate on its own.' },
              { label: 'Rim pressure', value: offenseScale(fit.components.rimPressureTeam), hint: 'How much the five collectively bends a defense at the rim.' },
              { label: 'Playmaking', value: offenseScale(offenseDetail.playmaking), hint: 'Passing and table-setting: how well the roster creates shots for others, not just for itself.' },
              { label: 'Title structure', value: fit.components.championshipStructure, hint: "How closely the roster's shape matches real championship rosters." },
            ]}
          />
        </section>
        <section>
          <H3 note={`score ${Math.round(breakdown.defenseScore)}`}>Defense details</H3>
          <MetricTable
            rows={[
              { label: 'D-TAL', value: defenseTalent, hint: 'Team defensive talent: the minutes-weighted D-TAL the Defense score starts from, before hunting risk and team structure.' },
              { label: 'Role coverage', value: fit.components.defensiveRoleCoverage, hint: 'Whether someone covers each defensive job: point of attack, wing, rim.' },
              { label: 'Switchability', value: fit.components.switchability, hint: 'How freely the roster can switch across a screen without a mismatch.' },
              { label: 'Hunt resistance', value: fit.components.huntResistance, hint: 'How well the roster hides its weakest defender in a playoff series.' },
              { label: 'Rebounding', value: fit.components.reboundingBalance, hint: 'Two-way rebounding balance.' },
              { label: 'Size', value: fit.components.sizeCoverage, hint: 'Functional positional size across the lineup.' },
            ]}
          />
          {weakDefenders.length > 0 && (
            <p className="empty-note" style={{ marginTop: 8 }}>
              Weakest links:{' '}
              {weakDefenders.map((row, i) => (
                <span key={row.name}>
                  {i > 0 && ' · '}
                  <b>{shortenName(row.name)}</b> D-TAL {row.dtal} at {row.slot} ({row.minutes} min)
                </span>
              ))}
            </p>
          )}
        </section>
      </div>
      <section>
        <p className="host">
          <b>Season profile:</b> {profile.label} (regular season {profile.regularSeason} · playoffs {profile.playoffs}). {profile.explanation}
        </p>
        <p className="empty-note">
          These are the ingredients behind the scores, measured separately: Role coverage is whether each defensive job is filled at all, the Defense score is how well it’s done.
        </p>
        <button type="button" className="lk-inline" style={{ marginTop: 10 }} onClick={() => setAll((v) => !v)}>
          {all ? 'Hide all metrics & inputs ▴' : 'All metrics & inputs ▾'}
        </button>
      </section>
      {all && (
        <AllMetrics
          values={teamMetricValues(team, fit)}
          field={field()}
          offenseScore={breakdown.offenseScore}
          defenseScore={breakdown.defenseScore}
          fit={fit}
          huntability={defensiveHuntability(team)}
          comp={bestHistoricalComp(team, breakdown, fit)}
        />
      )}
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

export default function ResultsScreen({ teams, history, onRestart, onRematch, draftSeed, challenger, daily, bomb }: Props) {
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

  /** The rotation actually shown on this screen for a team — its correction if one was made,
   * otherwise the original auto-assigned one. Every display/render site below should read
   * through this, not `team.rotation` directly, so a saved correction is reflected everywhere
   * (minutes list, bench, scoring) immediately, not just in the export. */
  function displayTeam(team: Team): Team {
    const correction = correctedRotations[team.id];
    return correction ? { ...team, rotation: correction } : team;
  }

  const codeByTeamId = useMemo(() => teamCodes(teams), [teams]);
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
    { label: 'Talent', value: talentOnDefenseScale(b.talentScore), grade: fieldGrade(b.talentScore, fieldScores.talent) },
    { label: 'Offense', value: b.offenseScore, grade: fieldGrade(b.offenseScore, fieldScores.offense) },
    { label: 'Defense', value: b.defenseScore, grade: fieldGrade(b.defenseScore, fieldScores.defense) },
    { label: 'Spacing', value: b.spacingScore, grade: fieldGrade(b.spacingScore, fieldScores.spacing) },
    { label: 'Fit', value: b.fitScore, grade: fieldGrade(b.fitScore, fieldScores.fit) },
    { label: 'Bench', value: b.benchDepthScore, grade: fieldGrade(b.benchDepthScore, fieldScores.bench) },
    { label: 'Rotation', value: b.rotationScore, grade: fieldGrade(b.rotationScore, fieldScores.rotation) },
  ];
  const humanTeam = scoredTeams.find((team) => team.isHuman);
  const humanEval = humanTeam ? leagueEvalByTeamId.get(humanTeam.id) : undefined;
  const heroVoices = useMemo(
    () =>
      heroRanked?.team.isHuman
        ? yourVoices({ team: displayTeam(heroRanked.team), rank: heroRanked.rank, fieldSize: ranked.length, breakdown: heroRanked.breakdown, fieldMedians, seed: draftSeed })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [heroRanked, ranked.length, fieldMedians, draftSeed],
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
        <table className="log">
          <tbody>
            {teamHistory.map((entry) => {
              const p = playerById(entry.playerId);
              return (
                <tr key={entry.pickNumber} className={team.isHuman ? 'y' : 'a'}>
                  <td className="n">{entry.pickNumber}</td>
                  <td className="w">{p?.primaryPosition ?? ''}</td>
                  <td className="p">{p ? `${maskText(p.playerName)}, ${p.spanLabel}` : entry.playerId}</td>
                  <td className="c">{p ? fmtCaps(p.fga) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ),
    });
    return extras;
  };

  // 2026-10-09, descriptions plan: once the season has been played, one line on whether it agreed
  // with the grade — within two places of the draft rank, or not.
  const seasonVerdictLine = (() => {
    if (!heroRanked?.team.isHuman || seasonState.status !== 'done') return null;
    const place = seasonState.season.standings.findIndex((r) => r.teamId === heroRanked.team.id) + 1;
    if (place < 1) return null;
    const row = seasonState.season.standings[place - 1];
    const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
    return Math.abs(place - heroRanked.rank) <= 2
      ? `The season agreed: ${row.wins}-${row.losses}, ${ord(place)}.`
      : `The season disagreed: ${row.wins}-${row.losses}, ${ord(place)} (the draft grade had you ${ord(heroRanked.rank)}).`;
  })();


  // 2026-10-08, the user ("gracza bardziej interesuje na początku gdzie AI było lepsze niż dlaczego
  // w PO mamy mniejsze szanse"): an opened rival starts with the scores where they beat you, by how
  // much; then your series odds against them, their roster and their report.
  const humanRanked = ranked.find((r) => r.team.isHuman);

  // 2026-10-16, the daily drafts: the day keeps its first result — the place and Overall now, the
  // season once it has been played (the user: points for both, to a leaderboard later).
  const dailySeason = useMemo(() => {
    if (!daily || !humanRanked || seasonState.status !== 'done') return null;
    const id = humanRanked.team.id;
    const place = seasonState.season.standings.findIndex((r) => r.teamId === id) + 1;
    const row = seasonState.season.standings[place - 1];
    if (!row) return null;
    const series = (seasonState.playoffs?.rounds ?? []).flat().filter((s) => s.teamAId === id || s.teamBId === id);
    const last = series[series.length - 1];
    const playoffs = seasonState.playoffs?.championId === id ? 'Champions' : last ? `Out in the ${last.roundLabel}` : 'Missed the playoffs';
    return { wins: row.wins, losses: row.losses, place, playoffs };
  }, [daily, humanRanked, seasonState]);
  useEffect(() => {
    if (daily && !daily.testing && humanRanked) saveDailyDraftResult(daily.mode, daily.day, { place: humanRanked.rank, field: ranked.length, overall: humanRanked.breakdown.overall });
  }, [daily, humanRanked, ranked.length]);
  useEffect(() => {
    if (daily && !daily.testing && dailySeason) saveDailyDraftSeason(daily.mode, daily.day, dailySeason);
  }, [daily, dailySeason]);
  const [dailyCopied, setDailyCopied] = useState(false);
  async function copyDailyResult() {
    if (!daily || !humanRanked) return;
    // No names: the same draft is everyone's today.
    const lines = [
      `Draftverse Daily · ${daily.mode === 'bomb' ? 'The Bomb' : 'All-Time'} · ${daily.day}`,
      daily.bomb ? `${daily.cap} caps · 💣 round ${daily.bomb.round}${bomb?.named ? (daily.bomb.gem ? ' · a gem' : ' · a role player') : ''}` : `${daily.cap} caps · ${daily.title}`,
      `Draft: ${ordinal(humanRanked.rank)} / ${ranked.length} · ${humanRanked.breakdown.overall}`,
    ];
    if (dailySeason) lines.push(`Season: ${dailySeason.wins}-${dailySeason.losses} · ${dailySeason.playoffs}`);
    if (await copyLink(lines.join('\n'))) {
      setDailyCopied(true);
      setTimeout(() => setDailyCopied(false), 2000);
    }
  }
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [openExtra, setOpenExtra] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [duelOpen, setDuelOpen] = useState(() => challenger !== undefined);
  const [linkCopied, setLinkCopied] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);

  if (!heroRanked) return null;
  const hero = heroRanked;
  const played = seasonState.status === 'done' && seasonState.playoffs !== null && seasonPlayed(scoredTeams);
  const heroTeam = displayTeam(hero.team);
  const fieldSize = ranked.length;
  const tier = resultTierLabel(hero.rank, fieldSize);
  const best = ranked[0]?.breakdown.overall ?? hero.breakdown.overall;
  const titleOdds = leagueEvalByTeamId.get(hero.team.id)?.championshipProbability ?? null;
  const pct = (v: number | null) => (v === null ? '—' : v > 0 && v < 0.01 ? '<1%' : `${Math.round(v * 100)}%`);
  const capsUsed = heroTeam.roster.reduce((sum, sp) => sum + sp.fga, 0);
  const capLimit = daily?.cap ?? CAP_LIMIT;
  const heroScores = [hero.breakdown.talentScore, hero.breakdown.benchDepthScore, hero.breakdown.offenseScore, hero.breakdown.defenseScore, hero.breakdown.spacingScore, hero.breakdown.fitScore, hero.breakdown.rotationScore];
  const link = challengeUrl({ draftSeed, teamName: hero.team.name, overall: hero.breakdown.overall, rank: hero.rank, fieldSize, starters: heroStarters, scores: heroScores, assignments: heroAssignments });
  async function challengeFriend() {
    if (await copyLink(link)) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }
  const myPicks = history.filter((h) => h.teamId === hero.team.id).sort((x, y) => x.pickNumber - y.pickNumber);
  const prof = profileRows(hero.breakdown);
  const weakest = [...prof].sort((x, y) => x.value - (fieldMedians[x.label === 'Bench' ? 'Bench Depth' : x.label] ?? 0) - (y.value - (fieldMedians[y.label === 'Bench' ? 'Bench Depth' : y.label] ?? 0)))[0];
  const strongest = [...prof].sort((x, y) => y.value - (fieldMedians[y.label === 'Bench' ? 'Bench Depth' : y.label] ?? 0) - (x.value - (fieldMedians[x.label === 'Bench' ? 'Bench Depth' : x.label] ?? 0)))[0];
  const quote = heroVoices.find((l) => l.kind === 'praise' || l.kind === 'concern') ?? null;

  // Your roster by slot: the starter on the card, who comes in for him underneath.
  const bySlot = STARTER_SLOTS.map((slot) => {
    const rows = heroAssignments.filter((x) => x.slot === slot);
    const starter = rows.find((x) => heroStarterKeys.has(`${x.slot}|${x.player.id}`)) ?? rows[0];
    const others = rows.filter((x) => x !== starter).sort((x, y) => y.minutes - x.minutes);
    return { slot, starter, others };
  });
  const playing = new Set(heroAssignments.map((x) => x.player.id));
  const dnp = heroTeam.roster.filter((sp) => !playing.has(sp.id));

  const poster: PosterData = {
    daily: Boolean(daily),
    mode: daily ? (daily.mode === 'bomb' ? 'The Bomb · daily' : 'All-Time Draft · daily') : 'All-Time Draft',
    date: daily ? new Date(`${daily.day}T12:00:00`) : new Date(),
    kick: `${tier.label} · ${ordinal(hero.rank)} of ${fieldSize}`,
    head: teamLabel(hero.team),
    line: `Rating ${hero.breakdown.overall} · best ${best} · title odds ${pct(titleOdds)}`,
    five: bySlot.flatMap((x) => (x.starter ? [{ span: x.starter.player, num: Math.round(x.starter.player.fga * 10) / 10 }] : [])),
    bench: heroTeam.roster.filter((sp) => !bySlot.some((x) => x.starter?.player.id === sp.id)).map((sp) => ({ span: sp, num: Math.round(sp.fga * 10) / 10 })),
    unit: 'caps',
    prof: prof.slice(0, 5).map((r) => ({ label: r.label, value: Math.round(r.value), tone: r === weakest ? 'lo' : r === strongest ? 'hi' : undefined })),
    strip: [
      ['Place', ordinal(hero.rank)],
      ['Rating', hero.breakdown.overall],
      ['Best', best],
      ['Title', pct(titleOdds)],
    ],
    foot: daily ? 'One board for everyone today' : 'Same 16 teams, your turn · challenge link',
  };

  const links = { onMenu: () => setExitOpen(true) };
  const aside = (
    <>
      <Mast title={daily ? (daily.mode === 'bomb' ? 'Daily Bomb' : 'Daily All-Time Draft') : 'All-Time Draft'} daily={!!daily} sub={daily ? `${daily.title} · final` : `Final · ${fieldSize} teams · 9 rounds`} />
      <Tally you={ordinal(hero.rank)} mid={hero.breakdown.overall} ai={pct(titleOdds)} youK="Place" midK="Rating" aiK="Title" plain />
      <section>
        {/* Caps, not a pick count (mockup MC2): the nine are on the list below. */}
        <H3 note={`${fmtCaps(capsUsed)} / ${fmtCaps(capLimit)} caps`}>Your draft</H3>
        <table className="log">
          <tbody>
            {myPicks.map((h) => {
              const sp = playerById(h.playerId) ?? heroTeam.roster.find((r) => r.id === h.playerId);
              return (
                <tr key={h.pickNumber} className="y">
                  <td className="n">{h.pickNumber}</td>
                  <td className="w">{sp?.primaryPosition ?? ''}</td>
                  <td className="p">{sp ? maskText(sp.playerName) : h.playerId}</td>
                  <td className="c">{sp ? fmtCaps(sp.fga) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {challenger && (
        <section>
          <H3>The duel</H3>
          <Kv k={challenger.name} v={challenger.overall} />
          <Kv k="You" v={hero.breakdown.overall} />
        </section>
      )}
      <Actions links={{ ...links, menuPhoneOnly: true }}>
        <Btn onClick={() => setSeasonOpen(true)}>{played ? 'Open the season →' : 'Play the season →'}</Btn>
        <div className="btn2">
          <Btn kind="line" onClick={() => setShareOpen(true)}>
            Share
          </Btn>
          {daily ? (
            <Btn kind="line" onClick={copyDailyResult}>
              {dailyCopied ? '✓ Copied' : 'Copy result'}
            </Btn>
          ) : (
            <Btn kind="line" onClick={challengeFriend}>
              {linkCopied ? '✓ Copied' : 'Challenge'}
            </Btn>
          )}
        </div>
        {challenger && (
          <Btn kind="line" onClick={() => setDuelOpen(true)}>
            Compare with your friend
          </Btn>
        )}
        {!daily && onRematch && (
          <>
            <Btn kind="line" onClick={() => onRematch()}>
              New draft
            </Btn>
            <Btn kind="line" onClick={() => onRematch(draftSeed)}>
              Rematch this board
            </Btn>
          </>
        )}
        {daily && DAILY_REPLAY_FOR_TESTING && onRematch && (
          <Btn kind="line" onClick={() => onRematch()}>
            Replay (testing)
          </Btn>
        )}
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
                  const lines = team.isHuman
                    ? yourVoices({ team: displayTeam(team), rank: r.rank, fieldSize: ranked.length, breakdown: r.breakdown, fieldMedians, seed: draftSeed })
                    : theirVoices(displayTeam(team), r.breakdown, r.rank, ranked.length, draftSeed);
                  return lines.map((l) => ({ who: DESK_CAST[l.who].name, what: l.kind, text: l.text }));
                },
                season: seasonState.status === 'done' ? seasonState.season : null,
                playoffs: seasonState.status === 'done' ? seasonState.playoffs : null,
              })
            }
            seed={draftSeed}
            seasonReady={seasonState.status === 'done'}
          />
        )}
        {/* a real button, not only the small "← Menu" link (playtest 2026-10-22) */}
        <Btn kind="line" onClick={links.onMenu}>
          Main menu
        </Btn>
      </Actions>
    </>
  );

  const extras = reportExtras(heroTeam, hero.breakdown, heroFit ?? fitScore(heroTeam));
  const overlay = (
    <>
      {shareOpen && <ShareNight d={poster} link={daily ? undefined : link} fileName={teamLabel(hero.team)} onClose={() => setShareOpen(false)} />}
      {duelOpen && challenger && (
        <ChallengeDuel
          you={{ name: hero.team.name, overall: hero.breakdown.overall, rank: hero.rank, fieldSize }}
          friend={challenger}
          scores={heroScores}
          rotation={heroAssignments}
          onClose={() => setDuelOpen(false)}
        />
      )}
      {exitOpen && (
        <NightConfirm title="Back to the menu?" lead="Your draft is graded and kept in this result only until you leave." yes="Stay" no="Back to menu" onYes={() => setExitOpen(false)} onNo={onRestart} />
      )}
    </>
  );

  if (seasonOpen) {
    return <SeasonView teams={scoredTeams} codes={codeByTeamId} state={seasonState} onClose={() => setSeasonOpen(false)} end={{ onMenu: onRestart, onNewDraft: !daily && onRematch ? () => onRematch() : undefined }} />;
  }

  // 2026-10-22, playtest ("brakuje informacji kto wygrał mistrzostwo", "jak damy back to the results
  // to powinno być jakieś podsumowanie sezonu"; mockup `alltime.html` #yourSeason): once the season
  // has been played to the end, the results carry it.
  let yourSeason: ReactNode = null;
  if (played && seasonState.status === 'done' && seasonState.playoffs) {
    const { season, playoffs } = seasonState;
    const id = hero.team.id;
    const seed = season.standings.findIndex((r) => r.teamId === id) + 1;
    const row = season.standings[seed - 1];
    const runs = playoffs.rounds.flat().filter((x) => x.teamAId === id || x.teamBId === id);
    const last = runs[runs.length - 1];
    const result = playoffs.championId === id ? 'Champions' : last ? `Out in the ${last.roundLabel.replace('Quarterfinals', 'quarters').replace('Semifinals', 'semis')}` : 'Missed the playoffs';
    const champ = scoredTeams.find((t) => t.id === playoffs.championId);
    const mine = season.players.filter((l) => l.teamId === id);
    const scorer = [...mine].filter((l) => l.games >= 20).sort((a, b) => b.totals.pts / b.games - a.totals.pts / a.games)[0];
    const last1 = (n: string) => maskText(n).split(' ').slice(-1)[0];
    const a = season.awards;
    const awards = [
      a.mvp?.teamId === id && `${last1(a.mvp.span.playerName)} MVP`,
      a.dpoy?.teamId === id && `${last1(a.dpoy.span.playerName)} DPOY`,
      a.sixthMan?.teamId === id && `${last1(a.sixthMan.span.playerName)} Sixth Man`,
      ...a.allNba.flatMap((team, k) => team.filter((l) => l.teamId === id).map((l) => `${last1(l.span.playerName)} All-NBA ${['1st', '2nd', '3rd'][k]}`)),
      ...a.allDefense.flatMap((team, k) => team.filter((l) => l.teamId === id).map((l) => `${last1(l.span.playerName)} All-Defense ${['1st', '2nd'][k]}`)),
    ].filter((x): x is string => Boolean(x));
    const night = bestNight(season, id);
    const nightTop = night ? night.game.top[night.side] : null;
    const nightSpan = nightTop ? mine.find((l) => l.span.id === nightTop.spanId)?.span : undefined;
    const nightOpp = night ? scoredTeams.find((t) => t.id === (night.side === 0 ? night.game.bId : night.game.aId)) : undefined;
    const ordinalOf = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
    yourSeason = (
      <section className="ysea">
        <H3 note="played">Your season</H3>
        <div className="ysea-strip">
          <div>
            <span>Season</span>
            <b>
              {row.wins}–{row.losses}
            </b>
          </div>
          <div>
            <span>Seed</span>
            <b>{ordinalOf(seed)}</b>
          </div>
          <div>
            <span>Playoffs</span>
            <b className="w">{playoffs.championId === id ? '🏆 Champions' : result}</b>
          </div>
          <div>
            <span>Champions</span>
            <b className="w">
              {champ && <LeagueMark name={champ.name} code={codeByTeamId.get(champ.id) ?? ''} />} {champ ? teamNickname(champ.name) : '—'}
            </b>
          </div>
        </div>
        <div className="ysea-rows">
          <Kv k="Awards" v={awards.length ? awards.slice(0, 3).join(' · ') : 'none this year'} />
          <Kv k="Best scorer" v={scorer ? `${last1(scorer.span.playerName)} ${(scorer.totals.pts / scorer.games).toFixed(1)}` : '—'} />
          <Kv k="Game of the season" v={nightTop && nightSpan ? `${last1(nightSpan.playerName)} ${nightTop.line.pts} vs ${nightOpp ? teamNickname(nightOpp.name) : ''}` : '—'} />
          <Kv k="The draft said" v={`${ordinalOf(hero.rank)} · the season ${Math.abs(seed - hero.rank) <= 2 ? 'agreed' : 'disagreed'}`} />
        </div>
      </section>
    );
  }

  return (
    <NightGame aside={aside} overlay={overlay}>
      {bomb && <BombReveal span={bomb.span} gem={bomb.gem} onNamed={bomb.onNamed} />}
      <div className="headline">
        <span className="eb">{daily ? `Daily · ${daily.title}` : 'Final standings'}</span>
        <b>{teamLabel(hero.team)}</b>
        <i>{seasonVerdictLine ?? `9 rounds · ${history.length} picks · season not played yet`}</i>
      </div>
      <div className="verdict vmini">
        <div className="place">
          <b>
            {hero.rank}
            <sup>{ordinal(hero.rank).slice(String(hero.rank).length)}</sup>
          </b>
          <span>of {fieldSize}</span>
        </div>
        <div className="tier">
          <span className="eb">The verdict</span>
          <h2>{tier.label}</h2>
          <p>
            {heroStyle.label ? `${heroStyle.label}.` : ''}
            {heroStyle.failureMode && (
              <>
                {' '}
                Main risk: <b style={{ color: 'var(--red)', fontStyle: 'normal' }}>{heroStyle.failureMode}</b>.
              </>
            )}
          </p>
        </div>
        <div className="nums">
          <div className="you">
            <span>Your team</span>
            <b>{hero.breakdown.overall}</b>
          </div>
          <div>
            <span>Best</span>
            <b>{best}</b>
          </div>
          <div>
            <span>Title odds</span>
            <b>{pct(titleOdds)}</b>
          </div>
        </div>
      </div>
      {yourSeason}
      {quote && (
        <p className="host">
          <b>{DESK_CAST[quote.who].name}:</b> “{maskText(quote.text).replace(/\s*\*.+?\*\s*/g, ' ').trim()}”
        </p>
      )}
      <section>
        <H3 note="starter · bench minutes">Your roster</H3>
        <RosterList
          rows={bySlot.map(({ slot, starter, others }) => ({
            slot,
            starter: starter ? { span: starter.player, minutes: starter.minutes } : undefined,
            bench: others.map((o) => ({ span: o.player, minutes: o.minutes })),
          }))}
        />
        <p className="empty-note dnp-note" style={{ marginTop: 8 }}>
          Did not play: {dnp.length ? dnp.map((sp) => maskText(sp.playerName)).join(', ') : 'none'}.
        </p>
      </section>
      <div className="split">
        <section>
          <H3 note="yours · grade vs the field">{hero.rank === 1 ? 'Why you won' : 'Why you finished here'}</H3>
          <table className="profile">
            <tbody>
              {prof.map((r) => (
                <tr key={r.label} className={r === weakest ? 'weak' : r === strongest ? 'good' : undefined}>
                  <td className="l">{r.label}</td>
                  <td className="v">
                    {Math.round(r.value)}
                    {r === weakest && <span className="visually-hidden"> weak</span>}
                  </td>
                  <td className="b">{r.grade}</td>
                  <td>
                    <div className="bar">
                      <i style={{ width: `${Math.max(0, Math.min(100, r.value))}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {heroVoices.length > 0 && (
          <section className="voices">
            <H3>The room</H3>
            <NightVoices voices={heroVoices} cast={DESK_CAST} fold={5} />
          </section>
        )}
      </div>
      <section className="acc">
        <H3 note="tap to open">More</H3>
        {extras.map((e) => (
          <div key={e.id}>
            <button type="button" className="acc-row" aria-expanded={openExtra === e.id} onClick={() => setOpenExtra((cur) => (cur === e.id ? null : e.id))}>
              {e.label} <i>{openExtra === e.id ? '▾' : '▸'}</i>
            </button>
            {openExtra === e.id && <div className="acc-body">{e.content()}</div>}
          </div>
        ))}
      </section>
      <section>
        <H3 note="series = your chance to beat them in a best-of-7">Final standings</H3>
        <table className="stand2 st-at">
          <thead>
            <tr>
              <th>#</th>
              <th />
              <th>Team</th>
              <th>Title</th>
              <th>Series</th>
              <th>Rating</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ team, breakdown, rank }) => {
              const odds = leagueEvalByTeamId.get(team.id)?.championshipProbability ?? null;
              const vs = humanEval?.matchups.find((m) => m.opponentId === team.id);
              const open = openTeam === team.id;
              const mine = humanRanked ? profileRows(humanRanked.breakdown) : [];
              const edgeRows = profileRows(breakdown).map((r, k) => ({ label: r.label, theirs: Math.round(r.value), mine: Math.round(mine[k]?.value ?? 0) }));
              const nick = teamLabel(team).split(' ').slice(-1)[0];
              return (
                <Fragment key={team.id}>
                  <tr className={team.isHuman ? 'you' : 'tap'} onClick={team.isHuman ? undefined : () => setOpenTeam(open ? null : team.id)}>
                    <td className="rk">{rank}</td>
                    <td className="tmc">
                      <LeagueMark name={team.name} code={codeByTeamId.get(team.id) ?? ''} />
                    </td>
                    <td className="nm">{teamLabel(team)}</td>
                    <td>{pct(odds)}</td>
                    <td>{vs ? `${Math.round(vs.seriesWinProb * 100)}%` : '—'}</td>
                    <td>{breakdown.overall}</td>
                    <td className="car">{team.isHuman ? '' : open ? '▾' : '▸'}</td>
                  </tr>
                  {open && (
                    <tr className="open">
                      <td />
                      <td colSpan={6}>
                        {/* their five first, as cards: who they are matters most (playtest 2026-10-22) */}
                        {(() => {
                          // the same list as your roster: the starter's minutes, who comes in for him (playtest: "brak minut i ławki")
                          const shown = displayTeam(team);
                          const rows = allAssignments(shown);
                          return (
                            <RosterList
                              compact
                              rows={primaryStarters(shown).map((x) => {
                                const own = rows.find((r) => r.slot === x.slot && r.player.id === x.player.id);
                                const others = rows.filter((r) => r.slot === x.slot && r.player.id !== x.player.id).sort((p, q) => q.minutes - p.minutes);
                                return { slot: x.slot, starter: { span: x.player, minutes: own?.minutes ?? x.minutes }, bench: others.map((o) => ({ span: o.player, minutes: o.minutes })) };
                              })}
                            />
                          );
                        })()}
                        <RivalEdge nick={nick} scores={edgeRows} metrics={() => ({ theirs: teamMetricValues(team), mine: humanRanked ? teamMetricValues(humanRanked.team) : {} })} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
      <Btn className="phone-only" onClick={() => setSeasonOpen(true)}>
        {played ? 'Open the season →' : 'Play the season →'}
      </Btn>
    </NightGame>
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
    <button type="button" className="btn line team-export-btn" onClick={handle} disabled={!seasonReady} title="Every pick, every team's scores and report, the season and the playoffs, as one text file">
      {!seasonReady ? 'Export the draft (season still simulating…)' : state === 'done' ? `✓ Saved draftverse-${seed}.txt (also copied)` : 'Export the whole draft (testing)'}
    </button>
  );
}
