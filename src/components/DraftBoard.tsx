import { useMemo, useState } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { TEAM_COUNT, ROUNDS, currentTeamIndex, isPickLegal, type DraftState } from '../engine/draft';
import { CAP_LIMIT, ROSTER_SIZE, capRemaining, totalFga } from '../engine/positions';
import { computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { effectiveTalent } from '../engine/grades';
import { computeOffensivePortability, computeDefensivePortability } from '../engine/portability';
import { computeSpacing, spacingTier, type SpacingTier } from '../engine/spacing';
import { spanEndYears } from '../engine/era';
import { allStarCount } from '../engine/allStarLookup';
import { spanOptionsFor } from '../engine/spanOptimizer';
import RotationBuilder from './RotationBuilder';
import type { Rotation } from '../engine/types';
import {
  offensiveGrade,
  defensiveGrade,
  offensivePortabilityGrade,
  defensivePortabilityGrade,
  overallTierForSpan,
  displayTalentForSpan,
  displayNumberForSpan,
  tierRank,
  type OverallTier,
  type Grade,
} from '../engine/grades';
// The sixth-man-aware version of `tierContextFor` — see `tierContextWithSixthMan`'s own docstring
// for why this lives in `sixthMan.ts` rather than `grades.ts`. Aliased to the same name so every
// existing call site in this file (and `DraftPoolBrowser.tsx`, which imports it from here) keeps
// working unchanged and automatically picks up the 'Sixth Man' relabel.
import { tierContextWithSixthMan as tierContextFor } from '../engine/sixthMan';
import { playoffPerformanceTier, type PlayoffPerformanceTier } from '../engine/playoffPerformanceLookup';
import { computeDurability, durabilityTier, type DurabilityTier } from '../engine/durability';
import { isSmallSampleSpan, sampleSizeGames } from '../engine/sampleSize';
import { buildEvidenceReport } from '../engine/evidenceReport';
import { naturalPosition } from '../engine/naturalPosition';
import DraftHistory from './DraftHistory';
import { teamLabel, teamCodes } from '../engine/teamNames';
import type { FeedbackEntry } from './FeedbackToggle';

/** Max player rows the Draft tab renders at once. The list is tier-sorted, so this is the top-N
 * players; anyone past it is reachable via search or a position filter (both land well under the
 * cap). Rendering all ~720 as expandable accordion rows was ~11s per keystroke. */
const DRAFT_LIST_LIMIT = 140;

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
  /** 2026-08-16, user's own ask: the old "Choose Each Player's Span" screen and the rotation-
   * builder screen both went away as separate phases — both now live inside the Team tab below
   * (see that tab's own render block for the full rationale), ending in this one callback once
   * the human hits Submit. */
  onSubmitTeam: (roster: PlayerSpan[], rotation: Rotation) => void;
}

export const ALL_POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

// Re-exported so `DraftPoolBrowser.tsx`'s existing `import { naturalPosition } from './DraftBoard'`
// keeps working unchanged — the actual implementation moved to `engine/naturalPosition.ts` (see
// that file's own docstring) specifically so `ResultsScreen.tsx` could use it too without
// statically pulling in this whole (deliberately lazy-loaded) component.
export { naturalPosition } from '../engine/naturalPosition';

export interface PlayerGroup {
  playerName: string;
  spans: PlayerSpan[];
}

/** Maps a tier to its CSS modifier class. Kept as an explicit record rather than deriving a
 * class from the label so a renamed tier fails at the type level instead of silently losing
 * its colour. STILL USED by `DraftPoolBrowser.tsx` (not part of this redesign pass) — the new
 * `.at-shell` Draft tab below has its own, separate dot-based tier→colour maps
 * (`SPACING_DOT_CLASS` etc.), so don't merge these; they serve two different visual systems on
 * purpose while the rollout is partial. */
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
type DisplayOverallTier = OverallTier | 'Shots Glue';

const OVERALL_TIER_CLASS: Record<DisplayOverallTier, string> = {
  'Shots Glue': 'rating-glue',
  'Cigarette Butt': 'rating-cigarette',
  'Bench Warmer': 'rating-bench',
  'Role Player': 'rating-role',
  'Sixth Man': 'rating-sixthman',
  Starter: 'rating-starter',
  'All-star': 'rating-allstar',
  'All-NBA': 'rating-allnba',
  MVP: 'rating-mvp',
  'Greatest peak': 'rating-peak',
  GOAT: 'rating-goat',
};

/** Sub-2-shot players are cap-construction pieces, not ordinary replacement-level players. The
 * underlying tier stays unchanged for talent/minutes rules; this is the explicit roster-role
 * label the AI and UI can share without pretending cheapness is basketball quality. */
function displayedOverallTier(span: PlayerSpan): DisplayOverallTier {
  return span.fga < 2 ? 'Shots Glue' : overallTierForSpan(tierContextFor(span));
}

/** Shared by `OverallTierBadge` and every "TAL {number}" display site — building this once and
 * reusing it for both the badge and the number next to it is what guarantees they can never
 * disagree (see `displayTalentForSpan`'s own docstring for why they used to). `playerName` is
 * needed for the GOAT-tier check (grades.ts) — every other field already came from `span`. */
// Moved to grades.ts (2026-08-14) so aiDrafter.ts (pure engine) can build a real tier-capped
// context too, without an engine file importing a React component — re-exported here (imported
// above) so this file's own and DraftPoolBrowser.tsx's existing call sites are unaffected.
export { tierContextFor };

