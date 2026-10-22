import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NO_THREE_LINE_TIP, gradeTip, spacingUngraded, type GradeKey } from './gradeHelp';
import { ROLE_FILTERS, ROLE_POSITIONS, matchesRoleFilter } from './cardRoles';
import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { TEAM_COUNT, ROUNDS, currentTeamIndex, dailyAlternative, draftBombSpan, draftCapLimit, isDailyRuleBlocked, isPickLegal, pickBlockReason, pickBudget, type DraftState } from '../engine/draft';
import { dailyRuleWords } from '../dailyDraftDay';
import { dailyRuleBlocks } from '../engine/dailyDraft';
import { ROSTER_SIZE, totalFga, STARTER_SLOTS } from '../engine/positions';
import { computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { effectiveTalent, displayTalentForSpan } from '../engine/grades';
import { computeSpacing, spacingTier, type SpacingTier } from '../engine/spacing';
import { spanEndYears } from '../engine/era';
import { allStarCount } from '../engine/allStarLookup';
import { spanOptionsFor } from '../engine/spanOptimizer';
import RotationBuilder from './RotationBuilder';
import type { Rotation, Team } from '../engine/types';
import {
  offensiveGrade,
  defensiveGrade,
  spacingGrade,
  durabilityGrade,
  overallTierForSpan,
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
import { teamLabel, teamCodes } from '../engine/teamNames';
import type { FeedbackEntry } from './FeedbackToggle';
import { upcomingPicks } from './DraftWarRoom';
import { bestPrimaryAssignment } from '../engine/rotation';
import { draftSaveKeys } from '../draftSaveSummary';
import { saveSlotFor } from './draftSave';
import { BOMB_NAME, isBombMasked, maskName } from './bombMask';
import { BOMB_MIN_MINUTES } from '../engine/dailyBomb';
import { PlayerPeekModal } from './PlayerPeekModal';
import { CallSheet, CallWindow, PhoneChip, WarRoomBanner } from './PhoneDesk';
import { CALLS_PER_DRAFT, EMPTY_CALL_LOG, callOptions, logCall, placeCall, type CallId, type CallLog, type CallResult } from '../engine/deskCalls';
import { Actions, Btn, CapBar, EmptyNote, H3, Kv, Mast, NFace, NightGame, Prompt, SubNote, Tally, buzz, fmtCaps, lastName } from '../night/ui';
import { CapsBar, Notice, PickLog, PlayerTable, PosTabs, type NightRow } from '../night/draft';
import { BoardGrid, NineSlots, StretchTable } from '../night/alltime';
import { NightConfirm, NightHowTo, NightSettings } from '../night/Dialogs';

/** Max player rows the Draft tab renders at once. The list is tier-sorted, so this is the top-N
 * players; anyone past it is reachable via search or a position filter (both land well under the
 * cap). Rendering all ~720 as expandable accordion rows was ~11s per keystroke. */
const DRAFT_LIST_LIMIT = 140;
/** 2026-09-14, user-reported live: how many of those (already-capped) rows actually show at once
 * before "See more" is needed — a separate, much smaller number purely for not overwhelming the
 * player with a wall of cards, independent of `DRAFT_LIST_LIMIT`'s own performance reasoning. */
const DRAFT_VISIBLE_DEFAULT = 30;
const DRAFT_VISIBLE_STEP = 30;
/** The caps range's top: no stretch in the pool costs more. */
const CAPS_TOP = 30;

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
  /** 2026-09-12, user-reported live ("nadal brak korelacji" — the Team tab's own cap meter could
   * show real, saved cap room from a cheaper span swap that the Draft tab's actual pick-legality
   * gate never saw, since a swap was always a local `DraftBoard`-only preview never written back
   * into `state`). Applies a span swap for real, in `GameShell`'s own `draftState` — but ONLY when
   * `setHumanSpan` below has already verified it's safe (never costs more than the span originally
   * drafted, and never busts the real cap) — so every other read of the human's roster
   * (`isPickLegal`'s lookahead included) sees the same, single, real number from that point on. */
  onSwapHumanSpan: (playerName: string, newSpanId: string) => void;
  /** The mode's rules, shown in the "?" dialog next to the tier key. */
  howToPlay?: ReadonlyArray<{ title: string; body: string }>;
  /** 2026-09-24: back to the main menu (after a confirm — the draft is autosaved, see draftSave.ts). */
  onExit: () => void;
  /** 2026-09-25: the Draft Desk is open — GameShell holds CPU picks until it closes. */
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
type DisplayOverallTier = OverallTier | 'Salary Glue';

const OVERALL_TIER_CLASS: Record<DisplayOverallTier, string> = {
  'Salary Glue': 'rating-glue',
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
  return span.fga < 2 ? 'Salary Glue' : overallTierForSpan(tierContextFor(span));
}

/** 2026-09-12, user's explicit choice ("wariant A") from a 3-option mockup: the Draft tab's
 * player cards drop the text tier badge entirely and carry the tier as a colored frame + corner
 * flag around the whole card instead — same 11-tier palette `OVERALL_TIER_CLASS` already uses for
 * the text badge everywhere else (Team roster table, Rotation, the peek modal — all untouched,
 * this is scoped to the browsing grid only), just reused as a border/corner accent instead of a
 * pill background. `.at-player-card`'s parent `.at-shell` is fixed dark always (see that class's
 * own docstring — a broadcast-board look that deliberately ignores `prefers-color-scheme`), so
 * this reuses each tier's already-defined DARK-mode hue directly rather than forking another
 * light/dark pair that would only ever render one half of. */
/* 2026-09-12, user-reported live ("kolor różowy w all-nba nie do końca mi się podoba"): the
   original `.rating-allnba` hex (#b2a3f2) is a lightened dark-mode derivative of the light-mode
   indigo (#5b3fb0) — brightening it for dark-background contrast pulled it close enough to MVP's
   own pastel pink (#ec8ecb) that the two read as near-neighbors instead of distinct rungs. Shifted
   cooler/bluer (indigo, not lavender) so it stays clearly on the blue side of MVP's pink — same
   "cyan -> indigo -> magenta -> gold" ladder this palette was always meant to read as. */


/** Shared by `OverallTierBadge` and every "TAL {number}" display site — building this once and
 * reusing it for both the badge and the number next to it is what guarantees they can never
 * disagree (see `displayTalentForSpan`'s own docstring for why they used to). `playerName` is
 * needed for the GOAT-tier check (grades.ts) — every other field already came from `span`. */
// Moved to grades.ts (2026-08-14) so aiDrafter.ts (pure engine) can build a real tier-capped
// context too, without an engine file importing a React component — re-exported here (imported
// above) so this file's own and DraftPoolBrowser.tsx's existing call sites are unaffected.
export { tierContextFor };

export function OverallTierBadge({ span }: { span: PlayerSpan }) {
  // The Bomb daily: his tier would give him away until the results.
  if (isBombMasked(span.playerName)) return <span className="tier-badge tier-badge--bomb">?</span>;
  const tier = displayedOverallTier(span);
  return <span className={`tier-badge ${OVERALL_TIER_CLASS[tier]}`}>{tier}</span>;
}

/** Tooltip for a Draft button — says WHY a pick is blocked instead of one generic "over the cap"
 * line, since since 2026-09-24 a pick can also be blocked for leaving too little for the rest of
 * the roster (`pickBlockReason`'s 'reserve'), not only for busting the cap outright. */
export function draftButtonTitle(state: DraftState, spanId: string, canPick: boolean, currentTeam: Team, label?: string): string | undefined {
  if (!canPick) return `${teamLabel(currentTeam)} is picking…`;
  const reason = pickBlockReason(state, spanId);
  if (reason === 'rule' && state.dailyRule) return `Not today — ${dailyRuleWords(state.dailyRule).ruleLine.toLowerCase()}.`;
  if (reason === 'cap') return 'Over the cap — pick a cheaper player, or cheaper years for this one.';
  if (reason === 'reserve') {
    const budget = pickBudget(state);
    return `Too expensive right now — you need to keep ${budget.reserved} caps for your other ${budget.slotsLeft - 1} pick${budget.slotsLeft - 1 === 1 ? '' : 's'}. This pick can cost up to ${budget.maxThisPick} caps.`;
  }
  return label;
}


/** 2026-09-25, user's ask ("rozszerzenie scouting report o wszystkie sezony, tylko surowe
 * statystyki; gracz może 3 razy w ciągu draftu użyć scouta żeby pokazać dokładnie offense,
 * defense itd"): how many full scouting reports a draft allows. */
export const SCOUT_REPORTS_PER_DRAFT = 3;


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

/** 2026-08-16, user's own ask: a hover tooltip on the Overview grid's own pick cells, once a
 * player is actually drafted — same `.at-name-tip`/`data-tip` popover mechanics as team names
 * above, just built from this specific drafted SPAN's own real box line (`pick.box`) rather than
 * a career average, since that's the exact season this roster spot actually rosters. */
export function pickStatTip(pick: PlayerSpan): string {
  const b = pick.box;
  return `${b.ppg.toFixed(1)} PPG · ${b.apg.toFixed(1)} APG · ${b.rpg.toFixed(1)} RPG · ${(b.fgPct * 100).toFixed(1)}% FG · ${(b.threePct * 100).toFixed(1)}% 3PT`;
}

// 2026-09-11, user-reported live ("4) brak koloru" — the Team tab's OFF/DEF/O-POR/D-POR pills all
// reading as the same navy regardless of grade): these used to share the app-wide `at-t1..at-t6`
// tone ramp, which is a deliberately monochrome-BLUE "how exceptional is this" scale (also used
// for talent tiers, results tone, lottery highlight — contexts where "worst" doesn't mean "bad",
// just "less exceptional"). A letter grade is the one place that ramp doesn't fit: S-vs-F is a
// genuine good/bad judgment, so it gets its own real red→green scale instead — scoped to grades
// only, the shared tone ramp everywhere else is untouched.
const GRADE_RANK: Record<Grade, number> = {
  S: 13, 'A+': 12, A: 11, 'A-': 10, 'B+': 9, B: 8, 'B-': 7, 'C+': 6, C: 5, 'C-': 4, 'D+': 3, D: 2, 'D-': 1, F: 0,
};
export function gradeColor(grade: Grade): string {
  const t = GRADE_RANK[grade] / 13; // 0 (F, worst) .. 1 (S, best)
  const hue = 2 + t * 146; // 2 = red, 148 = green, same endpoints MatchupMatrix's own diverging scale uses
  const saturation = 42 + Math.abs(t - 0.5) * 34; // most saturated at both extremes, muted mid-pack
  const lightness = 30 + t * 9;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

// Exported (2026-08-19) for RotationBuilder's own reuse — see that file's own docstring on why
// the Team/Rotation screen now shows the same Offense/Defense letter grades this badge already
// renders on the Draft tab, instead of building a second, slightly-different badge from scratch.
export function AtGrade({ grade, label, ungraded }: { grade: Grade; label?: GradeKey; ungraded?: boolean }) {
  // 2026-10-14: with a label the badge explains itself on hover/tap (gradeHelp.ts).
  if (ungraded) {
    return (
      <span className="at-grade-badge at-grade-badge--none at-name-tip at-grade-tip" tabIndex={0} data-tip={NO_THREE_LINE_TIP}>
        —
      </span>
    );
  }
  if (!label) {
    return (
      <span className="at-grade-badge" style={{ background: gradeColor(grade), color: '#fff' }}>
        {grade}
      </span>
    );
  }
  return (
    <span className="at-grade-badge at-name-tip at-grade-tip" tabIndex={0} data-tip={gradeTip(label, grade)} style={{ background: gradeColor(grade), color: '#fff' }}>
      {grade}
    </span>
  );
}


/** How long the taken cards take to fold away when the player's own turn comes. */
const GHOST_SWEEP_MS = 1300;

export default function DraftBoard({
  state,
  onPick,
  mode,
  onSubmitTeam,
  onSwapHumanSpan,
  howToPlay = [],
  onExit,
}: Props) {
  const showJudgeMetrics = mode === 'developer';
  const [search, setSearch] = useState('');
  // 2026-10-14, the list redesign (the user: "gracz może sobie odznaczyć pokazywanie PG, SG itd"):
  // tick the positions the list shows. Until the player touches them, the starter slots already
  // filled are unticked (all shown again once the five is set); a touch makes the choice his.
  const [tab, setTab] = useState<Position | 'ALL' | null>(null);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [boardSort, setBoardSort] = useState<'best' | 'value' | 'cheapest' | 'priciest'>('best');
  // 2026-09-14, user-reported live ("rzucamy ponad 100 nazwisk na raz, za dużo informacji dla
  // użytkownika na raz" — throwing 100+ names at once is too much information at once): the
  // DRAFT_LIST_LIMIT=140 cap a few lines down exists for RENDER PERFORMANCE (see its own
  // docstring — an uncapped tier-sorted "ALL" view was ~11s per keystroke), not for how much a
  // person can actually scan at once, and this session's earlier "make it fill the whole screen"
  // pass only made that worse (more columns fit, same huge count). `visibleCount` is a second,
  // independent cap purely for how many of the already-computed `groups` get rendered — "See
  // more" below raises it in one comfortable-screenful steps; switching the search text or
  // position pill (an intentional re-browse) drops it back to the default via the effect below,
  // so a leftover expanded count from one search doesn't carry over and immediately dump a wall of
  // cards under the next one.
  const [visibleCount, setVisibleCount] = useState(DRAFT_VISIBLE_DEFAULT);
  useEffect(() => {
    setVisibleCount(DRAFT_VISIBLE_DEFAULT);
  }, [search, tab, roleFilter, boardSort]);
  const [fgaMin, setFgaMin] = useState('0');
  const [fgaMax, setFgaMax] = useState('30');
  // 2026-09-11, user-reported live ("zacina się jak filtrujemy fga") — every keystroke here used
  // to force the whole `enrichedGroups` memo below (every player group, not just the filtered-out
  // spans) to re-filter and re-run its reduce/sort. Each individual span touch is now cache-hit-
  // cheap (the `tierContextWithSixthMan` cache fix, sixthMan.ts), but the group-level bookkeeping
  // alone still measured 60-180ms per keystroke live — a real stutter while actively typing.
  // Debouncing the value the memo actually reacts to (not what the input displays, which stays
  // instant either way) means typing itself never blocks; only the recompute waits for a pause.
  const [fgaMinDebounced, setFgaMinDebounced] = useState(fgaMin);
  const [fgaMaxDebounced, setFgaMaxDebounced] = useState(fgaMax);
  useEffect(() => {
    const t = setTimeout(() => setFgaMinDebounced(fgaMin), 200);
    return () => clearTimeout(t);
  }, [fgaMin]);
  useEffect(() => {
    const t = setTimeout(() => setFgaMaxDebounced(fgaMax), 200);
    return () => clearTimeout(t);
  }, [fgaMax]);
  // One player's scouting window at a time.
  const [peekPlayer, setPeekPlayer] = useState<string | null>(null);
  // Scouting reports used this draft — kept per draft seed so a resumed draft remembers them.
  const scoutKey = `draftverse.scouted.v1.${state.seed}`;
  const [scoutedPlayers, setScoutedPlayers] = useState<Set<string>>(() => {
    try {
      // Drop reports left over from earlier drafts.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('draftverse.scouted.v1.') && key !== scoutKey) localStorage.removeItem(key);
      }
      const raw = localStorage.getItem(scoutKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  // 2026-10-14, the Big Board: your own ranking of who you want next, kept per draft like the
  // scouting reports (and dropped with an earlier draft's).
  const bigBoardKey = `draftverse.bigboard.v1.${state.seed}`;
  const [bigBoard, setBigBoard] = useState<string[]>(() => {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('draftverse.bigboard.v1.') && key !== bigBoardKey) localStorage.removeItem(key);
      }
      const raw = localStorage.getItem(bigBoardKey);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  // 2026-10-15, Phone the Desk (PhoneDesk.tsx, engine/deskCalls.ts): the calls used this draft,
  // kept per draft seed like the scouting reports and the Big Board.
  const callsKey = `draftverse.calls.v1.${state.seed}`;
  const [callLog, setCallLog] = useState<CallLog>(() => {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('draftverse.calls.v1.') && key !== callsKey) localStorage.removeItem(key);
      }
      const raw = localStorage.getItem(callsKey);
      return raw ? { ...EMPTY_CALL_LOG, ...(JSON.parse(raw) as CallLog) } : EMPTY_CALL_LOG;
    } catch {
      return EMPTY_CALL_LOG;
    }
  });
  function saveCallLog(next: CallLog) {
    setCallLog(next);
    try {
      localStorage.setItem(callsKey, JSON.stringify(next));
    } catch {
      // storage unavailable — the calls still count for this session
    }
  }
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<{ result: CallResult | null; number: number | null } | null>(null);
  const [warRoomShowAll, setWarRoomShowAll] = useState(false);
  const callPickNo = state.round * TEAM_COUNT + state.pickInRound;
  const warRoomSet = useMemo(
    () => (callLog.warRoomPick === callPickNo && callLog.warRoom && !warRoomShowAll ? new Set(callLog.warRoom) : null),
    [callLog.warRoomPick, callLog.warRoom, callPickNo, warRoomShowAll],
  );
  useEffect(() => setWarRoomShowAll(false), [callPickNo]);
  function placeDeskCall(id: CallId) {
    setCallSheetOpen(false);
    setActiveCall({ result: null, number: null });
    // A beat for the "dialling" frame: the War Room scores up to forty rosters.
    window.setTimeout(() => {
      const result = placeCall(id, state, state.seed);
      const next = logCall(callLog, result, state);
      saveCallLog(next);
      setActiveCall({ result, number: id === 'moonbat' ? null : next.used.length });
    }, 30);
  }
  function saveBigBoard(next: string[]) {
    setBigBoard(next);
    try {
      localStorage.setItem(bigBoardKey, JSON.stringify(next));
    } catch {
      // storage unavailable — the board still works for this session
    }
  }
  function toggleBigBoard(name: string) {
    saveBigBoard(bigBoard.includes(name) ? bigBoard.filter((n) => n !== name) : [...bigBoard, name]);
  }
  function scoutPlayer(name: string) {
    setScoutedPlayers((prev) => {
      if (prev.has(name) || prev.size >= SCOUT_REPORTS_PER_DRAFT) return prev;
      const next = new Set(prev).add(name);
      try {
        localStorage.setItem(scoutKey, JSON.stringify([...next]));
      } catch {
        // storage unavailable — the reports still work for this session
      }
      return next;
    });
  }
  const [activeTab, setActiveTab] = useState<AtTab>('draft');
  // 2026-10-14 (playtest: "po skończonym drafcie mogłoby przenosić automatycznie do zakładki Team"):
  // the last pick in, the Team tab opens — your years and rotation are what's left to do.
  useEffect(() => {
    if (!state.complete) return;
    setActiveTab('team');
    window.scrollTo({ top: 0 });
  }, [state.complete]);
  const [confirmExit, setConfirmExit] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  // The draft board over the list, one button away (mockup `#board`).
  const [boardShown, setBoardShown] = useState(false);
  const closeExitDialog = useCallback(() => setConfirmExit(false), []);
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
  // Every team's cap: the real 100.9, or the day's in a daily (2026-10-16).
  const capLimit = draftCapLimit(state);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The Bomb daily: the hidden player still to come sits in his round with his caps set aside.
  const bombSpan = draftBombSpan(state);
  const bombLanded = !!bombSpan && humanTeam.roster.some((p) => p.id === bombSpan.id);
  const bombMinimum = useMemo(
    () => (bombSpan ? { playerId: bombSpan.id, minutes: BOMB_MIN_MINUTES, label: BOMB_NAME } : undefined),
    [bombSpan],
  );

  // 2026-08-16, user's own ask: span selection + rotation-building moved off their own dedicated
  // post-draft screens and into the Team tab below, reachable from the human's very first pick —
  // always against `humanTeam` specifically (never `teamForPanels`), same "Commissioner Mode
  // still only ever builds the ONE isHuman team's span/rotation" scoping this file's own
  // `teamForPanels` comment above already documents for the roster table.
  // Keyed by normalized player name (one entry per drafted PICK, not per real-world player who
  // could have several spans in the pool) — same shape the old SpanSelectionScreen used.
  const [humanSpanSelection, setHumanSpanSelection] = useState<Record<string, string>>({});

  // 2026-09-12, user-reported live ("nadal brak korelacji") + user's own explicit direction
  // ("zamiana w dół = realna, od razu"): the FGA a pick was actually drafted at is the one number
  // `isPickLegal`'s lookahead already promised every OTHER team it wouldn't exceed — so swapping
  // to anything AT OR BELOW that original number can never retroactively invalidate a decision the
  // AI already made, and is safe to commit for real, immediately. Swapping ABOVE it stays exactly
  // what it always was: a local preview, gated for real only at Submit (`chosenRosterOverCap`).
  // A `ref` (not state) because this is pure bookkeeping the render output never reads directly —
  // only `setHumanSpan` below consults it — and it must never reset a key once captured, including
  // across the very re-render a real commit itself causes.
  const originalPeakFgaByKeyRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    for (const p of humanTeam.roster) {
      const key = normalizePlayerName(p.playerName);
      if (!originalPeakFgaByKeyRef.current.has(key)) {
        originalPeakFgaByKeyRef.current.set(key, p.fga);
      }
    }
  }, [humanTeam.roster]);

  function setHumanSpan(key: string, spanId: string, playerName: string, options: PlayerSpan[]) {
    const chosen = options.find((o) => o.id === spanId);
    const originalPeakFga = originalPeakFgaByKeyRef.current.get(key);
    if (chosen && originalPeakFga !== undefined && chosen.fga <= originalPeakFga) {
      // Re-verify against the FULL roster, not just this one player — a real commit that would
      // itself bust the cap (e.g. swapping back up toward peak after the freed room from an
      // earlier real downward swap was already spent on a different pick) must still fall back to
      // preview-only, same as any ordinary above-peak swap.
      const wouldBeRoster = humanTeam.roster.map((p) => (normalizePlayerName(p.playerName) === key ? chosen : p));
      if (totalFga(wouldBeRoster.map((p) => p.fga)) <= capLimit) {
        onSwapHumanSpan(playerName, spanId);
        // The real roster (read via `draftedSpan` below) now already reflects this choice — no
        // local override left to fall back from, so a later render doesn't have two conflicting
        // sources of truth for the same key.
        setHumanSpanSelection((prev) => {
          if (!(key in prev)) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
        return;
      }
    }
    setHumanSpanSelection((prev) => ({ ...prev, [key]: spanId }));
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
  // 2026-09-12, user-reported live (Auto-finish appearing to hang on a full 144-pick draft): this
  // used to be a bare `.map()` in the render body — a brand-new array (and options) on every
  // single DraftBoard render, human pick or not. Harmless while the Rotation card unmounted
  // whenever you weren't on the Team tab (see that card's own "always mounted" fix above), but
  // once it stays mounted for the WHOLE draft, an unstable `roster` prop forces it to fully
  // re-render — and re-run its own `optionsFor`/`benchWithMinutes` work — on all 143 OTHER teams'
  // picks too, not just the human's 9. Real `autoFinishDraft` timing in isolation (`tsx`, no React)
  // stayed ~19-20s with or without today's rotation changes — the slowdown was this render, not
  // the engine. Memoized so AI-only picks (`humanSpanOptions`/`humanSpanSelection` both unchanged)
  // return the SAME array reference, letting `RotationBuilder`'s own `React.memo` (see that
  // component) skip re-rendering entirely for them.
  const chosenHumanRoster: PlayerSpan[] = useMemo(
    () =>
      humanSpanOptions.map(({ key, draftedSpan, options }) => {
        const chosenId = humanSpanSelection[key];
        return options.find((o) => o.id === chosenId) ?? draftedSpan;
      }),
    [humanSpanOptions, humanSpanSelection],
  );
  // Same "AI-only picks shouldn't re-render the Rotation card" fix as `chosenHumanRoster` above —
  // an inline `(rotation) => onSubmitTeam(chosenHumanRoster, rotation)` at the call site is a new
  // function every render regardless of any memoization upstream, which alone would defeat
  // `RotationBuilder`'s own `React.memo`. Refs hold the latest values so this callback's identity
  // never changes at all, independent of whether `onSubmitTeam` itself is stable in its parent.
  /** A daily's rule holds for your years too (2026-10-16): the years picker offers no decade and
   * no second MVP-tier stretch the rule keeps from you, read against the years you have chosen
   * for everyone else — so the five you submit always keeps to it. */
  function yearsAllowedToday(spanOpt: { key: string; options: PlayerSpan[] }, selectedId: string): PlayerSpan[] {
    const rule = state.dailyRule;
    if (!rule || state.commissionerMode) return spanOpt.options;
    const others = chosenHumanRoster.filter((p) => normalizePlayerName(p.playerName) !== spanOpt.key);
    return spanOpt.options.filter((o) => o.id === selectedId || !dailyRuleBlocks(rule, o, others));
  }
  const chosenHumanRosterRef = useRef(chosenHumanRoster);
  chosenHumanRosterRef.current = chosenHumanRoster;
  const onSubmitTeamRef = useRef(onSubmitTeam);
  onSubmitTeamRef.current = onSubmitTeam;
  const handleRotationConfirm = useCallback((rotation: Rotation) => {
    onSubmitTeamRef.current(chosenHumanRosterRef.current, rotation);
  }, []);

  // 2026-09-11, user's own inspiration screenshot ("po prawej nasz zespół... jeden element" —
  // Draft and Team merged into one screen, a persistent team sidebar next to the player cards):
  // same optimal starter-slot search `finalizeQuickRotation`/QuickFive's own team panel already
  // use for the identical need there, so this sidebar reads as PG/SG/SF/PF/C coverage instead of
  // draft order. Read-only here (span-swap + full rotation-minute editing stay on the Team tab —
  // deliberately scoped smaller for this pass; see this session's own conversation for why) —
  // this is "what do I already have" at a glance while still browsing the board.
  // 2026-09-12, code-review fix: this briefly read `chosenHumanRoster` (the span-swap PREVIEW),
  // on the stated belief that it'd match "the Team tab's own cap meter right below it" — but the
  // cap bar actually living right below it in this SAME sidebar (`at-draft-sidebar-cap`, a few
  // lines down) deliberately stays on the REAL `currentFgas`/`humanTeam.roster`, precisely to
  // avoid ever promising more draftable room than `isPickLegal` actually enforces (the exact
  // failure mode a real user report already caught once this session for the old inline label).
  // So for one card to ever show an UPWARD (not-yet-committed) span swap, the roster grid/bench
  // here would show the swapped, pricier player while the cap number beside it didn't move —
  // reopening that same "two adjacent numbers disagree" complaint in a new spot. Back to
  // `humanTeam.roster` so every number in this read-only summary card is the same real, enforced
  // state; the Team tab remains the one place an upward swap actually previews (roster table +
  // its own cap meter both already consistently read `chosenHumanRoster`/`displayFgas` there).
  const humanAssignment = useMemo(
    () => bestPrimaryAssignment(humanTeam.roster).assignment,
    [humanTeam.roster],
  );

  // 2026-10-14: the Draft Desk (three pundits after your third pick) and the rim-pressure note
  // left the free flow with the screen redesign; they come back as lifelines (TODO.md).


  // True whenever the Team tab's roster table is actually showing the human's own roster — always
  // true outside Commissioner Mode (`teamForPanels` IS `humanTeam` then), only sometimes true
  // inside it (only when the human's own team happens to be the one currently on the clock).
  // Gates both the inline span dropdown below and which FGA numbers the cap meter reads.
  const isViewingHumanRoster = teamForPanels.id === humanTeam.id;
  const humanSpanOptionsByKey = new Map(humanSpanOptions.map((o) => [o.key, o]));

  const currentFgas = teamForPanels.roster.map((p) => p.fga);
  const draftComplete = humanTeam.roster.length >= ROSTER_SIZE;
  // 2026-09-12: `currentFgas` above (read straight off `humanTeam.roster`, the REAL `state`) is
  // now already correct on its own for a swapped-down player — see `setHumanSpan`'s own docstring
  // for why a downward swap commits for real into `state` instead of staying a local preview like
  // every earlier iteration of this line did. `displayFgas` only still needs to differ from
  // `currentFgas` for the one case that's genuinely still preview-only: an UPWARD swap (pricier
  // than originally drafted), which `chosenHumanRoster` reflects but `state` deliberately never
  // does until Submit (`chosenRosterOverCap` below is that gate). Both numbers agree automatically
  // for every other case, which is the actual fix for the repeated "brak korelacji" reports.
  const displayFgas = isViewingHumanRoster
    ? [...chosenHumanRoster.map((p) => p.fga), ...(bombSpan && !bombLanded ? [bombSpan.fga] : [])]
    : currentFgas;
  // The human's chosen-span roster measured against the cap — the span dropdown can pick a
  // pricier span than was drafted, and nothing downstream clamps it (see the Submit button).
  const chosenRosterFga = totalFga(chosenHumanRoster.map((p) => p.fga));
  const chosenRosterOverCap = chosenRosterFga > capLimit;

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
  // span of theirs happened to fail the lookahead check (`strictPickLegal`, draft.ts — which
  // since 2026-09-24 applies to the human again, gating the Draft button, never visibility). Every undrafted span now stays visible regardless of
  // legality — the actual 100.9 FGA cap itself is untouched and still real; a span that would
  // bust it outright still can't actually be drafted (`isPickLegal` still gates the Draft button
  // itself, at both the collapsed and expanded row below), it just isn't hidden from view first.
  const legalGroups = allGroups;

  const fgaMinNum = Number(fgaMinDebounced);
  const fgaMaxNum = Number(fgaMaxDebounced);
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
      // 2026-09-11, user-reported live ("po wciśnięciu skip długi czas ładowania"): `isSixthMan`
      // only ever affects the TIER label (`overallTierForSpan`'s own `ctx.isSixthMan ? 'Sixth
      // Man' : ...`), never the talent number `displayTalentForSpan` returns — so this comparison
      // (number only, no tier read) can use the already-memoized `effectiveTalent` instead of a
      // fresh, uncached `tierContextFor` on both sides of every reduce step. Byte-identical result.
      const bestTalentSpan = g.spans.reduce(
        (best, s) => (effectiveTalent(s) > effectiveTalent(best) ? s : best),
        g.spans[0],
      );
      // Player-mode only: every one of this player's spans, ranked by the same hidden AI
      // valuation used for `bestTalentSpan` above — lets the expanded row show "the 3 the engine
      // likes best" first (+ a Show more for the rest) without ever surfacing the score or tier
      // that produced the ordering. Skipped in developer mode, which shows spans chronologically
      // instead (`group.spans`, already sorted by `byChronology`).
      const spansByAiValue = showJudgeMetrics
        ? g.spans
        : [...g.spans].sort((a, b) => effectiveTalent(b) - effectiveTalent(a));
      // 2026-09-12, code-review finding: the Biedriņš-fix fallback a few hundred lines down
      // (`target = bestLegal ? best : group.spansByAiValue.find(...) ?? best`) leaned on
      // `spansByAiValue`'s comment claiming it's "already TAL-sorted" — true in player mode, but
      // in developer mode `spansByAiValue` is deliberately `g.spans` (chronological, for browsing
      // a career by season — see the comment above), not value-sorted at all. That silently made
      // the fallback pick the first chronologically-affordable season in developer mode instead
      // of the best-TAL affordable one. A real, always-TAL-sorted list, kept separate from
      // `spansByAiValue` so that one's own developer-mode chronological order stays intact.
      const spansByTal = [...g.spans].sort((a, b) => effectiveTalent(b) - effectiveTalent(a));
      return {
        ...g,
        bestTalentSpan,
        spansByAiValue,
        spansByTal,
        // 2026-08-19, bug found while adding the player-mode tier badge below: the sort comparator's
        // own comment (a few lines down) already claimed this was "computed unconditionally... costs
        // nothing new" for the player-mode tiebreak, but the code here contradicted it — zeroing
        // `bestTalent` in player mode made that tiebreak compare 0-0 for the ~90% of the pool with
        // no real All-Star selections, silently reverting to incidental array order for almost the
        // whole list despite the comment's claim it was fixed. Made genuinely unconditional to match
        // what the comment already said was true; still never DISPLAYED as a raw number in player
        // mode (only the coarser tier badge is), so this doesn't reveal anything new on-screen.
        bestTalent: effectiveTalent(bestTalentSpan),
        // The TAL number the card itself shows for this player's best span — the list is ordered
        // by it so the visible numbers read top to bottom (user's ask: "kolejność od TAL dla
        // spójności").
        bestDisplayTal: displayTalentForSpan(tierContextFor(bestTalentSpan)),
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
  // 2026-09-14, user-reported live ("po kilku rundach powinno dobierać widocznych graczy pod
  // brakujące pozycje" — after a few rounds it should pick the visible players for the missing
  // positions): once the human has a few picks in AND isn't already narrowing by position/name
  // (that's the user's own explicit override — never second-guess it), players whose career
  // position (the same one `careerPosition` already uses for the pill filter) still has an open
  // starter slot sort ahead of everyone else, quality-ordered same as before WITHIN each of the
  // two groups. `humanAssignment` (above) already answers "which starter slots are filled" via the
  // exact same `bestPrimaryAssignment` the Draft sidebar's own "Your Five" card reads — reused
  // rather than a second, possibly-divergent notion of "need". 3+ picks ("a few rounds") avoids
  // biasing the very first look at the board, where every slot is open and the bias would be a
  // no-op busywork pass over the whole pool anyway.
  const openStarterPositions = useMemo(
    () => new Set(STARTER_SLOTS.filter((slot) => !humanAssignment[slot])),
    [humanAssignment],
  );
  useEffect(() => setTab(null), [humanTeam.roster.length]);
  const have = useMemo(() => new Set(STARTER_SLOTS.filter((slot) => humanAssignment[slot])), [humanAssignment]);
  const firstOpen = STARTER_SLOTS.find((slot) => !humanAssignment[slot]);
  const on: Position | 'ALL' = tab ?? (have.size > 0 && firstOpen ? firstOpen : 'ALL');
  const hiddenPositions = useMemo<Set<Position>>(() => (on === 'ALL' ? new Set() : new Set(ALL_POSITIONS.filter((pos) => pos !== on))), [on]);
  const shownPositions = ALL_POSITIONS.filter((pos) => !hiddenPositions.has(pos));
  const roleFits = (role: string) => ROLE_POSITIONS[role]?.some((pos) => shownPositions.includes(pos)) ?? true;
  const roleFitsKey = shownPositions.join(',');
  useEffect(() => {
    if (roleFilter && !roleFits(roleFilter)) setRoleFilter(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFitsKey, roleFilter]);
  const needBiasActive = hiddenPositions.size === 0 && !search && humanTeam.roster.length >= 3 && openStarterPositions.size > 0;

  // 2026-09-27, the user (after the "Druga runda bez chaosu" mockup): while the AI picks, the list
  // no longer reflows under the player's finger. A player the AI takes stays in his place, dimmed
  // and stamped "Taken #18 · BAL"; the taken cards fold away in one slow sweep when the player's
  // own turn comes (`GHOST_SWEEP_MS`). The human's own picks leave at once.
  const spanById = useMemo(() => new Map(state.pool.map((s) => [s.id, s])), [state.pool]);
  const [settledAt, setSettledAt] = useState(state.history.length);
  const settledFrom = Math.min(settledAt, state.history.length);
  const ghosts = useMemo(() => {
    const taken = new Map<string, { pickNumber: number; teamCode: string }>();
    for (const entry of state.history.slice(settledFrom)) {
      if (entry.teamId === humanTeam.id) continue;
      const span = spanById.get(entry.playerId);
      if (!span) continue;
      taken.set(normalizePlayerName(span.playerName), { pickNumber: entry.pickNumber, teamCode: teamCodeByTeamId.get(entry.teamId) ?? '' });
    }
    return taken;
  }, [state.history, settledFrom, humanTeam.id, spanById, teamCodeByTeamId]);
  const hasGhosts = ghosts.size > 0;
  useEffect(() => {
    if (!canPick || state.complete || !hasGhosts) return;
    const target = state.history.length;
    const timer = window.setTimeout(() => {
      setSettledAt(target);
    }, GHOST_SWEEP_MS);
    // A pick made mid-sweep (or leaving the screen) settles at once instead of leaving the sweep on.
    return () => {
      window.clearTimeout(timer);
      setSettledAt((at) => Math.max(at, target));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPick, state.complete, hasGhosts]);

  const { groups, totalMatched } = useMemo(() => {
    const q = search.toLowerCase();
    const matched = enrichedGroups
      .filter((g) => !state.draftedIds.has(g.spans[0].id) || ghosts.has(normalizePlayerName(g.playerName)))
      .filter((g) => !hiddenPositions.has(careerPosition(g)))
      .filter((g) => g.playerName.toLowerCase().includes(q))
      .filter((g) => matchesRoleFilter(g.bestTalentSpan, roleFilter))
      .filter((g) => !warRoomSet || warRoomSet.has(normalizePlayerName(g.playerName)))
      .sort((a, b) => {
        // Onoffsky's War Room: no order, no numbers — just grouped by position.
        if (warRoomSet) {
          const pos = ALL_POSITIONS.indexOf(careerPosition(a)) - ALL_POSITIONS.indexOf(careerPosition(b));
          if (pos !== 0) return pos;
          return a.playerName.localeCompare(b.playerName);
        }
        // 2026-10-08: the board's own sort (player mode) — cheapest first, or the most TAL for
        // the caps (TAL minus two points a cap, so a 99 costing 21 ranks with an 80 costing 10).
        if (mode === 'player' && boardSort !== 'best') {
          const key = (g: typeof a) =>
            boardSort === 'cheapest' ? -g.bestTalentSpan.fga : boardSort === 'priciest' ? g.bestTalentSpan.fga : g.bestDisplayTal - 2 * g.bestTalentSpan.fga;
          const diff = key(b) - key(a);
          if (diff !== 0) return diff;
        }
        if (needBiasActive) {
          const needDiff = Number(openStarterPositions.has(careerPosition(b))) - Number(openStarterPositions.has(careerPosition(a)));
          if (needDiff !== 0) return needDiff;
        }
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
          // 2026-09-25, user's ask ("kolejność pokazywania zawodników od TAL dla spójności"): the
          // card shows a TAL number, so the list now follows it; tier, then All-Star count, then the
          // raw number only break ties between equal visible TALs.
          const talDiff = b.bestDisplayTal - a.bestDisplayTal;
          if (talDiff !== 0) return talDiff;
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
  }, [enrichedGroups, state.draftedIds, ghosts, hiddenPositions, search, mode, needBiasActive, openStarterPositions, roleFilter, boardSort, warRoomSet]);
  // Position tab counts: everyone still on the board for the search, role and caps shown.
  const counts = useMemo(() => {
    const c: Record<Position, number> = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
    const q = search.toLowerCase();
    for (const g of enrichedGroups) {
      if (state.draftedIds.has(g.spans[0].id)) continue;
      if (q && !g.playerName.toLowerCase().includes(q)) continue;
      if (!matchesRoleFilter(g.bestTalentSpan, roleFilter)) continue;
      c[careerPosition(g)] += 1;
    }
    return c;
  }, [enrichedGroups, state.draftedIds, search, roleFilter]);
  const humanPicksAway = useMemo(() => {
    const start = state.round * TEAM_COUNT + state.pickInRound;
    for (let k = start; k < TEAM_COUNT * ROUNDS; k++) {
      const round = Math.floor(k / TEAM_COUNT);
      const pick = k % TEAM_COUNT;
      const idx = round % 2 === 0 ? pick : TEAM_COUNT - 1 - pick;
      if (state.teams[idx].isHuman) return k - start;
    }
    return null;
  }, [state.round, state.pickInRound, state.teams]);
  // 2026-10-14, the status bar and the "Before you pick again" lane: every pick still to come, yours
  // among them, and the rival picks between now and your next one.
  const upcoming = useMemo(
    () => upcomingPicks(state.round * TEAM_COUNT + state.pickInRound, state.teams.length, ROUNDS),
    [state.round, state.pickInRound, state.teams.length],
  );
  const humanIdx = state.teams.findIndex((t) => t.isHuman);
  const humanUpcoming = upcoming.filter((u) => u.teamIdx === humanIdx);
  const youOnClock = !state.complete && upcoming[0]?.teamIdx === humanIdx;
  const humanBench = humanTeam.roster.filter((p) => !Object.values(humanAssignment).some((a) => a?.id === p.id));

  // 2026-09-24: budget for whoever is on the clock (the human outside Commissioner Mode) — drives
  // the "Your pick" banner, the stuck-board notice below it and the sidebar's own budget line.
  const currentBudget = useMemo(() => pickBudget(state), [state]);
  const anyVisibleLegal = useMemo(
    () =>
      !canPick ||
      groups.slice(0, visibleCount).some((g) => g.spans.some((s) => isPickLegal(state, s.id))),
    [canPick, groups, visibleCount, state],
  );
  // The human's own budget (the strip and the "Only what I can afford" switch read it on CPU turns too).
  const humanBudget = useMemo(() => pickBudget(state, humanTeam), [state, humanTeam]);
  /** The best years the board shows for a player: his best, or — when a daily's rule keeps those
   * from you (a decade, a second MVP-tier player) — his best years the rule allows (the user,
   * 2026-10-16: show the best span you can take, no extra words). */
  function shownBest(group: { bestTalentSpan: PlayerSpan }): PlayerSpan {
    if (!state.dailyRule || state.commissionerMode) return group.bestTalentSpan;
    return dailyAlternative(state, group.bestTalentSpan.id) ?? group.bestTalentSpan;
  }
  /** The stretch a player's card drafts: his best, or his best affordable one when the best isn't
   * (see the card grid below). */
  function cardSpanFor(group: { bestTalentSpan: PlayerSpan; spansByTal: PlayerSpan[] }): PlayerSpan {
    const best = shownBest(group);
    if (canPick && isPickLegal(state, best.id)) return best;
    return group.spansByTal.find((s) => canPick && isPickLegal(state, s.id)) ?? best;
  }
  const bigBoardEntries = bigBoard.flatMap((name) => {
    const group = enrichedGroups.find((g) => g.playerName === name);
    if (!group || state.draftedIds.has(group.spans[0].id)) return [];
    const best = shownBest(group);
    const span = canPick && isPickLegal(state, best.id) ? best : cardSpanFor(group);
    return [{ name, span, legal: canPick && isPickLegal(state, span.id) }];
  });
  function showAffordable() {
    setSearch('');
    setTab('ALL');
    setFgaMin('0');
    setFgaMax(String(Math.max(1, Math.floor(humanBudget.maxThisPick))));
  }

  // A short buzz when you come on the clock (settings: Vibration).
  useEffect(() => {
    if (youOnClock) buzz([15, 40, 15]);
  }, [youOnClock]);
  /* ---------------- the night screen (mockup alltime.html #draft, #board, #years, #team) ---------------- */
  const codeOf = (t: Team) => teamCodeByTeamId.get(t.id) ?? '';
  const totalPicks = state.teams.length * ROUNDS;
  const overall = Math.min(state.round * TEAM_COUNT + state.pickInRound + 1, totalPicks);
  const round = Math.min(state.round + 1, ROUNDS);
  const dailyTitle = state.bomb ? `The Bomb · round ${state.bomb.round}` : state.dailyRule ? dailyRuleWords(state.dailyRule).title : state.dailyDay ? 'Open day' : null;
  const title = state.dailyDay || state.bomb ? 'Daily All-Time Draft' : 'All-Time Draft';
  const links = { onMenu: () => setConfirmExit(true), onHowTo: () => setHelpOpen(true), onSettings: () => setSettingsOpen(true) };
  const pickSpans = useMemo(() => {
    const m = new Map<number, PlayerSpan>();
    for (const h of state.history) {
      const sp = spanById.get(h.playerId);
      if (sp) m.set(h.pickNumber, sp);
    }
    return m;
  }, [state.history, spanById]);
  const logRows = state.history.slice(-6).flatMap((h) => {
    const team = state.teams.find((t) => t.id === h.teamId);
    const span = pickSpans.get(h.pickNumber);
    return team && span ? [{ n: h.pickNumber, team, code: codeOf(team), span }] : [];
  });
  const takenAt = (name: string) => {
    const key = normalizePlayerName(name);
    return state.history.find((h) => {
      const sp = pickSpans.get(h.pickNumber);
      return sp && normalizePlayerName(sp.playerName) === key;
    })?.pickNumber;
  };
  const used = capLimit - humanBudget.capLeft;
  const spotWord = (n: number) => (n === 1 ? 'one spot' : `${['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] ?? n} spots`);
  const lineup = humanAssignment as Partial<Record<Position, PlayerSpan>>;
  const scoutsLeft = SCOUT_REPORTS_PER_DRAFT - scoutedPlayers.size;
  const callsLeft = CALLS_PER_DRAFT - callLog.used.length;
  const gradesOf = (sp: PlayerSpan) => ({
    off: offensiveGrade(computeOffensiveTalent(sp), computeUncappedOffensiveTalent(sp)),
    def: defensiveGrade(computeDefensiveTalent(sp)),
    tp: spacingUngraded(sp) ? '—' : spacingGrade(computeSpacing(sp), sp),
    dur: durabilityGrade(computeDurability(sp)),
  });

  const asideTop = (
    <>
      <Mast title={title} daily={!!dailyTitle} sub={state.complete ? 'Draft done · set your rotation' : `${dailyTitle ? `${dailyTitle} · ` : ''}Round ${round} of ${ROUNDS} · pick ${overall} of ${totalPicks}`} />
      <Tally you={fmtCaps(humanBudget.capLeft)} mid={fmtCaps(capLimit)} ai={`${Math.min(humanTeam.roster.length + (state.complete ? 0 : 1), ROSTER_SIZE)}/${ROSTER_SIZE}`} youK="Caps left" aiK="Round" />
      <CapBar used={used} cap={capLimit} />
    </>
  );

  // The years view (from the list or the team): one player's stretches.
  const [yearsFor, setYearsFor] = useState<{ name: string; from: 'draft' | 'team' } | null>(null);
  useEffect(() => setYearsFor((y) => (y?.from === 'draft' ? null : y)), [state.history.length]);
  useEffect(() => {
    if (yearsFor) window.scrollTo({ top: 0 });
  }, [yearsFor]);
  const [rotStatus, setRotStatus] = useState<{ valid: boolean; reason?: string }>({ valid: false });
  const submitRef = useRef<(() => void) | null>(null);

  const dialogs = (
    <>
      {settingsOpen && <NightSettings onClose={() => setSettingsOpen(false)} />}
      {confirmExit && (
        <NightConfirm
          title="Leave the draft?"
          lead={
            state.dailyDay ? (
              <>Today’s draft is saved. Pick it up again from the menu; it is still your one try.</>
            ) : (
              <>
                Your draft is saved. Pick it up again from the menu with <b style={{ color: 'var(--ink)' }}>Continue</b>.
              </>
            )
          }
          yes="Keep drafting"
          no="Back to menu"
          onYes={closeExitDialog}
          onNo={onExit}
        />
      )}
      {helpOpen && (
        <NightHowTo
          lead={`All-Time Draft · ${state.teams.length} teams, ${ROUNDS} rounds, one player a round. ${scoutsLeft} of ${SCOUT_REPORTS_PER_DRAFT} scouting reports left.`}
          rules={howToPlay.map((r) => [r.title, r.body] as [string, ReactNode])}
          onClose={closeHelp}
        />
      )}
      {callSheetOpen && youOnClock && (
        <CallSheet
          options={callOptions(state, state.seed, callLog)}
          left={callsLeft}
          pickLabel={`Round ${round} · pick ${callPickNo + 1}`}
          onCall={placeDeskCall}
          onClose={() => setCallSheetOpen(false)}
        />
      )}
      {activeCall && (
        <CallWindow
          result={activeCall.result}
          callNumber={activeCall.number}
          starred={(name) => bigBoard.includes(name)}
          onToggleStar={toggleBigBoard}
          onStarAll={(players) => saveBigBoard([...bigBoard, ...players.map((pl) => pl.playerName).filter((n) => !bigBoard.includes(n))])}
          onClose={() => setActiveCall(null)}
        />
      )}
      {peekPlayer &&
        (() => {
          const group = groups.find((g) => g.playerName === peekPlayer) ?? enrichedGroups.find((g) => g.playerName === peekPlayer);
          if (!group) return null;
          return (
            <PlayerPeekModal
              group={group}
              cardSpanId={cardSpanFor(group).id}
              state={state}
              canPick={canPick}
              currentTeam={currentTeam}
              onClose={() => setPeekPlayer(null)}
              onPick={(id) => {
                onPick(id);
                setPeekPlayer(null);
              }}
              scouted={scoutedPlayers.has(group.playerName)}
              scoutsLeft={scoutsLeft}
              onScout={() => scoutPlayer(group.playerName)}
            />
          );
        })()}
    </>
  );

  /* ---------------- the Team view ---------------- */
  const teamCapUsed = totalFga(displayFgas);
  const startersSet = STARTER_SLOTS.filter((sl) => humanAssignment[sl]).length;
  const canSubmit = state.complete && !chosenRosterOverCap && rotStatus.valid;
  const slotOf = (p: PlayerSpan) => STARTER_SLOTS.find((sl) => humanAssignment[sl]?.id === p.id) ?? 'bench';
  const teamYears = yearsFor?.from === 'team' ? humanSpanOptionsByKey.get(normalizePlayerName(yearsFor.name)) : undefined;
  const rotation = (
    <section className="tm-rot" style={activeTab === 'team' && !teamYears ? undefined : { display: 'none' }}>
      {humanTeam.roster.length === 0 ? (
        <EmptyNote>The rotation opens with your first pick. Set minutes as you go.</EmptyNote>
      ) : (
        <RotationBuilder
          roster={chosenHumanRoster}
          rosterComplete={draftComplete}
          seedStrategy="basic"
          persistKey={state.commissionerMode ? undefined : draftSaveKeys(saveSlotFor(state)).rotation}
          minMinutes={bombMinimum}
          onConfirm={handleRotationConfirm}
          confirmLabel="Play the season"
          confirmDisabled={!state.complete || chosenRosterOverCap}
          confirmDisabledHint={
            !state.complete
              ? `Finish drafting all ${ROSTER_SIZE} picks first.`
              : chosenRosterOverCap
                ? `Your chosen years cost ${chosenRosterFga.toFixed(1)} caps, over the ${capLimit} cap. Pick cheaper years in the roster.`
                : undefined
          }
          submitRef={submitRef}
          onStatus={setRotStatus}
          showSubmit={false}
        />
      )}
    </section>
  );

  if (activeTab === 'team') {
    const aside = (
      <>
        <Mast title={title} daily={!!dailyTitle} sub={state.complete ? 'Draft done · set your rotation' : `Round ${round} of ${ROUNDS} · pick ${overall} of ${totalPicks}`} />
        <Tally you={fmtCaps(capLimit - teamCapUsed)} mid={fmtCaps(capLimit)} ai={`${humanTeam.roster.length}/${ROSTER_SIZE}`} youK="Caps left" aiK="Picks" />
        <CapBar used={teamCapUsed} cap={capLimit} />
        <SubNote>
          <b>{fmtCaps(teamCapUsed)} caps</b> used of {fmtCaps(capLimit)}
          {chosenRosterOverCap && ' · over the cap'}
        </SubNote>
        <section>
          <H3>Before the season</H3>
          <Kv k="Rotation" v={rotStatus.valid ? 'Set' : 'Not set'} />
          <Kv k="Starters" v={startersSet === STARTER_SLOTS.length ? 'Set' : `${startersSet} of 5`} />
          <Kv k="Years" v="Click to change" />
        </section>
        <Actions links={links}>
          <Btn disabled={!canSubmit} title={!state.complete ? `Finish drafting all ${ROSTER_SIZE} picks first.` : chosenRosterOverCap ? 'Over the cap: pick cheaper years.' : rotStatus.reason} onClick={() => submitRef.current?.()}>
            Play the season
          </Btn>
          {!state.complete && (
            <Btn kind="line" onClick={() => setActiveTab('draft')}>
              Back to the draft
            </Btn>
          )}
        </Actions>
      </>
    );
    let main: ReactNode;
    if (teamYears) {
      const current = chosenHumanRoster.find((pl) => normalizePlayerName(pl.playerName) === teamYears.key) ?? teamYears.draftedSpan;
      const options = [...yearsAllowedToday(teamYears, current.id)].sort((x, y) => x.spanLabel.localeCompare(y.spanLabel));
      const peakId = [...options].sort((x, y) => effectiveTalent(y) - effectiveTalent(x))[0]?.id;
      const scouted = scoutedPlayers.has(teamYears.playerName);
      main = (
        <>
          <div className="prompt">
            <span className="eb">Your team · his years</span>
            <div className="who-head">
              <NFace name={teamYears.playerName} />
              <div>
                <h2>{maskName(teamYears.playerName)}</h2>
                <p>Which years does he play for you? Cheaper years free caps for the rest.</p>
              </div>
            </div>
          </div>
          <section>
            <H3 note={`${options.length} stretches`}>His stretches</H3>
            <StretchTable
              rows={options.map((o) => {
                const g = gradesOf(o);
                return {
                  span: o,
                  tier: displayedOverallTier(o),
                  grades: scouted ? `${g.off} · ${g.def}` : null,
                  peak: o.id === peakId,
                  current: o.id === current.id,
                  action:
                    o.id === current.id
                      ? null
                      : { label: 'Use', disabled: false, onClick: () => setHumanSpan(teamYears.key, o.id, teamYears.playerName, teamYears.options) },
                };
              })}
            />
            <div style={{ maxWidth: 320, marginTop: 16 }}>
              <Btn onClick={() => setYearsFor(null)}>Done</Btn>
            </div>
          </section>
        </>
      );
    } else {
      main = (
        <>
          <Prompt eb="Your team" title={teamLabel(humanTeam)}>
            {state.complete
              ? `Nine players, 240 minutes. Change anyone’s years in the table; cheaper years free caps.`
              : `${humanTeam.roster.length} of ${ROSTER_SIZE} drafted. Set minutes as you go; the season opens when all nine are in.`}
          </Prompt>
          {chosenRosterOverCap && (
            <Notice>
              <b>Over the cap.</b> Your years cost {fmtCaps(chosenRosterFga)} caps, the cap is {fmtCaps(capLimit)}. Pick cheaper years for someone.
            </Notice>
          )}
          <section>
            <H3 note="off · def · 3pt · durability">Roster</H3>
            <table className="plist roster">
              <colgroup>
                <col style={{ width: 44 }} />
                <col style={{ width: 64 }} />
                <col style={{ width: 52 }} />
                <col />
                <col className="c-hide" style={{ width: 130 }} />
                <col className="c-hide" style={{ width: 58 }} />
                <col className="c-hide" style={{ width: 58 }} />
                <col className="c-hide" style={{ width: 58 }} />
                <col className="c-hide" style={{ width: 58 }} />
                <col style={{ width: 84 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Rd</th>
                  <th>Slot</th>
                  <th />
                  <th>Player · years</th>
                  <th className="c-hide">Tier</th>
                  <th className="num c-hide">Off</th>
                  <th className="num c-hide">Def</th>
                  <th className="num c-hide">3PT</th>
                  <th className="num c-hide">Dur</th>
                  <th className="num">Caps</th>
                </tr>
              </thead>
              <tbody>
                {humanTeam.roster.map((pl, i) => {
                  const spanOpt = humanSpanOptionsByKey.get(normalizePlayerName(pl.playerName));
                  const eff = spanOpt ? (spanOpt.options.find((o) => o.id === (humanSpanSelection[spanOpt.key] ?? spanOpt.draftedSpan.id)) ?? pl) : pl;
                  const sl = slotOf(pl);
                  const masked = isBombMasked(pl.playerName);
                  const g = gradesOf(eff);
                  return (
                    <tr key={normalizePlayerName(pl.playerName)}>
                      <td className="rd">R{i + 1}</td>
                      <td className={`sl${sl === 'bench' ? ' bn' : ''}`}>{sl}</td>
                      <td className="f">
                        <NFace name={pl.playerName} />
                      </td>
                      <td>
                        <div className="nm">{masked ? BOMB_NAME : pl.playerName}</div>
                        <div className="mt">
                          {masked ? (
                            <i>Revealed on the results · plays {BOMB_MIN_MINUTES}+ min</i>
                          ) : spanOpt && spanOpt.options.length > 1 ? (
                            <button type="button" className="yrs-btn" onClick={() => setYearsFor({ name: pl.playerName, from: 'team' })}>
                              {eff.spanLabel}
                              <small>▾ change</small>
                            </button>
                          ) : (
                            <span className="yrs-plain">{eff.spanLabel}</span>
                          )}
                        </div>
                      </td>
                      <td className="tier c-hide">{masked ? '?' : displayedOverallTier(eff)}</td>
                      <td className="num c-hide">{masked ? '' : g.off}</td>
                      <td className="num c-hide">{masked ? '' : g.def}</td>
                      <td className="num c-hide">{masked ? '' : g.tp}</td>
                      <td className="num c-hide">{masked ? '' : g.dur}</td>
                      <td className="cap num">{fmtCaps(eff.fga)}</td>
                    </tr>
                  );
                })}
                {humanUpcoming.slice(0, ROSTER_SIZE - humanTeam.roster.length).map((u, k) => {
                  const r = humanTeam.roster.length + k + 1;
                  const bombHere = bombSpan && !bombLanded && state.bomb?.round === r;
                  return (
                    <tr key={u.pick} className="open">
                      <td className="rd">R{r}</td>
                      <td className="sl bn">—</td>
                      <td className="f">{bombHere ? <span className="ini">?</span> : null}</td>
                      <td>
                        <div className="nm" style={{ color: 'var(--ink3)' }}>
                          {bombHere ? BOMB_NAME : `Pick #${u.pick}`}
                        </div>
                        {bombHere && <div className="mt">his caps are set aside</div>}
                      </td>
                      <td className="c-hide" />
                      <td className="c-hide" />
                      <td className="c-hide" />
                      <td className="c-hide" />
                      <td className="c-hide" />
                      {bombHere ? <td className="cap num">{fmtCaps(bombSpan.fga)}</td> : <td />}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      );
    }
    return (
      <NightGame aside={aside} overlay={dialogs}>
        {main}
        {rotation}
        {!teamYears && (
          <div className="btn2 phone-only">
            <Btn disabled={!canSubmit} onClick={() => submitRef.current?.()}>
              Play the season
            </Btn>
            {!state.complete && (
              <Btn kind="line" onClick={() => setActiveTab('draft')}>
                Back to the draft
              </Btn>
            )}
          </div>
        )}
      </NightGame>
    );
  }

  /* ---------------- the Draft view ---------------- */
  const bbEntries = bigBoard.map((name) => {
    const live = bigBoardEntries.find((e) => e.name === name);
    return { name, live, taken: live ? undefined : takenAt(name) };
  });
  const aside = (
    <>
      {asideTop}
      <SubNote>
        {humanBudget.slotsLeft > 0 ? (
          <>
            <b>{fmtCaps(humanBudget.capLeft)} caps</b> for {spotWord(humanBudget.slotsLeft)} · about {fmtCaps(humanBudget.capLeft / humanBudget.slotsLeft)} a pick
          </>
        ) : (
          <>
            <b>{fmtCaps(used)} caps</b> used of {fmtCaps(capLimit)}
          </>
        )}
      </SubNote>
      <section>
        <H3 note="starred">Your Big Board</H3>
        {bbEntries.length === 0 ? (
          <EmptyNote>Star players in the list to keep them here.</EmptyNote>
        ) : (
          <ol className="bboard">
            {bbEntries.map((e) => (
              <li key={e.name} className={e.live ? undefined : 'gone'}>
                <button type="button" className="bb-n" onClick={() => setPeekPlayer(e.name)} disabled={!e.live}>
                  {maskName(e.name)}
                </button>
                <span>{e.live ? fmtCaps(e.live.span.fga) : e.taken ? `taken #${e.taken}` : 'gone'}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      {logRows.length > 0 && <PickLog rows={logRows} title="Latest picks" note="around the league" newestFirst />}
      <Actions links={links}>
        {state.complete ? (
          <Btn onClick={() => setActiveTab('team')}>Go to your team</Btn>
        ) : (
          <>
            <Btn kind="line" onClick={() => setBoardShown((v) => !v)}>
              {boardShown ? 'Hide draft board' : 'Show draft board'}
            </Btn>
            <PhoneChip left={callsLeft} live={youOnClock && callsLeft >= 0} onOpen={() => setCallSheetOpen(true)} />
            <Btn kind="line" onClick={() => setActiveTab('team')}>
              Team · {humanTeam.roster.length}/{ROSTER_SIZE}
            </Btn>
          </>
        )}
      </Actions>
    </>
  );

  const board = (
    <BoardGrid teams={state.teams} rounds={ROUNDS} picks={pickSpans} onClock={state.complete ? null : overall} round={state.round} codeOf={codeOf} onHide={() => setBoardShown(false)} />
  );
  const yearsGroup = yearsFor?.from === 'draft' ? (groups.find((g) => g.playerName === yearsFor.name) ?? enrichedGroups.find((g) => g.playerName === yearsFor.name)) : undefined;

  let main: ReactNode;
  if (yearsGroup) {
    const best = shownBest(yearsGroup);
    const spans = [...yearsGroup.spans].sort((x, y) => x.spanLabel.localeCompare(y.spanLabel));
    const scouted = scoutedPlayers.has(yearsGroup.playerName);
    const cheapest = spans.filter((sp) => canPick && isPickLegal(state, sp.id)).sort((x, y) => x.fga - y.fga)[0];
    main = (
      <>
        <div className="prompt">
          <span className={`eb${youOnClock ? ' now' : ''}`}>{youOnClock ? `On the clock · Round ${round} · Pick ${overall}` : `Pick ${overall} · ${teamLabel(currentTeam)} on the clock`}</span>
          <div className="who-head">
            <NFace name={yearsGroup.playerName} />
            <div>
              <h2>{maskName(yearsGroup.playerName)}</h2>
              <p>Which years? The same player costs less in his cheaper stretches.</p>
            </div>
          </div>
        </div>
        <section>
          <H3 note={`${spans.length} in the pool`}>His stretches</H3>
          <StretchTable
            rows={spans.map((sp) => {
              const g = gradesOf(sp);
              const legal = canPick && isPickLegal(state, sp.id);
              return {
                span: sp,
                tier: displayedOverallTier(sp),
                grades: scouted ? `${g.off} · ${g.def}` : null,
                peak: sp.id === best.id,
                action: { label: 'Draft', disabled: !legal, title: draftButtonTitle(state, sp.id, canPick, currentTeam), onClick: () => onPick(sp.id) },
              };
            })}
          />
          {cheapest && cheapest.id !== best.id && best.fga - cheapest.fga >= 0.1 && (
            <p className="empty-note" style={{ marginTop: 12 }}>
              The {cheapest.spanLabel} {lastName(yearsGroup.playerName)} saves <b style={{ color: 'var(--gold)', fontStyle: 'normal' }}>{fmtCaps(best.fga - cheapest.fga)} caps</b> on his best years.
            </p>
          )}
          <div style={{ maxWidth: 320, marginTop: 16 }}>
            <Btn kind="line" onClick={() => setYearsFor(null)}>
              ← Back to the list
            </Btn>
          </div>
        </section>
      </>
    );
  } else {
    const shown = groups.slice(0, visibleCount);
    const rows: NightRow[] = shown.map((group) => {
      const best = shownBest(group);
      const target = canPick && isPickLegal(state, best.id) ? best : cardSpanFor(group);
      const ghost = ghosts.get(normalizePlayerName(group.playerName));
      const ruled = !ghost && !!state.dailyRule && !state.commissionerMode && isDailyRuleBlocked(state, target);
      const legal = !ghost && canPick && isPickLegal(state, target.id);
      const g = scoutedPlayers.has(group.playerName) ? gradesOf(target) : null;
      return {
        key: group.playerName,
        span: target,
        tier: displayedOverallTier(target),
        legal,
        title: draftButtonTitle(state, target.id, canPick, currentTeam, `Draft ${maskName(group.playerName)}`),
        ruleNote: ruled && state.dailyRule ? dailyRuleWords(state.dailyRule).ruleTag : undefined,
        taken: ghost ? `taken #${ghost.pickNumber} · ${ghost.teamCode}` : undefined,
        starred: bigBoard.includes(group.playerName),
        grades: g ? { off: g.off, def: g.def, tp: g.tp } : undefined,
        spans: group.spans.length,
      };
    });
    const hot = rows.find((r) => r.legal);
    if (hot) hot.hot = true;
    const open = STARTER_SLOTS.filter((sl) => !humanAssignment[sl]);
    const openWords = open.length > 1 ? `A ${open.slice(0, -1).join(', a ')} or a ${open[open.length - 1]}` : open.length ? `A ${open[0]}` : null;
    const hotName = hot ? lastName(hot.span.playerName) : null;
    main = (
      <>
        {boardShown && board}
        <NineSlots
          lineup={lineup}
          bench={humanBench}
          benchSlots={ROSTER_SIZE - STARTER_SLOTS.length}
          note={`${humanTeam.roster.length} of ${ROSTER_SIZE} · ${teamLabel(humanTeam)}`}
          sel={on === 'ALL' ? null : on}
          onSlot={(pos) => setTab(pos)}
          emptyLabel={(pos) => (pos === on ? `showing ${counts[pos]} ▾` : 'tap to show')}
        />
        {state.complete ? (
          <Prompt eb="Draft done" title="Your nine are in">
            Set the years and the rotation, then play the season.
          </Prompt>
        ) : youOnClock ? (
          <Prompt eb={`On the clock · Round ${round} · Pick ${overall}`} title="Your pick" now>
            {openWords ? `${openWords} fits best.` : 'Your five is set; this pick is for the bench.'}{' '}
            {hotName && (
              <>
                <b className="w">{hotName}</b> is still on the board. Up to <b>{fmtCaps(humanBudget.maxThisPick)} caps</b> on this one.
              </>
            )}
          </Prompt>
        ) : (
          <Prompt eb={`On the clock · Pick ${overall}`} title={teamLabel(currentTeam)} now>
            {humanPicksAway === 1 ? 'Your pick is next.' : humanPicksAway ? `Your pick in ${humanPicksAway} picks.` : 'Your nine are in.'} The list stays open while they think.
          </Prompt>
        )}
        {state.complete && (
          <div className="btn2" style={{ maxWidth: 360, marginBottom: 24 }}>
            <Btn onClick={() => setActiveTab('team')}>Go to your team</Btn>
          </div>
        )}
        {!state.complete && (
          <section>
            {callLog.warRoomPick === callPickNo && callLog.warRoom && youOnClock && (
              <WarRoomBanner count={callLog.warRoom.length} showAll={warRoomShowAll} onToggle={() => setWarRoomShowAll((v) => !v)} />
            )}
            {canPick && !anyVisibleLegal && (
              <Notice action="Show players that fit" onAction={showAffordable}>
                <b>None of these fit this pick.</b> It can cost up to {fmtCaps(currentBudget.maxThisPick)} caps.
              </Notice>
            )}
            <PosTabs
              counts={counts}
              have={have}
              on={on}
              onPick={setTab}
              search={search}
              onSearch={setSearch}
              extra={
                <span className="pt-more">
                  <span>Role</span>
                  <select aria-label="Role" value={roleFilter ?? ''} onChange={(e) => setRoleFilter(e.target.value || null)}>
                    <option value="">Any</option>
                    {Object.keys(ROLE_FILTERS)
                      .filter(roleFits)
                      .map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                  </select>
                  <span>Sort</span>
                  <select aria-label="Sort" value={boardSort} onChange={(e) => setBoardSort(e.target.value as 'best' | 'value' | 'cheapest' | 'priciest')}>
                    <option value="best">Best first</option>
                    <option value="value">Most for the caps</option>
                    <option value="cheapest">Cheapest first</option>
                    <option value="priciest">Most caps first</option>
                  </select>
                </span>
              }
            />
            <CapsBar
              lo={Number(fgaMin) || 0}
              hi={Number(fgaMax) || CAPS_TOP}
              top={CAPS_TOP}
              maxPick={canPick ? humanBudget.maxThisPick : null}
              onChange={(lo, hi) => {
                setFgaMin(String(lo));
                setFgaMax(String(hi));
              }}
            />
            <PlayerTable rows={rows} variant="alltime" onDraft={(sp) => onPick(sp.id)} onOpen={(name) => setPeekPlayer(name)} onYears={(name) => setYearsFor({ name, from: 'draft' })} onStar={toggleBigBoard} scoutsLeft={scoutsLeft} />
            <div className="more">
              Showing {shown.length} of {totalMatched.toLocaleString('en-US')} players
              {visibleCount < groups.length && (
                <>
                  {' · '}
                  <button type="button" className="lk-inline" onClick={() => setVisibleCount((c) => Math.min(groups.length, c + DRAFT_VISIBLE_STEP))}>
                    See more
                  </button>
                </>
              )}
              {totalMatched > groups.length && visibleCount >= groups.length && ' · search a name to see the rest'} · {scoutsLeft} scouting {scoutsLeft === 1 ? 'report' : 'reports'} left
            </div>
          </section>
        )}
      </>
    );
  }
  return (
    <NightGame aside={aside} overlay={dialogs}>
      {main}
      {rotation}
      {!state.complete && !yearsGroup && (
        <div className="btn2 phone-only">
          <Btn kind="line" onClick={() => setBoardShown((v) => !v)}>
            {boardShown ? 'Hide board' : 'Draft board'}
          </Btn>
          <Btn kind="line" onClick={() => setActiveTab('team')}>
            Team · {humanTeam.roster.length}/{ROSTER_SIZE}
          </Btn>
          {youOnClock && callsLeft > 0 && (
            <Btn kind="line" onClick={() => setCallSheetOpen(true)}>
              Phone the desk · {callsLeft}
            </Btn>
          )}
        </div>
      )}
    </NightGame>
  );
}
