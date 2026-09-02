import type { PlayerSpan, Position } from '../data/schema';
import { POSITIONS, normalizePlayerName } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { spanEndYears } from './era';
import {
  effectiveTalent,
  displayNumberForSpan,
  overallTierForSpan,
  tierRank,
  offensiveGrade,
  defensiveGrade,
  offensivePortabilityGrade,
  defensivePortabilityGrade,
  type OverallTier,
  type Grade,
} from './grades';
import { tierContextWithSixthMan } from './sixthMan';
import {
  computeOffensiveTalent,
  computeUncappedOffensiveTalent,
  computeDefensiveTalent,
  rawUncappedTalent,
} from './talent';
import { computeOffensivePortability, computeDefensivePortability } from './portability';
import { computeSpacing, spacingTier, type SpacingTier } from './spacing';
import { computeDurability, durabilityTier, type DurabilityTier } from './durability';
import { playoffPerformanceTier, type PlayoffPerformanceTier } from './playoffPerformanceLookup';
import { buildEvidenceReport, type EvidenceReport } from './evidenceReport';
import { careerAveragesFor, type CareerAverageRow } from './careerAverages';
import { naturalPosition } from './naturalPosition';
import { allStarCount } from './allStarLookup';
import { getHeightInches, getBodyWeightLbs } from '../data/heightLookup';
import { athleticismScoreForSpan } from './athleticismLookup';

/**
 * "Card collection" — the data side of the player-card gallery (see `components/CardGallery.tsx`).
 * One card per real player; the card reveals the FULL per-span breakdown the game normally hides
 * in player mode (every judge metric, tier, the "why this rating" evidence) plus what
 * biographical data has a runtime accessor (height / weight / athleticism / All-Star count /
 * career line).
 *
 * Cosmetic only — nothing here gates a player in any mode. Rarity is a pure function of the
 * player's best overall tier. Acquisition / persistence / dust-craft all need a backend and are
 * not in this file.
 *
 * Deliberately imports NOTHING from `components/` — `groupByPlayer` is inlined so the gallery
 * chunk never pulls the heavy `DraftBoard.tsx` module, and every engine import is a stable
 * exported function.
 */

export type Rarity = 'legendary' | 'epic' | 'rare' | 'uncommon' | 'common';

export function rarityForTier(tier: OverallTier): Rarity {
  switch (tier) {
    case 'GOAT':
    case 'Greatest peak':
      return 'legendary';
    case 'MVP':
      return 'epic';
    case 'All-NBA':
      return 'rare';
    case 'All-star':
      return 'uncommon';
    default:
      return 'common';
  }
}

export const RARITY_ORDER: Rarity[] = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
export const RARITY_LABEL: Record<Rarity, string> = {
  legendary: 'Legendary',
  epic: 'Epic',
  rare: 'Rare',
  uncommon: 'Uncommon',
  common: 'Common',
};

// --- grouping (inlined, not from DraftBoard) -------------------------------

interface PlayerGroup {
  name: string;
  spans: PlayerSpan[];
}

let groupsCache: PlayerGroup[] | null = null;
function playerGroups(): PlayerGroup[] {
  if (groupsCache) return groupsCache;
  const map = new Map<string, PlayerSpan[]>();
  for (const s of draftPool) {
    const arr = map.get(s.playerName);
    if (arr) arr.push(s);
    else map.set(s.playerName, [s]);
  }
  groupsCache = [...map.entries()].map(([name, spans]) => ({
    name,
    spans: [...spans].sort((a, b) => a.spanLabel.localeCompare(b.spanLabel)),
  }));
  return groupsCache;
}

/**
 * The span the card leads with: the highest displayed `effectiveTalent`, ties broken by
 * `rawUncappedTalent`. At the top of the scale the soft cap compresses a whole cluster of a
 * star's prime spans into the same displayed 96-99, so `effectiveTalent` alone ties constantly
 * and the old `>` reduce just kept whichever span came first chronologically (Michael Jordan's
 * 1986-88 over the strictly-better 1987-89; Larry Bird's 1983-85 over 1984-86). The pre-cap
 * `rawUncappedTalent` keeps the real internal spread, so the tie resolves to the span the engine
 * actually rates highest. Both are display-only reads — nothing else in the app ranks on either.
 * `scripts/validatePeakSpan.ts` measures this against consensus peak windows.
 */
