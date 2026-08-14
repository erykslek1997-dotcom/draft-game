import { Fragment, useMemo, useState } from 'react';
import type { PlayerSpan, Position } from '../data/schema';
import { TEAM_COUNT, ROUNDS, currentTeamIndex, availablePlayers, isPickLegal, type DraftState } from '../engine/draft';
import { CAP_LIMIT, capRemaining, totalFga } from '../engine/positions';
import { computeTalent, computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from '../engine/talent';
import { computeOffensivePortability, computeDefensivePortability } from '../engine/portability';
import { computeSpacing, spacingTier, type SpacingTier } from '../engine/spacing';
import { spanEndYears } from '../engine/era';
import { allStarCount } from '../engine/allStarLookup';
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
import { playoffPerformanceBonus, playoffPerformanceTier, type PlayoffPerformanceTier } from '../engine/playoffPerformanceLookup';
import { computeDurability, durabilityTier, type DurabilityTier } from '../engine/durability';
import { careerAveragesFor } from '../engine/careerAverages';
import { isSmallSampleSpan, sampleSizeGames } from '../engine/sampleSize';
import { buildEvidenceReport } from '../engine/evidenceReport';
import { naturalPosition } from '../engine/naturalPosition';
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
    otalUncapped: computeUncappedOffensiveTalent(span),
    dtal: computeDefensiveTalent(span),
    fga: span.fga,
    playerName: span.playerName,
    spanLabel: span.spanLabel,
    // Same real, un-scaled playoff-collapse signal already feeding computeTalent's additive term
    // (talent.ts, via playoffPerformanceBonus) — see grades.ts's own docstring on why the top of
    // the scale needs a tier cap instead of a bigger additive number (softCapTalent absorption).
    playoffCollapse: playoffPerformanceBonus(span),
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

const GRADE_TIER_CLASS: Record<Grade, string> = {
  S: 'at-t6', 'A+': 'at-t6', A: 'at-t5', 'A-': 'at-t5',
  'B+': 'at-t4', B: 'at-t4', 'B-': 'at-t3', 'C+': 'at-t3',
  C: 'at-t2', 'C-': 'at-t2', 'D+': 'at-t1', D: 'at-t1', 'D-': 'at-t1', F: 'at-t1',
};

const TALENT_DOT_CLASS: Record<OverallTier, string> = {
  'Cigarette Butt': 'at-t1', 'Bench Warmer': 'at-t1', 'Role Player': 'at-t2', Starter: 'at-t3',
  'All-star': 'at-t4', 'All-NBA': 'at-t5', MVP: 'at-t6', 'Greatest peak': 'at-t6', GOAT: 'at-t6',
};

const SPACING_DOT_CLASS: Record<SpacingTier, string> = {
  'Non-shooter': 'at-t1', 'Bad shooter': 'at-t2', 'Average shooter': 'at-t3', 'Good shooter': 'at-t4',
  'Great shooter': 'at-t5', 'Walking gravity': 'at-t6', 'Shooting anomaly': 'at-t6',
};

const DURABILITY_DOT_CLASS: Record<DurabilityTier, string> = {
  DNP: 'at-t1', 'Walking Glass': 'at-t1', 'Street Clothes': 'at-t2', 'Load Management': 'at-t3',
  Reliable: 'at-t4', Unbreakable: 'at-t5', Ironman: 'at-t6',
};

const PLAYOFF_DOT_CLASS: Record<PlayoffPerformanceTier, string> = {
  'Bronze Dropper': 'at-t2', 'Bronze Riser': 'at-t2', 'Silver Dropper': 'at-t3', 'Silver Riser': 'at-t3',
  'Gold Dropper': 'at-t4', 'Gold Riser': 'at-t4', 'Platinum Dropper': 'at-t6', 'Platinum Riser': 'at-t6',
};

function AtDot({ tierClass, label }: { tierClass: string; label: string }) {
  return (
    <span className="at-dot-wrap" tabIndex={0} data-tip={label} aria-label={label}>
      <span className={`at-dot ${tierClass}`} />
    </span>
  );
}

function AtGrade({ grade }: { grade: Grade }) {
  return <span className={`at-grade-badge ${GRADE_TIER_CLASS[grade]}`}>{grade}</span>;
}

const TAG_LEGEND: ReadonlyArray<{ name: string; tiers: string[]; text: string }> = [
  { name: 'Talent', tiers: ['at-t1', 'at-t3', 'at-t6'], text: 'Named tiers from Cigarette Butt to GOAT, off the player’s single best-TAL span.' },
  { name: 'Offense / Defense / Portability', tiers: ['at-t1', 'at-t3', 'at-t6'], text: 'Letter grade S–F — S is reserved for the 3 best in the current pool. No named tiers yet, so the real letter still shows.' },
  { name: '3PT', tiers: ['at-t1', 'at-t3', 'at-t6'], text: 'Non-shooter to Walking gravity — real, era-scaled 3-point volume and accuracy.' },
  { name: 'Durability', tiers: ['at-t1', 'at-t3', 'at-t6'], text: 'DNP to Ironman — real share of possible team games actually played in this span.' },
  { name: 'Playoffs', tiers: ['at-t2', 'at-t6'], text: '▲ Riser / ▼ Dropper × Bronze–Platinum — real playoff-vs-regular-season efficiency shift.' },
];

export default function DraftBoard({ state, onPick, mode, pickReactions, onPickReactionChange, pickReasoning, onPickReasoningChange }: Props) {
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
  const [showHistory, setShowHistory] = useState(state.commissionerMode);

  const teamIdx = currentTeamIndex(state);
  const currentTeam = state.teams[teamIdx];
  const pickNumber = state.round * TEAM_COUNT + state.pickInRound + 1;
  const totalPicks = TEAM_COUNT * ROUNDS;

  const available = useMemo(() => availablePlayers(state), [state]);
  const currentFgas = currentTeam.roster.map((p) => p.fga);

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
  const groups = legalGroups
    .map((g) => ({ ...g, spans: fgaFilterActive ? g.spans.filter((s) => s.fga >= fgaMinNum && s.fga <= fgaMaxNum) : g.spans }))
    .filter((g) => g.spans.length > 0)
    .filter((g) => (selectedPosition !== 'ALL' ? careerPosition(g) === selectedPosition : true))
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
      const fgas = g.spans.map((s) => s.fga);
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
      // Player-mode only: real whole-career per-game averages (see careerAverages.ts's own
      // docstring for why these can't just be an average of this player's overlapping spans),
      // used for every PTS/AST/REB/STL/BLK/FG%/3PT% cell shown to the player — both the collapsed
      // row and every row of the expanded span table, so a player's box line reads as one stable
      // identity, not a number that jumps around per span. Falls back to `bestTalentSpan`'s own
      // box line for the ~handful of names the raw extract doesn't match (see the lookup's own
      // null contract) rather than showing nothing.
      const career = showJudgeMetrics ? null : careerAveragesFor(g.playerName);
      // `bestTalentSpan?.box` (not `.box`) is defensive-only, not load-bearing: `bestTalentSpan`
      // is always a real span by construction (the `.filter((g) => g.spans.length > 0)` a few
      // lines up guarantees `g.spans` is non-empty every time this runs), and the fallback object
      // never surfaces in a real render — it exists purely so a genuinely impossible case (an
      // empty group slipping through) renders zeroes instead of crashing the whole Draft tab.
      const displayBox = career
        ? { ppg: career.ppg, rpg: career.rpg, apg: career.apg, spg: career.spg, bpg: career.bpg, fgPct: career.fgPct, threePct: career.threePct }
        : (bestTalentSpan?.box ?? { ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0, fgPct: 0, threePct: 0 });
      return {
        ...g,
        bestTalentSpan,
        spansByAiValue,
        displayBox,
        bestTalent: showJudgeMetrics ? displayTalentForSpan(tierContextFor(bestTalentSpan)) : 0,
        // 2026-08-08, user's v0.2 rating batch: GOAT has no ceiling of its own
        // (`tierCeiling('GOAT')` is `Infinity`), so a GOAT-tier span's `bestTalent` number can
        // land on the exact same value as a merely-Greatest-Peak span (both 98, say) — found
        // via LeBron (GOAT) sorting BELOW Bird (Greatest peak) purely because the tied number
        // fell back to incidental array order. Stored alongside `bestTalent` so the sort below
        // can break that specific tie by tier rank instead.
        bestTier: showJudgeMetrics ? overallTierForSpan(tierContextFor(bestTalentSpan)) : 'Cigarette Butt',
        bestOffensiveTalent: showJudgeMetrics ? Math.max(...g.spans.map(computeOffensiveTalent)) : 0,
        bestOffensiveTalentUncapped: showJudgeMetrics ? Math.max(...g.spans.map(computeUncappedOffensiveTalent)) : 0,
        bestDefensiveTalent: showJudgeMetrics ? Math.max(...g.spans.map(computeDefensiveTalent)) : 0,
        bestOffensivePortability: showJudgeMetrics ? Math.max(...g.spans.map(computeOffensivePortability)) : 0,
        bestDefensivePortability: showJudgeMetrics ? Math.max(...g.spans.map(computeDefensivePortability)) : 0,
        bestSpacing: showJudgeMetrics ? Math.max(...g.spans.map(computeSpacing)) : 0,
        bestDurability: showJudgeMetrics ? Math.max(...g.spans.map(computeDurability)) : 0,
        peakFga: bestTalentSpan.fga,
        lowestFga: Math.min(...fgas),
      };
    })
    .sort((a, b) => {
      if (mode === 'player') {
        const starDiff = allStarCount(b.playerName) - allStarCount(a.playerName);
        if (starDiff !== 0) return starDiff;
        return (randomTiebreak.get(a.playerName) ?? 0) - (randomTiebreak.get(b.playerName) ?? 0);
      }
      return b.bestTalent - a.bestTalent || tierRank(b.bestTier) - tierRank(a.bestTier);
    });

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
      <div className="at-topbar">
        <div className="at-wordmark at-cond">All-Time Draft</div>
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
        <div className="at-status-chip">
          <span className="at-dot-live" />
          Pick <b>{pickNumber}</b> of {totalPicks} — Round <b>{state.round + 1}</b> —{' '}
          {state.commissionerMode
            ? `your pick as ${teamLabel(currentTeam)}`
            : currentTeam.isHuman
              ? 'your pick'
              : `${teamLabel(currentTeam)} picking…`}
          {showJudgeMetrics && (
            <button className="at-legend-toggle" style={{ marginTop: 0, marginLeft: 10 }} onClick={() => setShowHistory((s) => !s)}>
              {showHistory ? 'Hide' : 'Show'} History
            </button>
          )}
        </div>
      </div>

      {/* 2026-08-13, user's own follow-up: Draft History (the pick log + Commissioner Mode
          reasoning boxes / FeedbackToggle) is a calibration/feedback-collection tool, not
          something a player drafting blind needs to see — kept for developer mode only, same
          "player mode only" scoping as the rest of this redesign thread. Nothing about the
          underlying reasoning/reaction capture itself changed; it's just not reachable from the
          player-mode Draft tab anymore. */}
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
          {/* 2026-08-13 follow-up: the "Overview" title + explainer caption removed in player
              mode — the grid itself (all 16 teams × round) stays, just without the label
              clutter. Developer mode keeps both, unchanged. */}
          {showJudgeMetrics && (
            <>
              <h1 className="at-panel-title at-cond">Overview</h1>
              <div className="at-ov-meta">
                {TEAM_COUNT} teams · scroll vertically and horizontally · picks shown in the order they happened, not
                reorganized by position — nothing about an opponent's real roster shape is visible until the draft ends.
              </div>
            </>
          )}
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
                      {teamLabel(team)}
                      {team.isHuman ? ' (You)' : ''}
                    </td>
                    {Array.from({ length: ROUNDS }, (_, r) => {
                      const pick = team.roster[r];
                      if (pick) {
                        return (
                          <td key={r} className="at-pickcell">
                            {pick.playerName}
                            <span className="at-yr">{pick.spanLabel}</span>
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
          {currentTeam.isHuman || state.commissionerMode ? (
            <>
              <div className="at-controls-row">
                <input
                  className="at-search-input"
                  placeholder="Search players…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="at-fga-filter">
                  <label>Filter FGA</label>
                  <input className="at-fga-input" value={fgaMin} onChange={(e) => setFgaMin(e.target.value)} />
                  <input className="at-fga-input" value={fgaMax} onChange={(e) => setFgaMax(e.target.value)} />
                </div>
                <div className="at-cap-label" style={{ marginLeft: 'auto' }}>
                  Cap remaining: <b>{capRemaining(currentFgas)}</b> FGA
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

              <div className="at-table-scroll">
                <table className={`at-draft-table ${!showJudgeMetrics ? 'at-draft-table--player' : ''}`}>
                  {!showJudgeMetrics && (
                    // Fixed column widths, matched pixel-for-pixel against the expanded
                    // span sub-table's own colgroup below (300 here == 180 + 94 + the
                    // sub-table's own 26px indent there) — so a player's PTS/AST/etc. line up
                    // in a visual column whether they're reading this summary row or an
                    // expanded season row, making it obvious at a glance it's the same number
                    // repeated, not a coincidence.
                    <colgroup>
                      <col style={{ width: 300 }} />
                      <col style={{ width: 66 }} />
                      <col style={{ width: 66 }} />
                      <col style={{ width: 66 }} />
                      <col style={{ width: 66 }} />
                      <col style={{ width: 66 }} />
                      <col style={{ width: 66 }} />
                      <col style={{ width: 66 }} />
                      <col style={{ width: 66 }} />
                      <col />
                    </colgroup>
                  )}
                  <thead>
                    <tr>
                      <th>Player</th>
                      {!showJudgeMetrics && <th>PTS</th>}
                      {!showJudgeMetrics && <th>AST</th>}
                      {!showJudgeMetrics && <th>REB</th>}
                      {!showJudgeMetrics && <th>STL</th>}
                      {!showJudgeMetrics && <th>BLK</th>}
                      {!showJudgeMetrics && <th>FG%</th>}
                      {!showJudgeMetrics && <th>3PT%</th>}
                      {!showJudgeMetrics && <th>FGA</th>}
                      {showJudgeMetrics && <th style={{ textAlign: 'center' }}>Talent</th>}
                      {showJudgeMetrics && <th style={{ textAlign: 'center' }}>Offense</th>}
                      {showJudgeMetrics && <th style={{ textAlign: 'center' }}>Defense</th>}
                      {showJudgeMetrics && <th style={{ textAlign: 'center' }}>O-POR</th>}
                      {showJudgeMetrics && <th style={{ textAlign: 'center' }}>D-POR</th>}
                      {showJudgeMetrics && <th style={{ textAlign: 'center' }}>3PT</th>}
                      {showJudgeMetrics && <th style={{ textAlign: 'center' }}>Durability</th>}
                      {showJudgeMetrics && <th style={{ textAlign: 'center' }}>Playoffs</th>}
                      {showJudgeMetrics && <th>Peak FGA</th>}
                      {showJudgeMetrics && <th>Lowest FGA</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => {
                      const isOpen = expanded.has(group.playerName);
                      return (
                        <Fragment key={group.playerName}>
                          <tr onClick={() => toggleExpand(group.playerName)} style={{ cursor: 'pointer' }}>
                            <td className="at-player-cell">
                              <span className={`at-expand-toggle ${isOpen ? 'at-open' : ''}`}>▸</span>{' '}
                              {showJudgeMetrics ? (
                                <>
                                  {group.playerName}
                                  <span className="at-span">
                                    {group.spans.length} season
                                    {group.spans.length > 1 ? 's' : ''}
                                  </span>
                                </>
                              ) : (
                                `${group.playerName} - ${naturalPosition(group.playerName)}`
                              )}
                            </td>
                            {!showJudgeMetrics && <td className="at-fga-num">{group.displayBox.ppg.toFixed(1)}</td>}
                            {!showJudgeMetrics && <td className="at-fga-num">{group.displayBox.apg.toFixed(1)}</td>}
                            {!showJudgeMetrics && <td className="at-fga-num">{group.displayBox.rpg.toFixed(1)}</td>}
                            {!showJudgeMetrics && <td className="at-fga-num">{group.displayBox.spg.toFixed(1)}</td>}
                            {!showJudgeMetrics && <td className="at-fga-num">{group.displayBox.bpg.toFixed(1)}</td>}
                            {!showJudgeMetrics && (
                              <td className="at-fga-num">{(group.displayBox.fgPct * 100).toFixed(1)}%</td>
                            )}
                            {!showJudgeMetrics && (
                              <td className="at-fga-num">{(group.displayBox.threePct * 100).toFixed(1)}%</td>
                            )}
                            {!showJudgeMetrics && <td className="at-fga-num">{group.bestTalentSpan.fga.toFixed(1)}</td>}
                            {showJudgeMetrics && (
                              <td>
                                <AtDot tierClass={TALENT_DOT_CLASS[group.bestTier]} label={`${group.bestTalent} — ${group.bestTier}`} />
                              </td>
                            )}
                            {showJudgeMetrics && (
                              <td>
                                <AtGrade grade={offensiveGrade(group.bestOffensiveTalent, group.bestOffensiveTalentUncapped)} />
                              </td>
                            )}
                            {showJudgeMetrics && (
                              <td>
                                <AtGrade grade={defensiveGrade(group.bestDefensiveTalent)} />
                              </td>
                            )}
                            {showJudgeMetrics && (
                              <td>
                                <AtGrade grade={offensivePortabilityGrade(group.bestOffensivePortability)} />
                              </td>
                            )}
                            {showJudgeMetrics && (
                              <td>
                                <AtGrade grade={defensivePortabilityGrade(group.bestDefensivePortability)} />
                              </td>
                            )}
                            {showJudgeMetrics && (
                              <td>
                                <AtDot tierClass={SPACING_DOT_CLASS[spacingTier(group.bestTalentSpan)]} label={spacingTier(group.bestTalentSpan)} />
                              </td>
                            )}
                            {showJudgeMetrics && (
                              <td>
                                <AtDot
                                  tierClass={DURABILITY_DOT_CLASS[durabilityTier(group.bestTalentSpan)]}
                                  label={`${computeDurability(group.bestTalentSpan)} — ${durabilityTier(group.bestTalentSpan)}`}
                                />
                              </td>
                            )}
                            {showJudgeMetrics && (
                              <td>
                                {playoffPerformanceTier(group.bestTalentSpan) ? (
                                  <AtDot
                                    tierClass={PLAYOFF_DOT_CLASS[playoffPerformanceTier(group.bestTalentSpan)!]}
                                    label={playoffPerformanceTier(group.bestTalentSpan)!}
                                  />
                                ) : (
                                  '—'
                                )}
                              </td>
                            )}
                            {showJudgeMetrics && (
                              <td className="at-fga-num">
                                <b>{group.peakFga.toFixed(1)}</b>
                              </td>
                            )}
                            {showJudgeMetrics && <td className="at-fga-num">{group.lowestFga.toFixed(1)}</td>}
                            <td></td>
                          </tr>
                          {isOpen && showJudgeMetrics && (
                            <tr key={`${group.playerName}-detail`}>
                              <td colSpan={99} style={{ background: 'var(--at-paper)', padding: '4px 10px 14px' }}>
                                <table className="at-span-subtable">
                                  <thead>
                                    <tr>
                                      <th>Span</th>
                                      <th>Pos</th>
                                      <th>FGA</th>
                                      <th>Talent</th>
                                      <th>Off</th>
                                      <th>Def</th>
                                      <th>O-POR</th>
                                      <th>D-POR</th>
                                      <th>3PT</th>
                                      <th>DUR</th>
                                      <th></th>
                                      <th></th>
                                      <th></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.spans.map((span) => (
                                      <tr key={span.id}>
                                        <td className="at-player-cell">{span.spanLabel}</td>
                                        <td>{span.primaryPosition}</td>
                                        <td>{span.fga.toFixed(1)}</td>
                                        <td>
                                          <AtDot
                                            tierClass={TALENT_DOT_CLASS[overallTierForSpan(tierContextFor(span))]}
                                            label={`${displayNumberForSpan(span, tierContextFor(span))} — ${overallTierForSpan(tierContextFor(span))}`}
                                          />
                                        </td>
                                        <td>
                                          <AtGrade grade={offensiveGrade(computeOffensiveTalent(span), computeUncappedOffensiveTalent(span))} />
                                        </td>
                                        <td>
                                          <AtGrade grade={defensiveGrade(computeDefensiveTalent(span))} />
                                        </td>
                                        <td>
                                          <AtGrade grade={offensivePortabilityGrade(computeOffensivePortability(span))} />
                                        </td>
                                        <td>
                                          <AtGrade grade={defensivePortabilityGrade(computeDefensivePortability(span))} />
                                        </td>
                                        <td>
                                          <AtDot tierClass={SPACING_DOT_CLASS[spacingTier(span)]} label={spacingTier(span)} />
                                        </td>
                                        <td>
                                          <AtDot
                                            tierClass={DURABILITY_DOT_CLASS[durabilityTier(span)]}
                                            label={`${computeDurability(span)} — ${durabilityTier(span)}`}
                                          />
                                        </td>
                                        <td>
                                          <SmallSampleBadge span={span} />
                                        </td>
                                        <td>
                                          <button className="at-draft-btn" onClick={() => onPick(span.id)}>
                                            Draft
                                          </button>
                                        </td>
                                        <td>
                                          <button className="at-why-btn" onClick={() => toggleEvidence(span.id)}>
                                            {evidenceOpen.has(span.id) ? 'Hide' : 'Why?'}
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
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
                              </td>
                            </tr>
                          )}
                          {isOpen && !showJudgeMetrics && (() => {
                            // Player mode: box-score-only detail, ranked by the engine's hidden
                            // valuation (`spansByAiValue`) rather than chronologically — shows its
                            // top 3 by default, with a Show more to reveal every remaining season.
                            // No Draft-reasoning ("Why?") panel here at all: nothing about *why*
                            // the engine likes a span is ever surfaced in player mode.
                            const allSpans = group.spansByAiValue;
                            const showingAll = showAllSpans.has(group.playerName);
                            const visibleSpans = showingAll ? allSpans : allSpans.slice(0, 3);
                            return (
                              <tr key={`${group.playerName}-detail`}>
                                <td colSpan={99} style={{ background: 'var(--at-paper)', padding: '4px 10px 14px' }}>
                                  <table className="at-span-subtable at-span-subtable--player">
                                    {/* Widths chosen empirically (measured via getBoundingClientRect,
                                        not calculated from the CSS margin/padding numbers, which
                                        don't cleanly add up) so this table's PTS column starts at the
                                        exact same viewport x as the main table's PTS column above —
                                        see that table's colgroup comment for why these two must
                                        match. Re-measure both if any padding/margin on either table
                                        changes. */}
                                    <colgroup>
                                      <col style={{ width: 170 }} />
                                      <col style={{ width: 94 }} />
                                      <col style={{ width: 66 }} />
                                      <col style={{ width: 66 }} />
                                      <col style={{ width: 66 }} />
                                      <col style={{ width: 66 }} />
                                      <col style={{ width: 66 }} />
                                      <col style={{ width: 66 }} />
                                      <col style={{ width: 66 }} />
                                      <col style={{ width: 66 }} />
                                      {/* Deliberately no width here (unlike every column above) —
                                          when EVERY column has an explicit width and their sum is
                                          less than the table's rendered 100%-of-container width,
                                          browsers scale every column up proportionally to fill the
                                          gap, which silently broke the alignment this colgroup
                                          exists for. Leaving this one flexible lets it alone
                                          absorb the leftover space instead. */}
                                      <col />
                                    </colgroup>
                                    <thead>
                                      <tr>
                                        <th>Span</th>
                                        <th>Pos</th>
                                        <th>PTS</th>
                                        <th>AST</th>
                                        <th>REB</th>
                                        <th>STL</th>
                                        <th>BLK</th>
                                        <th>FG%</th>
                                        <th>3PT%</th>
                                        <th>FGA</th>
                                        <th></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {visibleSpans.map((span) => (
                                        <tr key={span.id}>
                                          <td className="at-player-cell">{span.spanLabel}</td>
                                          <td>{span.primaryPosition}</td>
                                          <td>{group.displayBox.ppg.toFixed(1)}</td>
                                          <td>{group.displayBox.apg.toFixed(1)}</td>
                                          <td>{group.displayBox.rpg.toFixed(1)}</td>
                                          <td>{group.displayBox.spg.toFixed(1)}</td>
                                          <td>{group.displayBox.bpg.toFixed(1)}</td>
                                          <td>{(group.displayBox.fgPct * 100).toFixed(1)}%</td>
                                          <td>{(group.displayBox.threePct * 100).toFixed(1)}%</td>
                                          <td>{span.fga.toFixed(1)}</td>
                                          <td>
                                            <button className="at-draft-btn" onClick={() => onPick(span.id)}>
                                              Draft
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  {allSpans.length > 3 && (
                                    <button
                                      className="at-legend-toggle at-cond"
                                      style={{ marginTop: 8 }}
                                      onClick={() => toggleShowAllSpans(group.playerName)}
                                    >
                                      {showingAll ? 'Show less' : `Show more (${allSpans.length - 3} more)`}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })()}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="at-legend-row">
                <p className="at-caption" style={{ marginTop: 0 }}>
                  {showJudgeMetrics
                    ? "Peak FGA = cost of this player's highest-Talent season. Lowest FGA = his cheapest available season in the pool right now, independent of talent. Click a row to see every available season and draft one."
                    : 'Click a row to see his top seasons and draft one. Show more reveals every season available in the pool right now.'}
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
          ) : (
            <div className="at-placeholder">{teamLabel(currentTeam)} is thinking…</div>
          )}
        </div>
      )}

      {activeTab === 'team' && (
        <div className="at-card" style={{ marginBottom: 16 }}>
          <h1 className="at-panel-title at-cond">Team</h1>
          <div className="at-cap-meter">
            <span className="at-cap-label">
              <b>{totalFga(currentFgas).toFixed(1)}</b> / {CAP_LIMIT} FGA
            </span>
            <div className="at-cap-track">
              <div className="at-cap-fill" style={{ width: `${Math.min(100, (totalFga(currentFgas) / CAP_LIMIT) * 100)}%` }} />
            </div>
            <span className="at-cap-label">
              {currentTeam.roster.length} / 9 picked
            </span>
          </div>
          {currentTeam.roster.length === 0 ? (
            <div className="at-placeholder">No picks yet — head to the Draft tab.</div>
          ) : (
            <table className="at-roster-table">
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Player</th>
                  <th>Span</th>
                  <th>FGA</th>
                </tr>
              </thead>
              <tbody>
                {currentTeam.roster.map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <span className="pos-pill">{p.primaryPosition}</span> R{i + 1}
                    </td>
                    <td>{p.playerName}</td>
                    <td>{p.spanLabel}</td>
                    <td className="at-fga-num">{p.fga.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="at-caption">Final starter/bench slotting and per-player minutes are set after the draft ends.</p>
        </div>
      )}

      {activeTab === 'team' && (
        <div className="at-card">
          <h1 className="at-panel-title at-cond">Rotation</h1>
          <div className="at-placeholder">
            Rotation opens once the draft ends and you've picked your final 9 spans — you'll set minutes for every slot
            there, same as today's post-draft step.
          </div>
        </div>
      )}
    </div>
  );
}
