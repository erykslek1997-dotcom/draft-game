import type { PlayerSpan } from '../data/schema';
import contextData from '../data/spanContext.json';
import { eraScaledThreePA } from './era';
import { computeOffensiveTalent } from './talent';

/**
 * 2026-10-02, stage 2 (live game), the user: "realne skalowanie statystyk na to jaki jest skład —
 * Kobe grał w deadball, ale mając nowoczesny skład miałby więcej miejsca i był bardziej skuteczny".
 * A player's numbers are re-read for the five he plays in now:
 *
 * - Room to operate. His original teammates' three-point rate (`spanContext.json`, built by
 *   `scripts/buildSpanContext.ts` from the real rosters) against the new teammates' rate in the
 *   modern game (`eraScaledThreePA`). From 1997 to 2025 the league's three-point rate went from
 *   about 0.20 to 0.50 while finishing at the rim rose ~6.5 points and mid-range ~2; half of that is
 *   credited to the room itself (the user: "na ten moment połowa"), the rest to shot selection.
 * - The ball. The five's usage has to add up to 100%. Who keeps it is the engine's call (the user:
 *   "powinno zależeć od tego jak silnik ocenia skład"): each player's claim is his own usage
 *   weighted by his O-TAL against the five's best scorer, each held between 0.75x and 1.1x his own
 *   usage (never above 45%), what a capped player cannot take flowing to the others. A shot given up
 *   is a slightly better shot taken: +0.25 TS points per usage point.
 */
const CONTEXT = contextData as unknown as Record<string, [number, number, number]>;

const RIM_PER_SPACING = 0.108;
const MID_PER_SPACING = 0.038;
const TS_PER_USAGE = 0.25;
const USAGE_OTAL_POWER = 1;
const USAGE_MIN_SHARE = 0.75;
const USAGE_MAX_GROWTH = 1.1;
const USAGE_MAX = 0.45;
const DEFAULT_CONTEXT: [number, number, number] = [200, 200, 500];

export interface ContextLine {
  span: PlayerSpan;
  /** Teammates' three-point rate where he really played, and in this five. */
  originalSpacing: number;
  spacing: number;
  /** Share of the five's possessions he used then, and uses here. */
  originalUsage: number;
  usage: number;
  /** Change to his two-point FG% from the room he has here. */
  twoPointDelta: number;
  /** Change to his shooting (all shots) from the usage he carries here. */
  usageDelta: number;
}

function context(span: PlayerSpan): [number, number, number] {
  return CONTEXT[span.id] ?? DEFAULT_CONTEXT;
}

/** Teammates' three-point rate in the modern game. */
function modernSpacing(mates: PlayerSpan[]): number {
  let threes = 0;
  let shots = 0;
  for (const mate of mates) {
    threes += Math.min(mate.fga * 0.9, eraScaledThreePA(mate.spanLabel, mate.box.threePA));
    shots += mate.fga;
  }
  return shots > 0 ? threes / shots : 0;
}

function splitUsage(five: PlayerSpan[]): number[] {
  const own = five.map((span) => context(span)[1] / 1000);
  const top = Math.max(...five.map((span) => computeOffensiveTalent(span)));
  const claim = five.map((span, i) => own[i] * (computeOffensiveTalent(span) / top) ** USAGE_OTAL_POWER);
  const lo = own.map((u) => u * USAGE_MIN_SHARE);
  const hi = own.map((u) => Math.min(USAGE_MAX, u * USAGE_MAX_GROWTH));
  const share = (scale: number) => claim.map((c, i) => Math.max(lo[i], Math.min(hi[i], c * scale)));
  let scale = 1;
  for (let step = 0; step < 60; step++) {
    const total = share(scale).reduce((sum, u) => sum + u, 0);
    if (total <= 0) break;
    scale /= total;
  }
  return share(scale);
}

/** Every player of a five, re-read for the other four. */
export function contextLines(five: PlayerSpan[]): ContextLine[] {
  const usage = splitUsage(five);
  return five.map((span, i) => {
    const [originalSpacing, originalUsage, rimShare] = context(span).map((v) => v / 1000);
    const spacing = modernSpacing(five.filter((_, j) => j !== i));
    const room = spacing - originalSpacing;
    return {
      span,
      originalSpacing,
      spacing,
      originalUsage,
      usage: usage[i],
      twoPointDelta: room * (rimShare * RIM_PER_SPACING + (1 - rimShare) * MID_PER_SPACING),
      usageDelta: -TS_PER_USAGE * (usage[i] - originalUsage),
    };
  });
}