function bestSpan(spans: PlayerSpan[]): PlayerSpan {
  return spans.reduce(
    (b, s) =>
      effectiveTalent(s) > effectiveTalent(b) ||
      (effectiveTalent(s) === effectiveTalent(b) && rawUncappedTalent(s) > rawUncappedTalent(b))
        ? s
        : b,
    spans[0],
  );
}

/**
 * Per-player override for the span the *card* leads with — NOT the player's rarity or best tier
 * (those stay on `bestSpan`, the engine's real peak read).
 *
 * `computeTalent` is box-score-driven, so for a handful of stars it rates an early, activity-heavy
 * statistical peak above the season basketball consensus (and Ben Taylor's impact metrics) calls
 * their actual best — LeBron's 2008-10 Cleveland run (simultaneous career highs in volume,
 * relative efficiency, assists, steals AND blocks) over any Miami span; young Barkley's
 * uncorroborated steal/block volume; Chris Paul's steals-and-DARKO 2013-15 over the 2008 near-MVP
 * peak. See `scripts/validatePeakSpan.ts`. Decompressing the soft cap was tested and rejected — it
 * only widens the gap (the raw internal order already has 2008-10 well ahead) and breaks the
 * Taylor top-10 anchor (0.891 -> 0.818). This map is the deliberately narrow bridge: it moves only
 * which span the card opens on, for the specific (player) the validation flags, until a real
 * raw-value pass (synergy taper + PF position-correction relief + a perimeter defensive-box-
 * activity cap) lands. Same shape as `grades.ts`'s `NAMED_*` maps.
 */
const NAMED_LEAD_SPAN: ReadonlyMap<string, string> = new Map(
  [
    { name: 'LeBron James', spanLabel: '2012-14' }, // Miami peak, not the 2008-10 Cleveland box peak
    { name: 'Chris Paul', spanLabel: '2007-09' }, //   2008 near-MVP, not steals-and-DARKO 2013-15
    { name: 'Charles Barkley', spanLabel: '1989-91' }, // athletic peak, not young uncorroborated box
    { name: 'Tracy McGrady', spanLabel: '2001-03' }, //  Orlando scoring peak
    { name: 'Allen Iverson', spanLabel: '2000-02' }, //  2001 MVP season
    // Kobe / Karl Malone / Dirk are also flagged by validatePeakSpan, but their whole TAL curve is
    // skewed (Dirk's peak is named-downcapped; Malone's 1993-95 bestSpan is itself defensible) —
    // an override there would just paper over a raw-value problem. Left for the raw-value pass.
  ].map((e) => [normalizePlayerName(e.name), e.spanLabel] as const),
);

/** The span the card opens on: the `NAMED_LEAD_SPAN` override when it names a real span for this
 * player, otherwise `bestSpan`. */
function leadSpan(name: string, spans: PlayerSpan[]): PlayerSpan {
  const wanted = NAMED_LEAD_SPAN.get(normalizePlayerName(name));
  return (wanted && spans.find((s) => s.spanLabel === wanted)) || bestSpan(spans);
}

function careerPosition(spans: PlayerSpan[]): Position {
  const counts = new Map<Position, number>();
  for (const s of spans) counts.set(s.primaryPosition, (counts.get(s.primaryPosition) ?? 0) + 1);
  return POSITIONS.reduce((best, p) => ((counts.get(p) ?? 0) > (counts.get(best) ?? 0) ? p : best), POSITIONS[0]);
}

function spanRange(spans: PlayerSpan[]): string {
  const start = parseInt(spans[0].spanLabel.slice(0, 4), 10);
  const endYears = spanEndYears(spans[spans.length - 1].spanLabel);
  const end = endYears.length ? endYears[endYears.length - 1] : start + 1;
  return start === end ? String(start) : `${start}–${end}`;
}

