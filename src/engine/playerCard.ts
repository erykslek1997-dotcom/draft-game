import type { PlayerSpan, Position } from '../data/schema';
import { POSITIONS } from '../data/schema';
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
import { computeOffensiveTalent, computeUncappedOffensiveTalent, computeDefensiveTalent } from './talent';
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

function bestSpan(spans: PlayerSpan[]): PlayerSpan {
  return spans.reduce((b, s) => (effectiveTalent(s) > effectiveTalent(b) ? s : b), spans[0]);
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
    // Best span first, then the rest chronologically — the card leads with the peak.
    rows: [bs, ...group.spans.filter((s) => s.id !== bs.id)].map(cardSpanRow),
  };
}

/** `6'6"` from inches. */
export function formatHeight(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
