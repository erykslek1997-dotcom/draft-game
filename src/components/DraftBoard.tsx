import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { TEAM_COUNT, ROUNDS, currentTeamIndex, isPickLegal, pickBlockReason, pickBudget, type DraftState } from '../engine/draft';
import { CAP_LIMIT, ROSTER_SIZE, capRemaining, totalFga, STARTER_SLOTS } from '../engine/positions';
import { computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { effectiveTalent, displayTalentForSpan } from '../engine/grades';
import { computeOffensivePortability, computeDefensivePortability } from '../engine/portability';
import { computeSpacing, spacingTier, type SpacingTier } from '../engine/spacing';
import { spanEndYears } from '../engine/era';
import { allStarCount } from '../engine/allStarLookup';
import { spanOptionsFor } from '../engine/spanOptimizer';
import RotationBuilder from './RotationBuilder';
import type { Rotation, Team } from '../engine/types';
import { Face, ShotChip, shortenName } from './ShotChip';
import { bestPrimaryAssignment } from '../engine/rotation';
import {
  offensiveGrade,
  defensiveGrade,
  offensivePortabilityGrade,
  defensivePortabilityGrade,
  spacingGrade,
  durabilityGrade,
  overallTierForSpan,
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
import { AiSpeedControl, BoardToggleButton, DraftTicker, LeaveDraftDialog, TurnBudgetText } from './DraftChrome';
import { DRAFT_ROTATION_KEY } from '../draftSaveSummary';

/** Max player rows the Draft tab renders at once. The list is tier-sorted, so this is the top-N
 * players; anyone past it is reachable via search or a position filter (both land well under the
 * cap). Rendering all ~720 as expandable accordion rows was ~11s per keystroke. */
const DRAFT_LIST_LIMIT = 140;
/** 2026-09-14, user-reported live: how many of those (already-capped) rows actually show at once
 * before "See more" is needed — a separate, much smaller number purely for not overwhelming the
 * player with a wall of cards, independent of `DRAFT_LIST_LIMIT`'s own performance reasoning. */
const DRAFT_VISIBLE_DEFAULT = 30;
const DRAFT_VISIBLE_STEP = 30;

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
  /** 2026-09-24: CPU pick pacing control (owned by GameShell, which runs the AI-turn timer). */
  aiSpeedLabels: readonly string[];
  aiSpeedIndex: number;
  onAiSpeedChange: (index: number) => void;
  /** 2026-09-24: back to the main menu (after a confirm — the draft is autosaved, see draftSave.ts). */
  onExit: () => void;
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
const TIER_FRAME_COLOR: Record<DisplayOverallTier, string> = {
  'Salary Glue': '#82b5ea',
  'Cigarette Butt': '#b3b0a8',
  'Bench Warmer': '#f0a868',
  'Role Player': '#e8d461',
  'Sixth Man': '#c1440e',
  Starter: '#7fd68a',
  'All-star': '#6fd9e6',
  'All-NBA': '#8b9bf7',
  MVP: '#ec8ecb',
  'Greatest peak': '#ffdc9b',
  // 2026-09-24: was '#ffd479', a near-twin of Greatest peak's gold right above it — the two top
  // rungs were indistinguishable on the card frames and the tier key. Platinum reads as "above
  // gold" without colliding with any other tier's hue.
  GOAT: '#f2f4f8',
};

/** Best-first order for the Draft tab's tier colour key. */
const TIER_KEY_ORDER: DisplayOverallTier[] = [
  'GOAT',
  'Greatest peak',
  'MVP',
  'All-NBA',
  'All-star',
  'Starter',
  'Sixth Man',
  'Role Player',
  'Bench Warmer',
  'Cigarette Butt',
  'Salary Glue',
];

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

/** Tooltip for a Draft button — says WHY a pick is blocked instead of one generic "over the cap"
 * line, since since 2026-09-24 a pick can also be blocked for leaving too little for the rest of
 * the roster (`pickBlockReason`'s 'reserve'), not only for busting the cap outright. */
function draftButtonTitle(state: DraftState, spanId: string, canPick: boolean, currentTeam: Team, label?: string): string | undefined {
  if (!canPick) return `${teamLabel(currentTeam)} is picking…`;
  const reason = pickBlockReason(state, spanId);
  if (reason === 'cap') return 'Over the shots cap — pick a cheaper player, or a cheaper season for this one.';
  if (reason === 'reserve') {
    const budget = pickBudget(state);
    return `Too expensive right now — you need to keep ${budget.reserved} shots for your other ${budget.slotsLeft - 1} pick${budget.slotsLeft - 1 === 1 ? '' : 's'}. Max for this pick: ${budget.maxThisPick} shots.`;
  }
  return label;
}

/** 2026-09-11, user-reported live ("modal zamiast obecnego rozwijania karty") — the magnifying
 * glass on a player face-card opens this instead of expanding the card in place: every available
 * season with real box-score stats and its own Draft button, the same content the card's earlier
 * inline expand showed, just with room to show all of it at once instead of a "Show more" toggle. */
function PlayerPeekModal({
  group,
  state,
  canPick,
  currentTeam,
  onClose,
  onPick,
}: {
  group: { playerName: string; spans: PlayerSpan[]; spansByAiValue: PlayerSpan[] };
  state: DraftState;
  canPick: boolean;
  currentTeam: Team;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="player-peek-overlay" onClick={onClose}>
      <div
        className="player-peek-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${group.playerName} — seasons`}
      >
        <button type="button" className="player-peek-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <div className="player-peek-head">
          <Face name={group.playerName} size="md" />
          <div>
            <h2 className="player-peek-name">{group.playerName}</h2>
            <span className="player-peek-sub">
              {naturalPosition(group.playerName)} · {group.spans.length} season{group.spans.length > 1 ? 's' : ''} available
            </span>
          </div>
        </div>
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
                <th />
              </tr>
            </thead>
            <tbody>
              {group.spansByAiValue.map((span) => {
                const ctx = tierContextFor(span);
                const legal = canPick && isPickLegal(state, span.id);
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
                    <td>
                      <button
                        type="button"
                        className="at-draft-btn"
                        disabled={!legal}
                        title={draftButtonTitle(state, span.id, canPick, currentTeam)}
                        onClick={() => onPick(span.id)}
                      >
                        Draft
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
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
function gradeColor(grade: Grade): string {
  const t = GRADE_RANK[grade] / 13; // 0 (F, worst) .. 1 (S, best)
  const hue = 2 + t * 146; // 2 = red, 148 = green, same endpoints MatchupMatrix's own diverging scale uses
  const saturation = 42 + Math.abs(t - 0.5) * 34; // most saturated at both extremes, muted mid-pack
  const lightness = 30 + t * 9;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

// Exported (2026-08-19) for RotationBuilder's own reuse — see that file's own docstring on why
// the Team/Rotation screen now shows the same Offense/Defense letter grades this badge already
// renders on the Draft tab, instead of building a second, slightly-different badge from scratch.
export function AtGrade({ grade }: { grade: Grade }) {
  return (
    <span className="at-grade-badge" style={{ background: gradeColor(grade), color: '#fff' }}>
      {grade}
    </span>
  );
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
  { name: '3PT (SPC)', tiers: ['at-t1', 'at-t3', 'at-t6'], text: "How much this player's outside shooting forces a defense to respect the perimeter — real, era-scaled 3-point volume and accuracy. Same S–F letter-grade scale." },
  { name: 'Durability (DUR)', tiers: ['at-t1', 'at-t3', 'at-t6'], text: "Real share of possible team games actually played in this span. Same S–F letter-grade scale." },
  // 2026-08-19, user's explicit ask ("hide playoffs and make everything in one line"): the
  // Playoffs entry used to sit alone on its own short second row (5 cards fit one row, the 6th
  // wrapped) — dropped so the remaining 5 fit one line cleanly, per the same ask. The actual
  // Playoffs badge/column elsewhere in this file (the ▲/▼ riser/dropper tag) is untouched — this
  // only removes its glossary entry.
];

// 2026-09-14, user-reported live ("za dużo tego na desktopie... połączmy wszystko w jeden ekran"):
// on a genuinely wide screen (now that `#root` itself spans the full viewport instead of a boxed
// ~1126px card — see index.css's own comment on that removal), the Draft/Team split left a huge
// blank column next to the "Your Five" sidebar while the actual Team roster + Rotation minutes
// still needed a separate tab click. This hook is what lets DraftBoard's render below switch, at
// runtime, into showing the Draft workspace and the Team column side by side instead of picking
// one via `activeTab` — see the `at-merge-row` wrapper further down for how it's used. A real
// `matchMedia` listener (not just a one-time check) so resizing the actual browser window flips
// the layout live, matching how every other responsive rule in this file already behaves via CSS
// alone; this one just also needs to gate which panels are MOUNTED, which CSS alone can't do for
// JSX that isn't in the DOM at all when its tab isn't active.
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
// Threshold picked wide enough that a normal 1280-1440px laptop still gets the familiar single-
// panel tabbed view (Team's roster table + Rotation's own `.rotation-builder` card both want real
// room — see their own CSS max-widths — a half-share of anything narrower would cramp both), while
// an actual wide desktop monitor gets the merged two-column layout the user asked for.
const WIDE_LAYOUT_QUERY = '(min-width: 1600px)';
/** Must match the `max-width: 860px` rule in App.css that stacks `.at-draft-workspace`. */
const STACKED_LAYOUT_QUERY = '(max-width: 860px)';
const BOARD_OPEN_STORAGE_KEY = 'draftverse.boardOpen';
const RECENT_PICKS_SHOWN = 4;

export default function DraftBoard({
  state,
  onPick,
  mode,
  pickReactions,
  onPickReactionChange,
  pickReasoning,
  onPickReasoningChange,
  onSubmitTeam,
  onSwapHumanSpan,
  aiSpeedLabels,
  aiSpeedIndex,
  onAiSpeedChange,
  onExit,
}: Props) {
  const showJudgeMetrics = mode === 'developer';
  const [search, setSearch] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<Position | 'ALL'>('ALL');
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
  }, [search, selectedPosition]);
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 2026-09-11, user-reported live ("modal zamiast obecnego rozwijania karty") — the magnifying
  // glass on a player face-card now opens a modal instead of expanding the card in place. A
  // single name (not a Set like `expanded`, which developer mode's own accordion still uses
  // unchanged) — only one card can be peeked at a time.
  const [peekPlayer, setPeekPlayer] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState<Set<string>>(new Set());
  // 2026-09-12, user-reported live (mobile screenshot: all 9 round columns squeezed to fit,
  // wrapping names onto 2-4 lines each) — real horizontal scroll (restored below, mobile-only)
  // replaces that squeeze, but scroll on a table isn't always obvious as a possibility on a
  // touch device with no visible scrollbar. These two buttons are a plainly-tappable affordance
  // for it (mobile-only, see `.at-grid-scroll-nav`'s own CSS) — `scrollBy` already clamps at
  // both ends, so no separate "can I still scroll further" state is needed.
  const gridScrollRef = useRef<HTMLDivElement>(null);
  function scrollGrid(direction: 1 | -1) {
    gridScrollRef.current?.scrollBy({ left: direction * 280, behavior: 'smooth' });
  }
  const [activeTab, setActiveTab] = useState<AtTab>('draft');
  const isWideLayout = useMediaQuery(WIDE_LAYOUT_QUERY);
  const [showLegend, setShowLegend] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [boardOpen, setBoardOpen] = useState(() => {
    try {
      return window.localStorage.getItem(BOARD_OPEN_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  function toggleBoard() {
    setBoardOpen((open) => {
      try {
        window.localStorage.setItem(BOARD_OPEN_STORAGE_KEY, open ? '0' : '1');
      } catch {
        // Not remembered — still toggles for this session.
      }
      return !open;
    });
  }
  // 2026-09-24: below the stacked-layout breakpoint the "Your Team" card sits between the board and
  // the player cards — collapsed there to a one-line summary so your own turn opens on players.
  const isStackedLayout = useMediaQuery(STACKED_LAYOUT_QUERY);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeExitDialog = useCallback(() => setConfirmExit(false), []);
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
      if (totalFga(wouldBeRoster.map((p) => p.fga)) <= CAP_LIMIT) {
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
        setSpanVersion((v) => v + 1);
        return;
      }
    }
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
  const needBiasActive = selectedPosition === 'ALL' && !search && humanTeam.roster.length >= 3 && openStarterPositions.size > 0;

  const { groups, totalMatched } = useMemo(() => {
    const q = search.toLowerCase();
    const matched = enrichedGroups
      .filter((g) => !state.draftedIds.has(g.spans[0].id))
      .filter((g) => (selectedPosition !== 'ALL' ? careerPosition(g) === selectedPosition : true))
      .filter((g) => g.playerName.toLowerCase().includes(q))
      .sort((a, b) => {
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
  }, [enrichedGroups, state.draftedIds, selectedPosition, search, mode, needBiasActive, openStarterPositions]);

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

  // Ticker data (see the collapsed-board JSX): the latest few picks, and how many picks until the
  // human is up again (snake order, so it varies round to round).
  const recentPicks = useMemo(() => {
    const spanById = new Map<string, PlayerSpan>();
    for (const t of state.teams) for (const p of t.roster) spanById.set(p.id, p);
    return state.history
      .slice(-RECENT_PICKS_SHOWN)
      .reverse()
      .map((h) => {
        const team = state.teams.find((t) => t.id === h.teamId);
        return {
          pickNumber: h.pickNumber,
          teamCode: teamCodeByTeamId.get(h.teamId) ?? '',
          isHuman: Boolean(team?.isHuman),
          shortName: shortPlayerName(spanById.get(h.playerId)?.playerName ?? '—'),
        };
      });
  }, [state.history, state.teams, teamCodeByTeamId]);
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

  // 2026-09-24: budget for whoever is on the clock (the human outside Commissioner Mode) — drives
  // the "Your pick" banner, the stuck-board notice below it and the sidebar's own budget line.
  const currentBudget = useMemo(() => pickBudget(state), [state]);
  const anyVisibleLegal = useMemo(
    () =>
      !canPick ||
      groups.slice(0, visibleCount).some((g) => g.spans.some((s) => isPickLegal(state, s.id))),
    [canPick, groups, visibleCount, state],
  );
  function showAffordable() {
    setSearch('');
    setSelectedPosition('ALL');
    setFgaMin('0');
    setFgaMax(String(Math.floor(currentBudget.maxThisPick * 10) / 10));
  }

  const TABS: ReadonlyArray<{ id: AtTab; label: string }> = [
    { id: 'draft', label: 'Draft' },
    { id: 'team', label: 'Team' },
  ];

  return (
    <div className="at-shell">
      {/* 2026-08-16, user's own ask: sits above the whole board on its own row, not squeezed into
          the topbar next to the tabs/status chip. */}
      <button type="button" className="at-menu-btn at-cond" onClick={() => setConfirmExit(true)}>
        ← Menu
      </button>
      {confirmExit && (
        <LeaveDraftDialog
          text={
            state.commissionerMode
              ? 'This draft is not saved — leaving ends it.'
              : 'Your draft is saved. You can pick it up again from the main menu with “Continue draft”.'
          }
          onStay={closeExitDialog}
          onLeave={onExit}
        />
      )}
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
        {!state.complete && <AiSpeedControl labels={aiSpeedLabels} index={aiSpeedIndex} onChange={onAiSpeedChange} />}
        {(isWideLayout || activeTab === 'draft') && <BoardToggleButton open={boardOpen} onToggle={toggleBoard} />}
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
          {/* 2026-09-24: the full 16-team × 9-round board used to open the Draft tab — a whole
              laptop screen (and several phone screens) before the first player card. It now
              starts collapsed to a one-line ticker (who's on the clock, the latest picks, when
              you pick next); the full board is one click away and the choice is remembered. */}
          <DraftTicker
            youOnClock={canPick && currentTeam.isHuman}
            complete={state.complete}
            onClockLabel={teamLabel(currentTeam)}
            picksAway={humanPicksAway}
            recentPicks={recentPicks}
          />
          {boardOpen && (
            <>
          <div className="at-grid-scroll-nav">
            <button type="button" className="at-grid-scroll-btn" onClick={() => scrollGrid(-1)} aria-label="Scroll rounds left">
              ‹
            </button>
            <span className="at-grid-scroll-hint">Swipe or tap to see more rounds</span>
            <button type="button" className="at-grid-scroll-btn" onClick={() => scrollGrid(1)} aria-label="Scroll rounds right">
              ›
            </button>
          </div>
          <div className="at-grid-scroll" ref={gridScrollRef}>
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
            </>
          )}
        </div>
      )}

      {/* 2026-09-14, user-reported live: wraps the Draft workspace card together with the Team
          column below so `.at-merge-row`'s own CSS (App.css) can lay them out side by side once
          `isWideLayout` is true — narrow/default screens get `display: block` from that same rule,
          so this wrapper is otherwise invisible to the existing single-column tabbed flow. */}
      <div className="at-merge-row">
      {(isWideLayout || activeTab === 'draft') && (
        <div className="at-card at-merge-draft">
          <h1 className="at-panel-title at-cond">Draft</h1>
          {/* 2026-08-16, user's own ask: a CPU turn used to hide this whole panel behind a full
              "X is thinking…" placeholder — the player list is browsable at all times now
              instead, with just this small notice (not a block) while it's not your turn. The
              actual Draft buttons below are `disabled` via `canPick`, not hidden, so browsing/
              searching/expanding a row to look at a player works identically either way. */}
          <div className="at-turn-sticky">
            {!canPick ? (
              <div className="at-cpu-turn-banner">{teamLabel(currentTeam)} is picking…</div>
            ) : (
              // 2026-09-24: the only "your turn" signal used to be the CPU banner above silently
              // disappearing (plus the "on the clock" cell in the board, usually scrolled out of
              // view) — and nothing on screen said how much of the cap this pick could actually use.
              <div className="at-your-turn-banner" role="status">
                <span className="at-your-turn-title at-cond">Your pick</span>
                <TurnBudgetText
                  round={state.round + 1}
                  rounds={ROUNDS}
                  capLeft={currentBudget.capLeft}
                  slotsLeft={currentBudget.slotsLeft}
                  maxThisPick={currentBudget.maxThisPick}
                />
              </div>
            )}
            {canPick && !anyVisibleLegal && (
              <div className="at-budget-notice">
                <span>None of the players shown fit this pick — max {currentBudget.maxThisPick} shots.</span>
                <button type="button" className="at-budget-notice-btn at-cond" onClick={showAffordable}>
                  Show players that fit
                </button>
              </div>
            )}
          </div>
          {/* 2026-09-11, user's own inspiration screenshot: Draft + Team merged into one screen —
              player cards on the left, a persistent "Your Five" sidebar on the right (replaces
              the draft-order pip strip this had for one round of live-testing — that was a step
              toward this same request, now superseded by the real thing). See `humanAssignment`'s
              own comment above for what's deliberately still out of scope this pass (span-swap,
              full rotation-minute editing — still on the Team tab). */}
          <div className="at-draft-workspace">
          <div className="at-draft-main">
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
              {/* 2026-09-24: the card frames' tier colours had no key anywhere on the Draft tab —
                  only a per-card hover title. Compact, always-visible strip, best tier first. */}
              {!showJudgeMetrics && (
                <div className="at-tier-key" aria-label="Card frame colours by tier">
                  <span className="at-tier-key-label at-cond">Tiers</span>
                  {TIER_KEY_ORDER.map((tier) => (
                    <span key={tier} className="at-tier-key-item">
                      <span className="at-tier-key-swatch" style={{ background: TIER_FRAME_COLOR[tier] }} aria-hidden />
                      {tier}
                    </span>
                  ))}
                </div>
              )}

              {/* 2026-09-01: the Draft-tab player list is the same expandable-list shape as the
                  Cap Sheet (`.player-group` accordion + `.span-table`), condensed to match it —
                  minimal header (name · position · seasons · best tier · FGA/TAL on the right),
                  plain-text stat cells, only the tier is a pill. FGA columns and the draft
                  mechanic (`onPick`/`isPickLegal`/`canPick`, best-span pick in player mode,
                  per-span pick + Why? in developer mode) are unchanged. `.player-group*` /
                  `.span-table` read the plain `--bg`/`--border`/`--accent` names, which `.at-shell`
                  aliases to its dark board values, so it renders on the board palette; the
                  `.at-draft-groups` block in App.css only tightens spacing/typography. */}
              {showJudgeMetrics && (
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
                            title={draftButtonTitle(state, group.bestTalentSpan.id, canPick, currentTeam)}
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
                                        title={draftButtonTitle(state, span.id, canPick, currentTeam)}
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

                    </div>
                  );
                })}
              </div>
              )}

              {/* 2026-09-11, user's own inspiration screenshot: face cards instead of an
                  accordion list. Follow-up ask ("modal zamiast obecnego rozwijania karty"): the
                  magnifying glass opens a modal (`PlayerPeekModal` below) instead of expanding the
                  card in place — more room for the same `spansByAiValue` season list plus real box
                  stats, without the grid's row heights jumping around per-card. An arrow still
                  drafts the best season immediately, no modal needed for the common case. Player
                  mode only — developer/tester mode keeps the dense table above unchanged. */}
              {!showJudgeMetrics && (
                <div className="at-player-cards">
                  {groups.slice(0, visibleCount).map((group) => {
                    const best = group.bestTalentSpan;
                    const bestLegal = canPick && isPickLegal(state, best.id);
                    // 2026-09-12, user-reported live (Andris Biedriņš, a real 0.9-shot span on the
                    // board with only ~1.7 shots of cap left — "nie mogę wybrać... mimo że ma span
                    // 0.9 fga"): this card's own headline span is always `bestTalentSpan` — the
                    // player's single highest-TAL season — with no fallback, so a role player whose
                    // BEST season happens to cost more than the remaining cap showed a permanently
                    // disabled arrow even when one of his OTHER seasons (a cheaper seasons list
                    // every role player like this keeps, per `leanDraftPool.ts`) was perfectly
                    // affordable. The 🔍 modal always had a per-season Draft button that already
                    // worked around this — but the card's own "arrow drafts the best season
                    // immediately, no modal needed" promise silently broke exactly when it mattered
                    // most (a tight cap). Falls back to the best-TAL-among-actually-affordable
                    // season only when the headline one isn't legal, so ordinary drafting is
                    // completely unchanged.
                    // 2026-09-12, code-review fix: was `group.spansByAiValue.find(...)` — that
                    // list is only TAL-sorted in player mode; in developer mode it's deliberately
                    // chronological instead (see `spansByAiValue`'s own docstring), which would
                    // have picked the first affordable season by date rather than by value. This
                    // whole card grid only ever renders when `!showJudgeMetrics` (player mode), so
                    // that mismatch was never actually reachable here — `spansByTal` (always real
                    // value order, computed alongside `spansByAiValue`) is the correct source
                    // either way and removes the landmine if that gating ever changes.
                    const target = bestLegal ? best : group.spansByTal.find((s) => canPick && isPickLegal(state, s.id)) ?? best;
                    const legal = canPick && isPickLegal(state, target.id);
                    const tierFrameColor = TIER_FRAME_COLOR[displayedOverallTier(target)];
                    return (
                      <div
                        className="at-player-card"
                        key={group.playerName}
                        style={{ '--tier-frame': tierFrameColor } as CSSProperties}
                      >
                        <span className="at-player-card-corner" title={displayedOverallTier(target)} aria-hidden />
                        {/* 2026-09-12, code-review finding: the tier used to be a text badge in
                            this card's own accessibility tree; moving it to a colored border/
                            corner (this same session, "wariant A") dropped that entirely — the
                            corner is aria-hidden and its `title` is a mouse-hover-only affordance,
                            so a screen-reader, keyboard-only, or touch user got no tier signal at
                            all. Same information, visually hidden instead of removed: sighted
                            mouse users still read the tier from color/hover exactly as before. */}
                        <span className="at-sr-only">{displayedOverallTier(target)} tier</span>
                        <div className="at-player-card-top">
                          <Face name={group.playerName} size="md" />
                          <ShotChip fga={target.fga} cap={CAP_LIMIT} />
                        </div>
                        {/* 2026-09-24: name and position used to share one `nowrap` + ellipsis
                            line, so any position pair (or a merely long surname) got cut to
                            "Stephen Curry – …". The name now gets its own line (wrapping up to two)
                            and the position sits on a meta line with the card's TAL — the one
                            number that says how good this season is, next to the colour frame that
                            only says which tier it lands in. */}
                        <span className="at-player-card-name" title={group.playerName}>
                          {shortenName(group.playerName, 18)}
                        </span>
                        <span className="at-player-card-meta">
                          <span className="at-player-card-pos">{naturalPosition(group.playerName)}</span>
                          <span className="at-player-card-tal" title="Talent rating of the season this card drafts">
                            TAL <b>{displayTalentForSpan(tierContextFor(target))}</b>
                          </span>
                        </span>
                        {/* 2026-09-24, user-reported live ("dużo wolnego miejsca które można
                            wykorzystać"): the season's own headline box line, the same numbers the
                            Scouting report opens with — the card had the room, and it's the first
                            thing a player checks before a pick. */}
                        <span className="at-player-card-season">{target.spanLabel} season</span>
                        <span className="at-player-card-stats">
                          <span><b>{target.box.ppg.toFixed(1)}</b>PTS</span>
                          <span><b>{target.box.rpg.toFixed(1)}</b>REB</span>
                          <span><b>{target.box.apg.toFixed(1)}</b>AST</span>
                        </span>
                        <div className="at-player-card-foot">
                          <span className="at-player-card-actions">
                            <button
                              type="button"
                              className="at-player-card-peek"
                              title={`${group.spans.length} season${group.spans.length > 1 ? 's' : ''} available`}
                              onClick={() => setPeekPlayer(group.playerName)}
                            >
                              Scouting
                            </button>
                            <button
                              type="button"
                              className="at-player-card-draft"
                              disabled={!legal}
                              title={draftButtonTitle(state, target.id, canPick, currentTeam, `Draft ${group.playerName}`)}
                              onClick={() => onPick(target.id)}
                            >
                              Draft
                            </button>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {peekPlayer && (() => {
                const group = groups.find((g) => g.playerName === peekPlayer);
                if (!group) return null;
                return (
                  <PlayerPeekModal
                    group={group}
                    state={state}
                    canPick={canPick}
                    currentTeam={currentTeam}
                    onClose={() => setPeekPlayer(null)}
                    onPick={(id) => {
                      onPick(id);
                      setPeekPlayer(null);
                    }}
                  />
                );
              })()}

              {/* 2026-09-14, user-reported live: the primary fix for "too many names at once" —
                  `groups` itself can already hold up to `DRAFT_LIST_LIMIT` (140, a render-
                  performance cap, see its own docstring), but only `visibleCount` of them are
                  actually rendered above. Player mode only, same gate as the card grid itself
                  (`visibleCount` isn't read by developer mode's own accordion list). */}
              {!showJudgeMetrics && visibleCount < groups.length && (
                <button
                  type="button"
                  className="at-legend-toggle"
                  style={{ marginBottom: 4 }}
                  onClick={() => setVisibleCount((c) => Math.min(groups.length, c + DRAFT_VISIBLE_STEP))}
                >
                  See {Math.min(DRAFT_VISIBLE_STEP, groups.length - visibleCount)} more (
                  {groups.length - visibleCount} left)
                </button>
              )}
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
                    : 'Draft picks his best season. Tap Scouting report to compare his other seasons — you can still switch to a different one afterward, in the Team tab.'}
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
          </div>

          {/* 2026-09-11, user's own inspiration screenshot: a persistent "Your Five" sidebar next
              to the player cards — position-organized (same `bestPrimaryAssignment` search the
              Rotation cards use), read-only here on purpose. Span-swap and rotation-minute editing
              stay on the Team tab this pass — see `humanAssignment`'s own comment for the full
              scoping reasoning.
              2026-09-14, user-reported live ("na desktopie można usunąć your five jeśli obok jest
              zakładka team"): at `isWideLayout` the Team column already sits right beside this one
              (`.at-merge-row`, App.css) with the same roster identity AND the same cap-remaining
              meter (its own `.at-cap-meter`) — this whole card is a pure duplicate there, not a
              second read of different information, so it's dropped entirely on wide screens rather
              than just trimmed. Narrow/tab-mode keeps it exactly as before: the Team tab isn't
              simultaneously visible there, so this is the only roster glance available while
              browsing the player pool. */}
          {!isWideLayout && (
          <aside className="at-draft-sidebar">
            {isStackedLayout ? (
              <button
                type="button"
                className="at-draft-sidebar-head at-draft-sidebar-head--toggle"
                aria-expanded={sidebarOpen}
                onClick={() => setSidebarOpen((o) => !o)}
              >
                <h2 className="at-cond">Your Team</h2>
                <span className="at-draft-sidebar-count">
                  {humanTeam.roster.length}/{ROSTER_SIZE} · {capRemaining(currentFgas)} shots left {sidebarOpen ? '▴' : '▾'}
                </span>
              </button>
            ) : (
              <div className="at-draft-sidebar-head">
                <h2 className="at-cond">Your Team</h2>
                <span className="at-draft-sidebar-count">{humanTeam.roster.length}/{ROSTER_SIZE}</span>
              </div>
            )}
            {(!isStackedLayout || sidebarOpen) && (
            <>
            {/* 2026-09-12, user-reported live ("nie wypełnia się" + "można dać to w kolumnie
                'your team'"): this used to live as a 90px sliver in the Draft tab's controls row,
                squeezed between the search box and the position filters — real fill %, but too
                thin and too far from "your team" to read as belonging to it. Moved into the Your
                Five sidebar itself and given the sidebar's full width, so the same real number
                (`currentFgas`, the enforced roster — never the Team tab's preview-only
                `chosenHumanRoster`) is finally wide enough to actually look like it's filling. */}
            <div className="at-draft-sidebar-cap-wrap">
              <div className="at-cap-track at-draft-sidebar-cap">
                <span
                  className="at-cap-fill"
                  style={{ width: `${Math.min(100, (totalFga(currentFgas) / CAP_LIMIT) * 100)}%` }}
                />
              </div>
              <p className="at-draft-sidebar-cap-label">
                Cap remaining: <b>{capRemaining(currentFgas)}</b> shots
              </p>
              {canPick && currentBudget.slotsLeft > 1 && (
                <p className="at-draft-sidebar-cap-label">
                  About <b>{(currentBudget.capLeft / currentBudget.slotsLeft).toFixed(1)}</b> per remaining pick
                </p>
              )}
            </div>
            <div className="at-draft-sidebar-slots">
              {STARTER_SLOTS.map((slot) => {
                const p = humanAssignment[slot];
                return p ? (
                  <div className="at-sidebar-slot at-sidebar-slot--filled" key={slot} title={p.playerName}>
                    <span className="at-sidebar-slot-pos at-cond">{slot}</span>
                    <Face name={p.playerName} />
                    <span className="at-sidebar-slot-name">{shortenName(p.playerName)}</span>
                    <ShotChip fga={p.fga} cap={CAP_LIMIT} />
                  </div>
                ) : (
                  <div className="at-sidebar-slot" key={slot}>
                    <span className="at-sidebar-slot-pos at-cond">{slot}</span>
                    <span className="bf-face bf-face--sm bf-face--empty" aria-hidden />
                    <span className="at-sidebar-slot-empty">Open</span>
                  </div>
                );
              })}
            </div>
            {(() => {
              const seatedIds = new Set(
                Object.values(humanAssignment)
                  .filter((p): p is PlayerSpan => Boolean(p))
                  .map((p) => p.id),
              );
              // 2026-09-12, code-review fix: matches `humanAssignment` above — real roster, not
              // the span-swap preview, so this card's bench list can never disagree with its own
              // cap-remaining number.
              const overflow = humanTeam.roster.filter((p) => !seatedIds.has(p.id));
              return overflow.length > 0 ? (
                <div className="at-draft-sidebar-bench">
                  <span className="at-draft-sidebar-bench-label">Bench</span>
                  {overflow.map((p) => (
                    <div className="at-sidebar-slot at-sidebar-slot--filled" key={p.id} title={p.playerName}>
                      <Face name={p.playerName} />
                      <span className="at-sidebar-slot-name">{shortenName(p.playerName)}</span>
                      <ShotChip fga={p.fga} cap={CAP_LIMIT} />
                    </div>
                  ))}
                </div>
              ) : null;
            })()}
            {/* 2026-09-14: this whole aside only ever renders when `!isWideLayout` now (see its
                own opening condition above), so the "Team tab" jump link below is always pointing
                at a real, separate click target — no longer needs its own redundant `isWideLayout`
                check now that the parent already gates it. */}
            <p className="at-draft-sidebar-hint">
              Span swaps and rotation minutes live on the{' '}
              <button type="button" className="at-inline-link" onClick={() => setActiveTab('team')}>
                Team tab
              </button>
              .
            </p>
            </>
            )}
          </aside>
          )}
        </div>
        </div>
      )}

      {/* 2026-09-14, user-reported live: closes the Draft-card `if`/opens the Team column that
          sits beside it — the Team roster table and the always-mounted Rotation card below both
          move inside this one wrapper so `.at-merge-row`'s flex layout (App.css) treats "Draft" and
          "Team + Rotation" as its two side-by-side items on a wide screen; on a narrow one this is
          just an unstyled div and everything still stacks exactly as it did before this pass. */}
      <div className="at-merge-team-col">
      {(isWideLayout || activeTab === 'team') && (
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
            <div className="at-placeholder">
              {/* 2026-09-14, user-reported live: at `isWideLayout` this panel sits right next to
                  the Draft column with no separate tab to "head to" any more — see the top of this
                  file's own `isWideLayout` docstring. */}
              {isWideLayout ? 'No picks yet — draft your first player on the left.' : 'No picks yet — head to the Draft tab.'}
            </div>
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
                      2026-08-19 follow-up, same ask extended to Spacing/Durability.
                      2026-09-14, user-reported live ("niech wszystko będzie w skali S-F"): SPC/DUR
                      switched from the named-text `SpacingTierBadge`/`DurabilityTierBadge` pills to
                      the same `AtGrade` S-F letter every other column here already uses — see
                      `spacingGrade`/`durabilityGrade` in grades.ts for the two different
                      calibration stories behind that. `SpacingTierBadge`/`DurabilityTierBadge`
                      themselves are untouched exports, not deleted (`DraftPoolBrowser.tsx` on the
                      `catch-up-2026-08-14` branch still uses them), but this was their last call
                      site on `player-skeleton` — the TAG_LEGEND entries below were updated to match
                      what's actually on screen here now instead of describing a named-tier scale
                      nothing on this branch still shows. */}
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
                      <td>
                        {/* 2026-09-14, user-reported live ("niech wszystko będzie w skali S-F i
                            wtedy zrobimy miejsce na facecardy"): SPC/DUR moving off wide named-text
                            badges onto the same compact `AtGrade` pill every other column already
                            uses (below) freed real width in this row — spent here, on the same
                            `Face` avatar the Draft tab's own cards/sidebar/Rotation rows already
                            use, so a roster of names isn't the only unillustrated table in the app. */}
                        <span className="at-roster-player-cell">
                          <Face name={p.playerName} />
                          {p.playerName}
                        </span>
                      </td>
                      <td>
                        {spanOpt ? (
                          <select
                            className="at-span-picker-select"
                            value={effective.id}
                            onChange={(e) => setHumanSpan(spanOpt.key, e.target.value, spanOpt.playerName, spanOpt.options)}
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
                        <AtGrade grade={spacingGrade(computeSpacing(effective), effective)} />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <AtGrade grade={durabilityGrade(computeDurability(effective))} />
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
              ? `You drafted the player, not a specific era — the Span dropdown above picks which career window to actually roster. A cheaper season frees shots for the rest of the draft; a pricier one is fine as long as the whole roster stays under ${CAP_LIMIT} shots when you submit. Rotation minutes are set below.`
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
      {/* 2026-09-12, user-reported live ("jak coś wrzucę w rotation i wydraftuje następnego gracza
          to wszystko się usuwa"): this whole card used to be gated the same `{activeTab === 'team'
          && (...)}` way every other tab section here is — which UNMOUNTS `RotationBuilder`
          entirely the moment you leave the Team tab, and remounts it fresh (empty rows again) the
          moment you come back. That's not a `key`/remount-timing bug (the actual `key={spanVersion}`
          fix above addresses a real, separate 9th-pick discontinuity) — you cannot even DRAFT the
          next player without leaving this tab, so every single "set some minutes, draft, come
          back" cycle hit it. Always rendered now; `display: none` hides it instead of unmounting
          it, so `RotationBuilder`'s own `rows` state survives every tab switch untouched.
          2026-09-14: `isWideLayout` added to this same condition — on a wide screen this card sits
          permanently visible in the merged Team column (see `.at-merge-team-col` above), same
          "mounted, just hidden" shape this already used for the tab case. */}
      <div className="at-card" style={(isWideLayout || activeTab === 'team') ? undefined : { display: 'none' }}>
          <h1 className="at-panel-title at-cond">Rotation</h1>
          {humanTeam.roster.length === 0 ? (
            <div className="at-placeholder">
              Opens as soon as you make your first pick — set spans (in the Team table above) and
              minutes here as you go, no need to wait for the draft to end.
            </div>
          ) : (
            <>
              <RotationBuilder
                // 2026-09-12, user-reported live ("jak coś wrzucę w rotation i wydraftuje
                // następnego gracza to wszystko się usuwa"): this used to also remount on
                // `draftComplete` flipping false->true, so the moment the human's 9th (final) pick
                // landed, any minutes the user had already set by hand while the roster was still
                // incomplete were silently thrown away for a fresh `autoAssignRotation` seed — the
                // exact opposite of the "set minutes manually if you'd like ... as you go" promise
                // this same screen makes below.
                // 2026-09-16, user-reported live ("ciągnie gracza za rączkę i ustawia z automatu
                // najlepszy line-up, brak myślenia po stronie gracza"): the "Auto-fill (best fit)"
                // button this comment used to describe is gone entirely (RotationBuilder.tsx) —
                // setting the rotation is meant to be a real decision, not a one-click optimum.
                // `rosterComplete` still matters here, though: `buildInitialRows` (that file's own
                // helper) reads it to keep the INITIAL seed empty until the roster is actually
                // full, rather than auto-assigning a still-growing roster sensibly-but-wrongly.
                key={spanVersion}
                roster={chosenHumanRoster}
                rosterComplete={draftComplete}
                seedStrategy="basic"
                persistKey={state.commissionerMode ? undefined : DRAFT_ROTATION_KEY}
                onConfirm={handleRotationConfirm}
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
      </div>
      </div>
    </div>
  );
}