// --- gallery grid (cheap — no per-span metric/evidence work) ---------------

export interface GalleryEntry {
  name: string;
  naturalPos: string;
  careerPos: Position;
  bestTier: OverallTier;
  rarity: Rarity;
  allStar: number;
}

let galleryCache: GalleryEntry[] | null = null;
export function galleryEntries(): GalleryEntry[] {
  if (galleryCache) return galleryCache;
  galleryCache = playerGroups()
    .map((g) => {
      const bs = bestSpan(g.spans);
      const bestTier = overallTierForSpan(tierContextWithSixthMan(bs));
      return {
        name: g.name,
        naturalPos: naturalPosition(g.name),
        careerPos: careerPosition(g.spans),
        bestTier,
        rarity: rarityForTier(bestTier),
        allStar: allStarCount(g.name),
      };
    })
    .sort((a, b) => tierRank(b.bestTier) - tierRank(a.bestTier) || b.allStar - a.allStar || a.name.localeCompare(b.name));
  return galleryCache;
}

// --- full card (heavy — only built when a card is opened) -----------------

export interface CardSpanRow {
  span: PlayerSpan;
  tal: number | string;
  tier: OverallTier;
  oGrade: Grade;
  dGrade: Grade;
  oporGrade: Grade;
  dporGrade: Grade;
  spacing: number;
  spacingTier: SpacingTier;
  durability: number;
  durabilityTier: DurabilityTier;
  playoffTier: PlayoffPerformanceTier | null;
  archetype: string;
  role: string;
  evidence: EvidenceReport;
}

export interface PlayerCardData {
  name: string;
  naturalPos: string;
  spanRange: string;
  bestTier: OverallTier;
  rarity: Rarity;
  allStar: number;
  heightIn: number | null;
  weightLbs: number | null;
  athleticism: number | null;
  career: CareerAverageRow | null;
  rows: CardSpanRow[];
}

function cardSpanRow(span: PlayerSpan): CardSpanRow {
  const ctx = tierContextWithSixthMan(span);
  return {
    span,
    tal: displayNumberForSpan(span, ctx),
    tier: overallTierForSpan(ctx),
    oGrade: offensiveGrade(computeOffensiveTalent(span), computeUncappedOffensiveTalent(span)),
    dGrade: defensiveGrade(computeDefensiveTalent(span)),
    oporGrade: offensivePortabilityGrade(computeOffensivePortability(span)),
    dporGrade: defensivePortabilityGrade(computeDefensivePortability(span)),
    spacing: computeSpacing(span),
    spacingTier: spacingTier(span),
    durability: computeDurability(span),
    durabilityTier: durabilityTier(span),
    playoffTier: playoffPerformanceTier(span),
    archetype: span.offensiveArchetype,
    role: span.defensiveRole,
    evidence: buildEvidenceReport(span),
  };
}

export function buildPlayerCard(name: string): PlayerCardData | null {
  const group = playerGroups().find((g) => g.name === name);
  if (!group) return null;
  const bs = bestSpan(group.spans);
  const bestTier = overallTierForSpan(tierContextWithSixthMan(bs));
  // Rarity / best tier / athleticism stay on the engine's real peak (`bs`); only the row the card
  // opens on can be moved by `NAMED_LEAD_SPAN` (see its docstring).
  const lead = leadSpan(name, group.spans);
  return {
    name,
    naturalPos: naturalPosition(name),
    spanRange: spanRange(group.spans),
    bestTier,
    rarity: rarityForTier(bestTier),
    allStar: allStarCount(name),
    heightIn: getHeightInches(name) ?? null,
    weightLbs: getBodyWeightLbs(name) ?? null,
    athleticism: athleticismScoreForSpan(bs),
    career: careerAveragesFor(name),
    // Lead span first, then the rest chronologically.
    rows: [lead, ...group.spans.filter((s) => s.id !== lead.id)].map(cardSpanRow),
  };
}

/** `6'6"` from inches. */
export function formatHeight(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