export function OverallTierBadge({ span }: { span: PlayerSpan }) {
  const tier = displayedOverallTier(span);
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

/** G_SMALL_SAMPLE — renders nothing for the ~99% of spans built on a normal real game count,
 * same "most spans carry no tag" pattern `PlayoffPerformanceBadge` already uses above. */
export function SmallSampleBadge({ span }: { span: PlayerSpan }) {
  if (!isSmallSampleSpan(span)) return null;
  const games = sampleSizeGames(span);
  return (
    <span className="tier-badge sample-limited" title={games !== null ? `${games} real games in this span` : undefined}>
      Limited sample
    </span>
  );
}

/** G_BLACK_BOX — real, deterministic "why this rating" breakdown (see `evidenceReport.ts`'s own
 * header for the full design rationale). A plain expandable panel, not a badge: the content is
 * full sentences, not a single tier word, so it doesn't fit the `.tier-badge` pill pattern the
 * rest of this file uses. */
export function EvidenceReportPanel({ span }: { span: PlayerSpan }) {
  const report = buildEvidenceReport(span);
  return (
    <div className="evidence-report">
      <div className="evidence-column">
        <h4>Evidence for this rating</h4>
        <ul>
          {report.evidence.map((item, i) => (
            <li key={i}>{item.text}</li>
          ))}
        </ul>
      </div>
      <div className="evidence-column">
        <h4>Counter-evidence</h4>
        <ul>
          {report.counterEvidence.map((item, i) => (
            <li key={i}>{item.text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
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

/* ======================================================================
   2026-08-13 redesign: new `.at-shell` tab shell (Overview/Draft/Team/
   Rotation), scoped under `at-*` classes — see App.css's own header
   comment and draft_game_ui_redesign_spec.md memory for the full design
   history. First rollout pass: shell + the Draft tab fully rebuilt;
   Overview/Team are lighter adaptations of existing data; Rotation is a
   placeholder (real rotation-building only happens after span selection,
   a later phase this pass doesn't touch — see RotationBuilder.tsx).

   Real, honest deviations from the original mockup, made explicit here
   rather than silently:
   - No "Impact" column: `computeImpact`/`impact.ts`, referenced in this
     project's own memory, doesn't exist anywhere in the current engine
     (verified by search, not assumed) — dropped rather than fabricated.
   - O-TAL and D-TAL, and separately O-POR and D-POR, stay as TWO columns
     each rather than the mockup's one combined "Offense/Defense"/
     "Portability" column — the split was itself a deliberate, later,
     explicit user decision this redesign shouldn't quietly undo.
   - The mockup's flat one-row-per-player Draft table (implicitly "your
     peak span") is replaced with the SAME grouped/expandable-per-span
     interaction the app already had: the real draft mechanic depends on
     being able to draft a player's cheaper, non-peak span for cap
     reasons, which a peak-only row can't express.
   - The old per-span "Data" provenance badge (MEASURED/MIXED/MANUAL) is
     dropped from this pass — a real data-QA detail, not a player-facing
     decision signal, and the mockup never had a column for it either.
     Not lost forever, just out of scope for this rollout; re-add if the
     user wants it back.
   ====================================================================== */

// 2026-08-13, user's own follow-up right after the first version shipped: collapse the 4 mockup
// tabs down to 2 — "overview + draft jako jedno z nazwą DRAFT, team + rotation jako jedno z nazwą
// TEAM." Both merged tabs just stack their two former sections vertically in one `.at-card` panel
// rather than getting a real combined layout — a bigger redesign of the merged content wasn't
// asked for, just fewer top-level tabs.
type AtTab = 'draft' | 'team';

/** Global 1-(TEAM_COUNT*ROSTER_SIZE) pick number for `state.teams[teamIdx]`'s round-`round` pick
 * (both 0-indexed) —
 * the inverse of `currentTeamIndex`/`snakeOrderIndex` in draft.ts, needed here because the
 * Overview grid is laid out team-row x round-column (so it can double as "your team's picks
 * across every round"), while the broadcast-board badge wants the true chronological pick
 * number, same as `makePick`'s own `state.round * TEAM_COUNT + state.pickInRound + 1` formula.
 * Snake order reverses direction every other round, so a team's `pickInRound` alternates between
 * its array index and its mirror from the far end. */
function overviewPickNumber(teamIdx: number, round: number): number {
  const pickInRound = round % 2 === 0 ? teamIdx : TEAM_COUNT - 1 - teamIdx;
  return round * TEAM_COUNT + pickInRound + 1;
}

/** "Michael Jordan" -> "M. Jordan" — same first-initial-plus-surname convention the real board
 * photo itself uses ("C. FLAGG", "D. HARPER"). Rendered alongside the full name (CSS picks one
 * per viewport width, see `.at-name-full`/`.at-name-short`) rather than swapped in via JS/resize
 * listener — a full name a real board would also show on a big-enough screen has no reason to be
 * throttled down on a wide viewport. Falls back to the given string as-is for the rare single-
 * token name (mononyms, or the odd malformed row) rather than mangling it. */
function shortPlayerName(name: string): string {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/** 2026-08-16, user's own ask: a hover tooltip on the Overview grid's own pick cells, once a
 * player is actually drafted — same `.at-name-tip`/`data-tip` popover mechanics as team names
 * above, just built from this specific drafted SPAN's own real box line (`pick.box`) rather than
 * a career average, since that's the exact season this roster spot actually rosters. */
export function pickStatTip(pick: PlayerSpan): string {
  const b = pick.box;
  return `${b.ppg.toFixed(1)} PPG · ${b.apg.toFixed(1)} APG · ${b.rpg.toFixed(1)} RPG · ${(b.fgPct * 100).toFixed(1)}% FG · ${(b.threePct * 100).toFixed(1)}% 3PT`;
}

const GRADE_TIER_CLASS: Record<Grade, string> = {
  S: 'at-t6', 'A+': 'at-t6', A: 'at-t5', 'A-': 'at-t5',
  'B+': 'at-t4', B: 'at-t4', 'B-': 'at-t3', 'C+': 'at-t3',
  C: 'at-t2', 'C-': 'at-t2', 'D+': 'at-t1', D: 'at-t1', 'D-': 'at-t1', F: 'at-t1',
};

// Exported (2026-08-19) for RotationBuilder's own reuse — see that file's own docstring on why
// the Team/Rotation screen now shows the same Offense/Defense letter grades this badge already
// renders on the Draft tab, instead of building a second, slightly-different badge from scratch.
export function AtGrade({ grade }: { grade: Grade }) {
  return <span className={`at-grade-badge ${GRADE_TIER_CLASS[grade]}`}>{grade}</span>;
}

/* 2026-08-19, user's explicit follow-up ask ("can we explain in glossary that is talent ETC"):
   these used to only describe the SCALE (which letter/tier means what) without ever saying what
   the underlying metric actually measures — accurate to how each one is really computed
   (talent.ts/portability.ts's own docstrings), not invented. Split Offense/Defense out from
   Portability into two entries: they're commonly confused but answer genuinely different
   questions (raw quality vs. how well that quality travels next to another star), not two
   readings of the same idea. */
const TAG_LEGEND: ReadonlyArray<{ name: string; tiers: string[]; text: string }> = [
  { name: 'Talent (TAL)', tiers: ['at-t1', 'at-t3', 'at-t6'], text: "This player's own overall value — scoring, efficiency, playmaking and defensive activity blended into one box-score-derived number (a transparent stand-in for models like Basketball-Index's O-LEBRON). Named tiers from Cigarette Butt to GOAT, off the player's single best-TAL span." },
  { name: 'Offense (OFF) / Defense (DEF)', tiers: ['at-t1', 'at-t3', 'at-t6'], text: 'The same idea as Talent, split into its offense-only and defense-only halves. Letter grade S–F — S is reserved for the 3 best in the current pool.' },
  { name: 'Portability (O-POR / D-POR)', tiers: ['at-t1', 'at-t3', 'at-t6'], text: "A different question from Talent/Offense/Defense: not how good this player is, but how well their game travels next to another ball-dominant star — an efficient off-ball scorer or a versatile defender ports well even at a modest overall Talent, and a ball-dominant star can port poorly despite elite Talent. Same S–F letter-grade scale." },
  { name: '3PT (SPC)', tiers: ['at-t1', 'at-t3', 'at-t6'], text: "How much this player's outside shooting forces a defense to respect the perimeter — real, era-scaled 3-point volume and accuracy. Non-shooter to Walking gravity." },
  { name: 'Durability (DUR)', tiers: ['at-t1', 'at-t3', 'at-t6'], text: 'DNP to Ironman — real share of possible team games actually played in this span.' },
  // 2026-08-19, user's explicit ask ("hide playoffs and make everything in one line"): the
  // Playoffs entry used to sit alone on its own short second row (5 cards fit one row, the 6th
  // wrapped) — dropped so the remaining 5 fit one line cleanly, per the same ask. The actual
  // Playoffs badge/column elsewhere in this file (the ▲/▼ riser/dropper tag) is untouched — this
  // only removes its glossary entry.
];

export default function DraftBoard({
  state,
  onPick,
  mode,
  pickReactions,
  onPickReactionChange,
  pickReasoning,
  onPickReasoningChange,
  onSubmitTeam,
}: Props) {
  const showJudgeMetrics = mode === 'developer';
  const [search, setSearch] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<Position | 'ALL'>('ALL');
  const [fgaMin, setFgaMin] = useState('0');
  const [fgaMax, setFgaMax] = useState('30');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [evidenceOpen, setEvidenceOpen] = useState<Set<string>>(new Set());
  // 2026-08-13 player-mode redesign: which expanded players have asked to see every season
  // instead of just the engine's top 3 — see the `!showJudgeMetrics` branch of the expanded
  // detail table below. Not used at all in developer mode, which always shows every span.
  const [showAllSpans, setShowAllSpans] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<AtTab>('draft');
  const [showLegend, setShowLegend] = useState(false);
  // Defaults open in Commissioner Mode: every pick needs its reasoning box reachable right after
  // it's made, across up to 144 picks — an extra click to reveal it every single time would be a
  // real friction cost at that volume.
  // No setter destructured: this pre-dates this session's own changes ("no visible toggle button
  // anymore" per the render comment below), but was still declared as if a setter existed
  // (`tsc`'s `noUnusedLocals` catches the drift) — fixed in passing while touching this file for
  // the unrelated Team-tab work above.
  const [showHistory] = useState(state.commissionerMode);
  // Collision-safe team codes for the Overview grid's broadcast-style chips — must be computed
  // across the whole `state.teams` list at once, not per-team, since `teamCodes` resolves
  // collisions (e.g. Charleston vs Charlotte both wanting "CHA") relative to every other team's
  // code. Team names/order never change mid-draft (only each team's own `roster` grows), so the
  // actual code assignments are stable for the whole draft even though `state.teams` gets a new
  // array reference on every pick — memoised mainly so the many renders that touch neither (tab
  // switches, search typing, legend toggles) skip redoing the collision pass for nothing.
  const teamCodeByTeamId = useMemo(() => teamCodes(state.teams), [state.teams]);

  const teamIdx = currentTeamIndex(state);
  const currentTeam = state.teams[teamIdx];
  // 2026-08-16, user's own ask: the player list stays browsable during a CPU turn now (it used to
  // disappear behind a full "X is thinking…" placeholder) — this just gates the actual DRAFT
  // action, reused at both `at-draft-btn` call sites below instead of repeating the same
  // condition inline everywhere.
  const canPick = currentTeam.isHuman || state.commissionerMode;
  // Real bug caught while making the change above: the Team tab (cap meter/roster-so-far) and
  // the Draft tab's "Cap remaining" label both read straight off `currentTeam` — fine on your own
  // turn (currentTeam IS the human then), silently wrong on a CPU turn (shows the CPU's cap/
  // roster instead of yours). Invisible before now because a CPU turn used to hide the whole
  // Draft tab behind the placeholder this same pass removed, and apparently nobody opened the
  // Team tab specifically during a CPU turn to notice it there. `humanTeam` is the fix outside
  // Commissioner Mode, where exactly one team is ever really "yours"; INSIDE Commissioner Mode,
  // `currentTeam` stays correct as-is — you're deliberately building whichever team is currently
  // on the clock, not one fixed team, so `teamForPanels` only swaps behavior in normal play.
  const humanTeam = state.teams.find((t) => t.isHuman)!;
  const teamForPanels = state.commissionerMode ? currentTeam : humanTeam;

  // 2026-08-16, user's own ask: span selection + rotation-building moved off their own dedicated
  // post-draft screens and into the Team tab below, reachable from the human's very first pick —
  // always against `humanTeam` specifically (never `teamForPanels`), same "Commissioner Mode
  // still only ever builds the ONE isHuman team's span/rotation" scoping this file's own
  // `teamForPanels` comment above already documents for the roster table.
  // Keyed by normalized player name (one entry per drafted PICK, not per real-world player who
  // could have several spans in the pool) — same shape the old SpanSelectionScreen used.
  const [humanSpanSelection, setHumanSpanSelection] = useState<Record<string, string>>({});
  // Bumped on every span change and used as `RotationBuilder`'s `key` below — forces a clean
  // remount (fresh `autoAssignRotation` seed) instead of trying to reconcile old minutes
  // assignments against a roster whose player IDENTITY just changed (each span is its own
  // `PlayerSpan.id`; swapping a player's span is not the same player anymore as far as the
  // rotation editor's row state is concerned). Span edits are expected to happen before
  // fine-tuning minutes, not interleaved with it, so losing in-progress rotation edits on a span
  // change is an acceptable, rare trade-off, not a routine one.
  const [spanVersion, setSpanVersion] = useState(0);

  function setHumanSpan(key: string, spanId: string) {
    setHumanSpanSelection((prev) => ({ ...prev, [key]: spanId }));
    setSpanVersion((v) => v + 1);
  }

  // One entry per drafted pick, options sorted best-TAL-first (same convention the old
  // SpanSelectionScreen used) — recomputed only when the human's own roster actually changes
  // (grows by a pick), not on every render.
  const humanSpanOptions = useMemo(
    () =>
      humanTeam.roster.map((p) => ({
        key: normalizePlayerName(p.playerName),
        playerName: p.playerName,
        draftedSpan: p,
        options: [...spanOptionsFor(p.playerName)].sort((a, b) => effectiveTalent(b) - effectiveTalent(a)),
      })),
    [humanTeam.roster],
  );
  // The human's roster as it should actually be scored: each drafted pick resolved to whichever
  // span the player chose in the dropdown below, falling back to the drafted (peak) span until
  // they pick something else — same fallback `SpanSelectionScreen` used to seed from.
  const chosenHumanRoster: PlayerSpan[] = humanSpanOptions.map(({ key, draftedSpan, options }) => {
    const chosenId = humanSpanSelection[key];
    return options.find((o) => o.id === chosenId) ?? draftedSpan;
  });
  // True whenever the Team tab's roster table is actually showing the human's own roster — always
  // true outside Commissioner Mode (`teamForPanels` IS `humanTeam` then), only sometimes true
  // inside it (only when the human's own team happens to be the one currently on the clock).
  // Gates both the inline span dropdown below and which FGA numbers the cap meter reads.
  const isViewingHumanRoster = teamForPanels.id === humanTeam.id;
  const humanSpanOptionsByKey = new Map(humanSpanOptions.map((o) => [o.key, o]));

  const currentFgas = teamForPanels.roster.map((p) => p.fga);
  // Cap meter + per-row FGA read the human's actually-CHOSEN spans (not the drafted/peak ones)
  // once a span dropdown exists to disagree with them — otherwise the meter would silently lie
  // about how much cap a cheaper chosen span actually freed up. Falls back to the plain
  // `currentFgas` (drafted/peak spans) when this table isn't showing the human's own roster.
  const displayFgas = isViewingHumanRoster ? chosenHumanRoster.map((p) => p.fga) : currentFgas;
  // The human's chosen-span roster measured against the cap — the span dropdown can pick a
  // pricier span than was drafted, and nothing downstream clamps it (see the Submit button).
  const chosenRosterFga = totalFga(chosenHumanRoster.map((p) => p.fga));
  const chosenRosterOverCap = chosenRosterFga > CAP_LIMIT;

  // 2026-09-02: group the FULL, immutable pool once — not `availablePlayers(state)`, which
  // returns a new array every pick, forcing the expensive per-player enrichment below to re-run
  // on every single CPU pick during an auto-draft (~325 players × 5+ `computeX`, several times a
  // second — the real "bardzo wolno"). Drafted players are filtered out cheaply in `groups`.
  const allGroups = useMemo(() => groupByPlayer(state.pool), [state.pool]);

  // The position he played the most seasons at, so a player appears under exactly one
  // position column instead of every position any single span's primary/secondary touched.
  function careerPosition(g: PlayerGroup): Position {
    const counts = new Map<Position, number>();
    for (const span of g.spans) counts.set(span.primaryPosition, (counts.get(span.primaryPosition) ?? 0) + 1);
    return ALL_POSITIONS.reduce((best, pos) => ((counts.get(pos) ?? 0) > (counts.get(best) ?? 0) ? pos : best), ALL_POSITIONS[0]);
  }

  // 2026-08-19, user's explicit ask ("FULL BOARD FOR HUMAN" / "show everyone" — confirmed via
  // AskUserQuestion, scoped to visibility only): this used to filter down to only cap-legal
  // spans, so a genuinely affordable player could vanish from the list entirely if some OTHER
  // span of theirs happened to fail the (now also-removed, see draft.ts's own docstring on
  // `strictPickLegal`) lookahead check. Every undrafted span now stays visible regardless of
  // legality — the actual 100.9 FGA cap itself is untouched and still real; a span that would
  // bust it outright still can't actually be drafted (`isPickLegal` still gates the Draft button
  // itself, at both the collapsed and expanded row below), it just isn't hidden from view first.
  const legalGroups = allGroups;

  const fgaMinNum = Number(fgaMin);
  const fgaMaxNum = Number(fgaMax);
  const fgaFilterActive = Number.isFinite(fgaMinNum) && Number.isFinite(fgaMaxNum);

  // Every judge metric computed exactly once per visible player here, not once per sort
  // comparison and again for display. `Array.sort` on ~325 players calls its comparator
  // roughly n*log2(n) ≈ 2,700 times — the previous version called `computeTalent` fresh
  // inside the comparator every single time (measured: ~2s of a ~2.6s render, purely from
  // that redundancy), then the render below recomputed the same values a second time for
  // display. `showJudgeMetrics` gates the other five so player mode — which never displays
  // or sorts by them — doesn't pay for them at all.
  //
  // 2026-09-01: split into two memos. The expensive per-player enrichment (TAL/tier/O/D/POR/
  // spacing/durability over every span) now runs only when the pool, the FGA range or the mode
  // changes — NOT on every search keystroke or position-pill click, which previously re-ran the
  // whole thing (~325 players × 5+ `computeX` calls) and was the "bardzo wolno" the user hit
  // scrolling the dev list while typing. The cheap filter/sort pass is its own memo.
  const enrichedGroups = useMemo(() => {
    return legalGroups
      .map((g) => ({
        ...g,
        spans: fgaFilterActive ? g.spans.filter((s) => s.fga >= fgaMinNum && s.fga <= fgaMaxNum) : g.spans,
      }))
      .filter((g) => g.spans.length > 0)
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
      //
      // 2026-08-13: now computed unconditionally, not just in developer mode. Player mode never
      // *displays* the TAL number behind this pick, but it still needs to know which span the
      // engine rates highest — that's the span whose box-score line appears on the collapsed row,
      // and it anchors `spansByAiValue` below. The engine keeps doing the judging; the player just
      // never sees the number, per the 2026-08-13 "don't show any of what we did" redesign.
      const bestTalentSpan = g.spans.reduce(
        (best, s) => (displayTalentForSpan(tierContextFor(s)) > displayTalentForSpan(tierContextFor(best)) ? s : best),
        g.spans[0],
      );
      // Player-mode only: every one of this player's spans, ranked by the same hidden AI
      // valuation used for `bestTalentSpan` above — lets the expanded row show "the 3 the engine
      // likes best" first (+ a Show more for the rest) without ever surfacing the score or tier
      // that produced the ordering. Skipped in developer mode, which shows spans chronologically
      // instead (`group.spans`, already sorted by `byChronology`).
      const spansByAiValue = showJudgeMetrics
        ? g.spans
        : [...g.spans].sort(
            (a, b) => displayTalentForSpan(tierContextFor(b)) - displayTalentForSpan(tierContextFor(a)),
          );
      return {
        ...g,
        bestTalentSpan,
        spansByAiValue,
        // 2026-08-19, bug found while adding the player-mode tier badge below: the sort comparator's
        // own comment (a few lines down) already claimed this was "computed unconditionally... costs
        // nothing new" for the player-mode tiebreak, but the code here contradicted it — zeroing
        // `bestTalent` in player mode made that tiebreak compare 0-0 for the ~90% of the pool with
        // no real All-Star selections, silently reverting to incidental array order for almost the
        // whole list despite the comment's claim it was fixed. Made genuinely unconditional to match
        // what the comment already said was true; still never DISPLAYED as a raw number in player
        // mode (only the coarser tier badge is), so this doesn't reveal anything new on-screen.
        bestTalent: displayTalentForSpan(tierContextFor(bestTalentSpan)),
        // 2026-08-08, user's v0.2 rating batch: GOAT has no ceiling of its own
        // (`tierCeiling('GOAT')` is `Infinity`), so a GOAT-tier span's `bestTalent` number can
        // land on the exact same value as a merely-Greatest-Peak span (both 98, say) — found
        // via LeBron (GOAT) sorting BELOW Bird (Greatest peak) purely because the tied number
        // fell back to incidental array order. Stored alongside `bestTalent` so the sort below
        // can break that specific tie by tier rank instead.
        // 2026-09-02: `bestTier` is the one quality signal both modes now show in the header
        // (player mode as a bare pill, dev mode as pill + `bestTalent` number). The old
        // per-player `bestOffensiveTalent`/`bestDefensiveTalent`/`bestSpacing`/… aggregates and
        // the `careerAveragesFor` box line were dropped: the condensed header no longer shows
        // them, the expanded per-span table computes its own per-span values, and running six
        // `Math.max(...spans.map(computeX))` for all ~730 players in this memo was pure waste.
        bestTier: overallTierForSpan(tierContextFor(bestTalentSpan)),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legalGroups, fgaFilterActive, fgaMinNum, fgaMaxNum, showJudgeMetrics]);

  // Cheap pass: drop drafted players, then position pill, search box, tier sort. Re-runs on every
  // keystroke AND every pick, but only ever filters/sorts the already-enriched objects above —
  // no `computeX` here. `draftPickSpan` adds every sibling span of a picked player to
  // `state.draftedIds` at once, so a player is all-in or all-out: one `.has` check settles it.
  //
  // 2026-09-02: the result is capped at DRAFT_LIST_LIMIT. Rendering all ~720 players as
  // expandable accordion rows took ~11s per keystroke (measured) — the "bardzo wolno". The list
  // is tier-sorted, so an uncapped "ALL + empty search" view was showing the 400th-best player
  // anyway; capping to the top ~140 and telling the user to search / pick a position for the
  // rest matches the Cap Sheet (which slices at 120) and is instant. Any real search or position
  // filter lands well under the cap.
  const { groups, totalMatched } = useMemo(() => {
    const q = search.toLowerCase();
    const matched = enrichedGroups
      .filter((g) => !state.draftedIds.has(g.spans[0].id))
      .filter((g) => (selectedPosition !== 'ALL' ? careerPosition(g) === selectedPosition : true))
      .filter((g) => g.playerName.toLowerCase().includes(q))
      .sort((a, b) => {
        if (mode === 'player') {
          // 2026-08-19, user's explicit ask ("sort players by their tier"): the Tier badge (not a
          // raw number) is the one quality signal Player Mode actually shows on this row — sorting
          // by anything else first meant the visible list order could contradict the visible
          // badges (a "Starter"-tier row appearing above an "All-star"-tier row, say), whenever
          // All-Star count or the hidden raw number disagreed with the tier a span actually landed
          // on (real, not hypothetical — `grades.ts`'s own position-specific tier caps routinely
          // knock a high-raw-TAL span down a tier or more). Tier rank is now the primary key; the
          // previous All-Star-count/raw-`bestTalent` order survives as the tiebreak WITHIN a tier,
          // same "fully deterministic and quality-ordered, never shown to the player" reasoning the
          // 2026-08-16 fix below already established for those two.
          const tierDiff = tierRank(b.bestTier) - tierRank(a.bestTier);
          if (tierDiff !== 0) return tierDiff;
          const starDiff = allStarCount(b.playerName) - allStarCount(a.playerName);
          if (starDiff !== 0) return starDiff;
          return b.bestTalent - a.bestTalent;
        }
        return b.bestTalent - a.bestTalent || tierRank(b.bestTier) - tierRank(a.bestTier);
      });
    return { groups: matched.slice(0, DRAFT_LIST_LIMIT), totalMatched: matched.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichedGroups, state.draftedIds, selectedPosition, search, mode]);

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleEvidence(spanId: string) {
    setEvidenceOpen((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }

  function toggleShowAllSpans(playerName: string) {
    setShowAllSpans((prev) => {
      const next = new Set(prev);
      if (next.has(playerName)) next.delete(playerName);
      else next.add(playerName);
      return next;
    });
  }

  const TABS: ReadonlyArray<{ id: AtTab; label: string }> = [
    { id: 'draft', label: 'Draft' },
    { id: 'team', label: 'Team' },
  ];

  return (
    <div className="at-shell">
      {/* 2026-08-16, user's own ask: sits above the whole board on its own row, not squeezed into
          the topbar next to the tabs/status chip. */}
      <div className="at-board-brand at-cond">All-Time NBA Draft</div>
      <div className="at-topbar">
        <div className="at-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`at-tab-btn at-cond ${activeTab === tab.id ? 'at-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2026-08-16, user's own ask: no visible toggle button anymore (first moved out of the
          deleted status chip, then asked to drop entirely) — `showHistory` just keeps its
          existing default (on for Commissioner Mode, since that's DraftHistory's only reachable
          surface for its per-pick reasoning notes/FeedbackToggle; off otherwise) with no UI control
          left to flip it. Same `showJudgeMetrics`-only scoping as before. */}
      {showJudgeMetrics && showHistory && (
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

      {activeTab === 'draft' && (
        <div className="at-card" style={{ marginBottom: 16 }}>
          {/* 2026-08-16, user's own ask: the "Overview" title + explainer caption are gone in
              developer mode too now — previously kept there (player mode dropped them first,
              2026-08-13) but the grid itself (all 16 teams × round) still says everything it
              needs to without the label. */}
          <div className="at-grid-scroll">
            <table className="at-ov-grid">
              <thead>
                <tr>
                  <th className="at-teamcol">Team</th>
                  {Array.from({ length: ROUNDS }, (_, r) => (
                    <th key={r} className="at-rnd">
                      {r + 1}
                      {r === 0 ? 'st' : r === 1 ? 'nd' : r === 2 ? 'rd' : 'th'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.teams.map((team, i) => (
                  <tr key={team.id} className={`${team.isHuman ? 'at-you' : ''} ${i === teamIdx ? 'at-clock' : ''}`}>
                    <td className="at-teamcol">
                      {/* 2026-08-16, user's own ask: full team names used to sit in this cell
                          unconditionally, eating real width in an already-cramped 16-team x
                          8-round grid — the chip alone already IDs the team uniquely (`teamCodes`
                          resolves collisions across the whole roster), so the full name only
                          shows now as an on-hover/focus tooltip (`.at-name-tip`, same mechanics
                          as the tier dots' own `data-tip` popover above). "(You)" is folded into
                          that same tooltip text rather than sitting beside it — the row's own
                          `.at-you` highlight already marks it visually either way. */}
                      {/* 2026-08-19, user's explicit ask ("with this much space we can just put
                          names in for web") — the code-chip-plus-hover-tooltip design above was
                          built for a cramped desktop layout; on a wider view this column has real
                          room to spare, so the full name is shown directly again, chip retained
                          for quick color-coded scanning. */}
                      <span className="at-team-chip" tabIndex={0}>
                        {teamCodeByTeamId.get(team.id)}
                      </span>
                      <span className="at-team-name-full">
                        {teamLabel(team)}
                        {team.isHuman && <span className="at-lottery-you-tag">YOU</span>}
                      </span>
                    </td>
                    {Array.from({ length: ROUNDS }, (_, r) => {
                      const pick = team.roster[r];
                      if (pick) {
                        return (
                          <td key={r} className="at-pickcell">
                            {/* 2026-08-16, user's own ask: the drafted span's year range dropped from this
                                cell entirely — not needed on the board itself (it's still visible in the
                                Draft/Team tabs' own tables), and cutting it is part of fitting all 8 round
                                columns on a narrow screen without horizontal scrolling. Below 640px the full
                                name is swapped for "F. Last" (`.at-name-full`/`.at-name-short`, picked by
                                CSS media query) — a real column is only ~35px wide there, too narrow for
                                most full names not to fragment mid-word even wrapped. */}
                            <span className="at-pick-badge">{overviewPickNumber(i, r)}</span>
                            <span className="at-name-tip" tabIndex={0} data-tip={pickStatTip(pick)}>
                              <span className="at-name-full">{pick.playerName}</span>
                              <span className="at-name-short">{shortPlayerName(pick.playerName)}</span>
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
        </div>
      )}

      {activeTab === 'draft' && (
        <div className="at-card">
          <h1 className="at-panel-title at-cond">Draft</h1>
          {/* 2026-08-16, user's own ask: a CPU turn used to hide this whole panel behind a full
              "X is thinking…" placeholder — the player list is browsable at all times now
              instead, with just this small notice (not a block) while it's not your turn. The
              actual Draft buttons below are `disabled` via `canPick`, not hidden, so browsing/
              searching/expanding a row to look at a player works identically either way. */}
          {!canPick && (
            <div className="at-cpu-turn-banner">{teamLabel(currentTeam)} is picking…</div>
          )}
          <>
              <div className="at-controls-row">
                <input
                  className="at-search-input"
                  placeholder="Search players…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="at-fga-filter">
                  <label>Filter shots</label>
                  <input className="at-fga-input" value={fgaMin} onChange={(e) => setFgaMin(e.target.value)} />
                  <input className="at-fga-input" value={fgaMax} onChange={(e) => setFgaMax(e.target.value)} />
                </div>
                <div className="at-cap-label" style={{ marginLeft: 'auto' }}>
                  {/* 2026-08-19: this briefly read `displayFgas` (the Team tab's chosen/swapped
                      spans) instead of `currentFgas` (the real, locked-in drafted spans) — fixed
                      one real mismatch (a stale label after a Team-tab swap could read as a false
                      "you're locked out") but created the opposite one: `isPickLegal`, which
                      actually gates every Draft button, has never read anything but the real
                      `state.teams` roster — a span swap in the Team tab is a scoring PREVIEW, it
                      was never able to change what's really pickable. So a swap to a cheaper span
                      made this label promise more room than the game would actually let you
                      spend, reading as every listed player being disabled for no visible reason
                      (user-reported, with a screenshot: "Cap remaining: 6.7" while every ~5-6 FGA
                      player nearby stayed greyed out — the REAL remaining cap, tied to the
                      unswapped roster, was smaller than the label said). This label's one job is
                      "how much room do I actually have to draft with right now" — that can only
                      ever be the real, enforced number, so back to `currentFgas`. `displayFgas`
                      stays exactly where it already correctly belongs: the Team tab's own cap
                      meter, which is reviewing an already-locked-in pick, not gating a new one. */}
                  Cap remaining: <b>{capRemaining(currentFgas)}</b> shots
                </div>
              </div>
              <div className="at-controls-row" style={{ marginTop: -4 }}>
                <button
                  className={`at-filter-pill at-cond ${selectedPosition === 'ALL' ? 'at-active' : ''}`}
                  onClick={() => setSelectedPosition('ALL')}
                >
                  All
                </button>
                {ALL_POSITIONS.map((pos) => (
                  <button
                    key={pos}
                    className={`at-filter-pill at-cond ${selectedPosition === pos ? 'at-active' : ''}`}
                    onClick={() => setSelectedPosition(pos)}
                  >
                    {pos}
                  </button>
                ))}
              </div>

              {/* 2026-09-01: the Draft-tab player list is the same expandable-list shape as the
                  Cap Sheet (`.player-group` accordion + `.span-table`), condensed to match it —
                  minimal header (name · position · seasons · best tier · FGA/TAL on the right),
                  plain-text stat cells, only the tier is a pill. FGA columns and the draft
                  mechanic (`onPick`/`isPickLegal`/`canPick`, best-span pick in player mode,
                  per-span pick + Why? in developer mode) are unchanged. `.player-group*` /
                  `.span-table` read the plain `--bg`/`--border`/`--accent` names, which `.at-shell`
                  aliases to its dark board values, so it renders on the board palette; the
                  `.at-draft-groups` block in App.css only tightens spacing/typography. */}
              <div className="player-groups at-draft-groups">
                {groups.map((group) => {
                  const isOpen = expanded.has(group.playerName);
                  const groupFgas = group.spans.map((s) => s.fga);
                  const minFga = Math.min(...groupFgas);
                  const maxFga = Math.max(...groupFgas);
                  const fgaRange =
                    minFga === maxFga ? minFga.toFixed(1) : `${minFga.toFixed(1)}–${maxFga.toFixed(1)}`;
                  return (
                    <div key={group.playerName} className="player-group">
                      <div
                        className="player-group-header"
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleExpand(group.playerName)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleExpand(group.playerName);
                          }
                        }}
                      >
                        <span className="pg-caret">{isOpen ? '▾' : '▸'}</span>
                        <span className="pg-name">{group.playerName}</span>
                        <span className="pg-natural-position">{naturalPosition(group.playerName)}</span>
                        <span className="pg-meta">
                          {group.spans.length} season{group.spans.length > 1 ? 's' : ''}
                        </span>

                        {/* Right side, Cap-Sheet style: one calm monospace string, no pill.
                            "best <tier> · TAL <n>" (dev) / "best <tier> · <fga> FGA" (player). */}
                        <span className="pg-summary">
                          <span className="lbl">best</span> {group.bestTier}
                          {' · '}
                          {showJudgeMetrics ? (
                            <>
                              <span className="lbl">TAL</span> {group.bestTalent}
                            </>
                          ) : (
                            <>
                              {fgaRange} <span className="lbl">shots</span>
                            </>
                          )}
                        </span>

                        {!showJudgeMetrics && (
                          <button
                            className="at-draft-btn pg-draft"
                            disabled={!canPick || !isPickLegal(state, group.bestTalentSpan.id)}
                            title={
                              !canPick
                                ? `${teamLabel(currentTeam)} is picking…`
                                : !isPickLegal(state, group.bestTalentSpan.id)
                                  ? 'Over the shots cap — pick something else first, or a cheaper season for this player.'
                                  : undefined
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              onPick(group.bestTalentSpan.id);
                            }}
                          >
                            Draft
                          </button>
                        )}
                      </div>

                      {isOpen && showJudgeMetrics && (
                        <div className="table-scroll">
                          <table className="span-table at-draft-span-table">
                            <thead>
                              <tr>
                                <th>Span</th>
                                <th>Pos</th>
                                <th className="num">Shots</th>
                                <th className="num">TAL</th>
                                <th>O</th>
                                <th>D</th>
                                <th>O-POR</th>
                                <th>D-POR</th>
                                <th className="num">SPC</th>
                                <th className="num">DUR</th>
                                <th>Tier</th>
                                <th />
                                <th />
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {group.spans.map((span) => {
                                const ctx = tierContextFor(span);
                                return (
                                  <tr key={span.id}>
                                    <td>{span.spanLabel}</td>
                                    <td>{span.primaryPosition}</td>
                                    <td className="num">{span.fga.toFixed(1)}</td>
                                    <td className="num">{displayNumberForSpan(span, ctx)}</td>
                                    <td>{offensiveGrade(computeOffensiveTalent(span), computeUncappedOffensiveTalent(span))}</td>
                                    <td>{defensiveGrade(computeDefensiveTalent(span))}</td>
                                    <td>{offensivePortabilityGrade(computeOffensivePortability(span))}</td>
                                    <td>{defensivePortabilityGrade(computeDefensivePortability(span))}</td>
                                    <td className="num">{computeSpacing(span)}</td>
                                    <td className="num">{computeDurability(span)}</td>
                                    <td className="tier-cell">{overallTierForSpan(ctx)}</td>
                                    <td><SmallSampleBadge span={span} /></td>
                                    <td>
                                      <button
                                        className="at-draft-btn"
                                        disabled={!canPick || !isPickLegal(state, span.id)}
                                        title={
                                          !canPick
                                            ? `${teamLabel(currentTeam)} is picking…`
                                            : !isPickLegal(state, span.id)
                                              ? 'Over the shots cap — pick something else first, or a cheaper season for this player.'
                                              : undefined
                                        }
                                        onClick={() => onPick(span.id)}
                                      >
                                        Draft
                                      </button>
                                    </td>
                                    <td>
                                      <button className="at-why-btn" onClick={() => toggleEvidence(span.id)}>
                                        {evidenceOpen.has(span.id) ? 'Hide' : 'Why?'}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {group.spans
                            .filter((span) => evidenceOpen.has(span.id))
                            .map((span) => (
                              <div key={span.id} className="evidence-panel-wrap">
                                <div className="evidence-panel-label">{span.spanLabel} — why this rating</div>
                                <EvidenceReportPanel span={span} />
                              </div>
                            ))}
                        </div>
                      )}

                      {isOpen && !showJudgeMetrics && (() => {
                        // Player mode: box-score detail only, ranked by the engine's hidden
                        // valuation (`spansByAiValue`), top 3 with a Show more for the rest. No
                        // Draft-reasoning panel and no per-span Draft button — player mode drafts
                        // the best span from the header; span swapping happens in the Team tab.
                        const orderedSpans = group.spansByAiValue;
                        const showingAll = showAllSpans.has(group.playerName);
                        const visibleSpans = showingAll ? orderedSpans : orderedSpans.slice(0, 3);
                        return (
                          <div className="table-scroll">
                            <table className="span-table at-draft-span-table">
                              <thead>
                                <tr>
                                  <th>Span</th>
                                  <th>Pos</th>
                                  <th>Tier</th>
                                  <th className="num">PTS</th>
                                  <th className="num">AST</th>
                                  <th className="num">REB</th>
                                  <th className="num">STL</th>
                                  <th className="num">BLK</th>
                                  <th className="num">FG%</th>
                                  <th className="num">3PT%</th>
                                  <th className="num">Shots</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleSpans.map((span) => {
                                  const ctx = tierContextFor(span);
                                  return (
                                    <tr key={span.id}>
                                      <td>{span.spanLabel}</td>
                                      <td>{span.primaryPosition}</td>
                                      <td className="tier-cell">{overallTierForSpan(ctx)}</td>
                                      <td className="num">{span.box.ppg.toFixed(1)}</td>
                                      <td className="num">{span.box.apg.toFixed(1)}</td>
                                      <td className="num">{span.box.rpg.toFixed(1)}</td>
                                      <td className="num">{span.box.spg.toFixed(1)}</td>
                                      <td className="num">{span.box.bpg.toFixed(1)}</td>
                                      <td className="num">{(span.box.fgPct * 100).toFixed(1)}%</td>
                                      <td className="num">{(span.box.threePct * 100).toFixed(1)}%</td>
                                      <td className="num">{span.fga.toFixed(1)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            {orderedSpans.length > 3 && (
                              <button
                                className="at-legend-toggle at-cond"
                                style={{ marginTop: 6 }}
                                onClick={() => toggleShowAllSpans(group.playerName)}
                              >
                                {showingAll ? 'Show less' : `Show more (${orderedSpans.length - 3} more)`}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
              {totalMatched > groups.length && (
                <p className="at-caption at-draft-more-note">
                  Showing the top {groups.length} of {totalMatched} — search a name or pick a
                  position to see the rest.
                </p>
              )}
              <div className="at-legend-row">
                <p className="at-caption" style={{ marginTop: 0 }}>
                  {showJudgeMetrics
                    ? "Peak shots = cost of this player's highest-Talent season. Lowest shots = his cheapest available season in the pool right now, independent of talent. Click a row to see every available season and draft one."
                    : 'Draft picks his best season. Click a row to compare his other seasons — you can still switch to a different one afterward, in the Team tab.'}
                </p>
                {showJudgeMetrics && (
                  <button className="at-legend-toggle at-cond" onClick={() => setShowLegend((s) => !s)}>
                    {showLegend ? 'Hide' : 'Show'} tag legend
                  </button>
                )}
              </div>
              {showJudgeMetrics && showLegend && (
                <div className="at-tag-legend">
                  {TAG_LEGEND.map((l) => (
                    <div className="at-tag-legend-item" key={l.name}>
                      <span className="at-swatches">
                        {l.tiers.map((t, i) => (
                          <span key={i} className={`at-dot ${t}`} />
                        ))}
                      </span>
                      <div>
                        <h5>{l.name}</h5>
                        <p>{l.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
        </div>
      )}

      {activeTab === 'team' && (
        <div className="at-card" style={{ marginBottom: 16 }}>
          <h1 className="at-panel-title at-cond">Team</h1>
          <div className={`at-cap-meter${isViewingHumanRoster && chosenRosterOverCap ? ' at-cap-meter--over' : ''}`}>
            <span className="at-cap-label">
              <b>{totalFga(displayFgas).toFixed(1)}</b> / {CAP_LIMIT} shots
              {isViewingHumanRoster && chosenRosterOverCap && ' — over cap'}
            </span>
            <div className="at-cap-track">
              <div className="at-cap-fill" style={{ width: `${Math.min(100, (totalFga(displayFgas) / CAP_LIMIT) * 100)}%` }} />
            </div>
            <span className="at-cap-label">
              {teamForPanels.roster.length} / {ROSTER_SIZE} picked
            </span>
          </div>
          {teamForPanels.roster.length === 0 ? (
            <div className="at-placeholder">No picks yet — head to the Draft tab.</div>
          ) : (
            <table className="at-roster-table">
              <thead>
                <tr>
                  {/* 2026-08-19, user's explicit ask: "Round" used to pack position + round into
                      one cell ("SG R1") as a single string — split into two real columns so each
                      is independently scannable/sortable-by-eye instead of a merged label. Round
                      before Position (follow-up ask) — draft order is the more natural first read
                      of this table (it's a Round-by-round pick list), position is secondary. */}
                  <th>Rnd</th>
                  <th>Pos</th>
                  <th>Player</th>
                  <th>Span</th>
                  {/* 2026-08-19, user's explicit ask ("show offense, defense, portability etc
                      with S-F value"): the same judge letter-grades the Draft tab already shows
                      per candidate, now visible for your own already-locked-in roster too.
                      Deliberately NOT gated to Tester Mode, unlike the Draft tab's own equivalent
                      columns — user's own direct follow-up clarification: player mode's "blind
                      scouting" is specifically about the DRAFT decision, not about hiding what
                      you already own ("you kind of drafting blindly but you can see what did you
                      draft"). Once a player is actually on the roster, this is the whole point of
                      the Team tab, not a spoiler.
                      2026-08-19 follow-up, same ask extended to Spacing/Durability — the same two
                      tier badges (`SpacingTierBadge`/`DurabilityTierBadge`) already used on the
                      Draft tab, not new mechanics. */}
                  <th style={{ textAlign: 'center' }}>Off</th>
                  <th style={{ textAlign: 'center' }}>Def</th>
                  <th style={{ textAlign: 'center' }}>O-POR</th>
                  <th style={{ textAlign: 'center' }}>D-POR</th>
                  <th style={{ textAlign: 'center' }}>SPC</th>
                  <th style={{ textAlign: 'center' }}>DUR</th>
                  <th>Shots</th>
                </tr>
              </thead>
              <tbody>
                {teamForPanels.roster.map((p, i) => {
                  // 2026-08-16, user's own follow-up ask ("span na spokojnie można zmieścić w
                  // zakładce Team"): the span dropdown used to live in its own separate list
                  // further down this same tab, right next to (and repeating) this exact table —
                  // there's real horizontal room in this row for the dropdown itself, so it's
                  // folded directly into the Span cell instead of existing twice. Only swapped in
                  // when this table is actually showing the human's OWN roster (`isViewingHumanRoster`)
                  // — during Commissioner Mode looking at a different team's turn, this stays
                  // plain text, same "span editing only ever touches the one isHuman team" scoping
                  // as everywhere else in this file.
                  const spanOpt = isViewingHumanRoster ? humanSpanOptionsByKey.get(normalizePlayerName(p.playerName)) : undefined;
                  const effective = spanOpt
                    ? (spanOpt.options.find((o) => o.id === (humanSpanSelection[spanOpt.key] ?? spanOpt.draftedSpan.id)) ?? p)
                    : p;
                  return (
                    <tr key={p.id}>
                      <td>R{i + 1}</td>
                      <td>
                        <span className="pos-pill">{p.primaryPosition}</span>
                      </td>
                      <td>{p.playerName}</td>
                      <td>
                        {spanOpt ? (
                          <select
                            className="at-span-picker-select"
                            value={effective.id}
                            onChange={(e) => setHumanSpan(spanOpt.key, e.target.value)}
                          >
                            {spanOpt.options.map((o) => (
                              <option key={o.id} value={o.id}>
                                {/* 2026-08-19, user-reported real gap: this dropdown isn't scoped
                                    to Tester Mode at all — it's shared with player mode, which
                                    means the raw exact TAL number leaked here regardless of the
                                    "blind scouting" design everywhere else on this screen.
                                    `<option>` text can't hold a styled badge, so the tier NAME
                                    stands in for the number in player mode — same coarse,
                                    non-precise signal as the Draft tab's own Tier badge, no
                                    exact figure a beginner could just sort by.
                                    2026-08-19 follow-up: dropped the trailing "— FGA {n}" here,
                                    reasoning the table's own FGA column already showed it — true
                                    only for whichever ONE option is currently selected, not the
                                    other options sitting in this same dropdown. Same-day, second
                                    follow-up ("span list can show FGA becasue we need to click for
                                    every one to look how much it costs"): put back, since
                                    comparing spans by cost is the actual reason to open this
                                    dropdown in the first place — the table's column duplicates the
                                    SELECTED option only, never every option being compared. */}
                                {o.spanLabel} — {o.fga.toFixed(1)} shots —{' '}
                                {showJudgeMetrics
                                  ? `TAL ${effectiveTalent(o)} — ${overallTierForSpan(tierContextFor(o))}`
                                  : overallTierForSpan(tierContextFor(o))}
                              </option>
                            ))}
                          </select>
                        ) : (
                          p.spanLabel
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <AtGrade grade={offensiveGrade(computeOffensiveTalent(effective), computeUncappedOffensiveTalent(effective))} />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <AtGrade grade={defensiveGrade(computeDefensiveTalent(effective))} />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <AtGrade grade={offensivePortabilityGrade(computeOffensivePortability(effective))} />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <AtGrade grade={defensivePortabilityGrade(computeDefensivePortability(effective))} />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <SpacingTierBadge span={effective} />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <DurabilityTierBadge span={effective} />
                      </td>
                      <td className="at-fga-num">{effective.fga.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="at-caption">
            {isViewingHumanRoster
              ? "You drafted the player, not a specific era — the Span dropdown above picks which career window to actually roster. No shots cap here, same as the draft itself. Rotation minutes are set below."
              : 'Rotation minutes are set below, in this same tab.'}
          </p>
          {/* 2026-08-19, user's explicit ask ("you can add glossary under TEAM"): the roster table
              above packs in six grade/tier columns (Off/Def/O-POR/D-POR/SPC/DUR) plus the Span
              dropdown's own Tier name — same `TAG_LEGEND` glossary the Draft tab already offers,
              reused rather than duplicated, but NOT gated to Tester Mode here (unlike the Draft
              tab's copy): this table shows the same badges to both modes now (see the Off/Def/
              O-POR/D-POR columns' own comment above), so Player Mode needs the explanation just
              as much, arguably more. */}
          {teamForPanels.roster.length > 0 && (
            <>
              <button className="at-legend-toggle at-cond" onClick={() => setShowLegend((s) => !s)}>
                {showLegend ? 'Hide' : 'Show'} tag legend
              </button>
              {showLegend && (
                <div className="at-tag-legend">
                  {TAG_LEGEND.map((l) => (
                    <div className="at-tag-legend-item" key={l.name}>
                      <span className="at-swatches">
                        {l.tiers.map((t, i) => (
                          <span key={i} className={`at-dot ${t}`} />
                        ))}
                      </span>
                      <div>
                        <h5>{l.name}</h5>
                        <p>{l.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 2026-08-16, user's own ask: the old "Choose Each Player's Span" screen and the rotation-
          builder screen are gone as separate phases — both merged into this tab, open from the
          human's very first pick (not gated until the draft ends, per that same ask), ending in
          one Submit action instead of two separate confirm screens. Always built against
          `humanTeam` (never `teamForPanels`) — see this file's own comment on that split above;
          Commissioner Mode still only ever builds the one isHuman team's span/rotation here. */}
      {activeTab === 'team' && (
        <div className="at-card">
          <h1 className="at-panel-title at-cond">Rotation</h1>
          {humanTeam.roster.length === 0 ? (
            <div className="at-placeholder">
              Opens as soon as you make your first pick — set spans (in the Team table above) and
              minutes here as you go, no need to wait for the draft to end.
            </div>
          ) : (
            <>
              <RotationBuilder
                key={spanVersion}
                roster={chosenHumanRoster}
                onConfirm={(rotation) => onSubmitTeam(chosenHumanRoster, rotation)}
                confirmLabel="Submit Team"
                // The span dropdown deliberately lists every span (comparing them by cost is the
                // point), so a player can swap to a pricier span and push the chosen roster over
                // the cap. `handleSubmitTeam` writes the human's spans through verbatim (no
                // `optimizeSpans` clamp, unlike the AI path) — so block the submit here, or the
                // human is scored over a cap all 15 AI teams are held to.
                confirmDisabled={!state.complete || chosenRosterOverCap}
                confirmDisabledHint={
                  !state.complete
                    ? `Finish drafting all ${ROSTER_SIZE} picks before you can submit.`
                    : chosenRosterOverCap
                      ? `Your chosen spans total ${chosenRosterFga.toFixed(1)} shots — over the ${CAP_LIMIT} cap. Pick cheaper spans in the Team table above.`
                      : undefined
                }
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
