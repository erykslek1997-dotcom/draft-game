import type { PlayerSpan, Position } from '../data/schema';
import { draftPool } from '../data/draftPool';
import { computeOffensiveProfile } from './offensiveProfile';
import { boxRatesForSpan } from './boxRatesLookup';
import { eraBaseline, LEAGUE_PACE_BASELINE, spanEndYears } from './era';

/**
 * FINISHING (FIN) — 2026-09-27, the user's ask for a player-facing rim rating ("ocena rimP ale
 * pod inną nazwą? Może finishing"). First shipped as the team rim-pressure number, which is mostly
 * volume; the user: "Curry 25 czy Nash 5 pokazują wady... kończyli na wysokim procencie jak na
 * niskich graczy". So this is finishing skill, read against players of the same position:
 *
 * - 55% how often his shots at the rim go in (1997+ shot-zone data), pulled toward the position's
 *   median when he took few of them;
 * - 30% how many shots at the rim he took per game, pace-adjusted;
 * - 15% how often he drew fouls (FTA / FGA).
 *
 * Each part is a 0-100 percentile among the pool's spans of the same position. Before 1997 there
 * are no shot zones: two-point FG% (against the same position in the same decade) stands in for
 * rim accuracy and two-point attempts for rim attempts.
 */
const ACCURACY_WEIGHT = 0.55;
const VOLUME_WEIGHT = 0.3;
const FOUL_WEIGHT = 0.15;
/** Rim attempts per game at which a player's own accuracy counts half, the position median half. */
const ACCURACY_SHRINK_ATTEMPTS = 1.5;
const TWO_POINT_SHRINK_ATTEMPTS = 3;

interface Features {
  zone: boolean;
  accuracy: number;
  attempts: number;
  foulRate: number | null;
  decade: number;
}

function featuresOf(span: PlayerSpan): Features {
  const pace = LEAGUE_PACE_BASELINE / eraBaseline(span.spanLabel).pace;
  const years = spanEndYears(span.spanLabel);
  const decade = Math.floor((years[years.length - 1] ?? 2000) / 10) * 10;
  const foulRate = boxRatesForSpan(span)?.ftRate ?? null;
  const profile = computeOffensiveProfile(span);
  if (profile.hasZoneData) {
    return { zone: true, accuracy: profile.rimAccuracy, attempts: profile.rimShare * span.fga * pace, foulRate, decade };
  }
  const twoPa = Math.max(0, span.fga - span.box.threePA);
  const twoPm = Math.max(0, span.box.fgPct * span.fga - span.box.threePct * span.box.threePA);
  return { zone: false, accuracy: twoPa > 0 ? (100 * twoPm) / twoPa : 0, attempts: twoPa * pace, foulRate, decade };
}

interface Reference {
  accuracy: number[];
  medianAccuracy: number;
  attempts: number[];
  foulRate: number[];
}

let references: Map<string, Reference> | null = null;
let featureCache: Map<string, Features> | null = null;

function cachedFeatures(span: PlayerSpan): Features {
  featureCache ??= new Map();
  let f = featureCache.get(span.id);
  if (!f) {
    f = featuresOf(span);
    featureCache.set(span.id, f);
  }
  return f;
}

/** Zone-era spans compare by position; pre-zone spans by position and decade. */
function referenceKey(position: Position, f: Features): string {
  return f.zone ? `z|${position}` : `b|${position}|${f.decade}`;
}

function buildReferences(): Map<string, Reference> {
  const groups = new Map<string, Features[]>();
  for (const span of draftPool) {
    const f = cachedFeatures(span);
    const key = referenceKey(span.primaryPosition, f);
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  const out = new Map<string, Reference>();
  for (const [key, list] of groups) {
    const minAttempts = key.startsWith('z|') ? 1 : 2;
    const accuracy = list.filter((f) => f.attempts >= minAttempts).map((f) => f.accuracy).sort((a, b) => a - b);
    const sortedAccuracy = accuracy.length > 0 ? accuracy : list.map((f) => f.accuracy).sort((a, b) => a - b);
    out.set(key, {
      accuracy: sortedAccuracy,
      medianAccuracy: sortedAccuracy[sortedAccuracy.length >> 1] ?? 0,
      attempts: list.map((f) => f.attempts).sort((a, b) => a - b),
      foulRate: list.flatMap((f) => (f.foulRate === null ? [] : [f.foulRate])).sort((a, b) => a - b),
    });
  }
  return out;
}

/** Share (0-100) of `sorted` at or below `value`, ties counted half. */
function percentile(value: number, sorted: number[]): number {
  if (sorted.length === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return (100 * (below + equal / 2)) / sorted.length;
}

const valueCache = new Map<string, number>();
/** FINISHING on the 0-100 scale the other judge metrics use. */
export function computeFinishing(span: PlayerSpan): number {
  const hit = valueCache.get(span.id);
  if (hit !== undefined) return hit;
  references ??= buildReferences();
  const f = cachedFeatures(span);
  const ref = references.get(referenceKey(span.primaryPosition, f))!;
  const shrink = f.zone ? ACCURACY_SHRINK_ATTEMPTS : TWO_POINT_SHRINK_ATTEMPTS;
  const trust = f.attempts / (f.attempts + shrink);
  const accuracy = ref.medianAccuracy + (f.accuracy - ref.medianAccuracy) * trust;
  const foul = f.foulRate === null ? 50 : percentile(f.foulRate, ref.foulRate);
  const value = Math.round(
    ACCURACY_WEIGHT * percentile(accuracy, ref.accuracy) +
      VOLUME_WEIGHT * percentile(f.attempts, ref.attempts) +
      FOUL_WEIGHT * foul,
  );
  valueCache.set(span.id, value);
  return value;
}
