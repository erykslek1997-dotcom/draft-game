import type { PlayerSpan } from '../data/schema';
import contextData from '../data/spanContext.json';
import { eraScaledThreePA } from './era';
import { computeOffensiveTalent } from './talent';
import { estimatedMinutesPerGame } from './minutesPerGame';
import { modernBox } from './modernBox';

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
 *   weighted by his O-TAL against the five's best scorer, each held between 0.75x and 1.05x his own
 *   usage (never above 45%), what a capped player cannot take flowing to the others. A shot given up
 *   is a slightly better shot taken: +0.25 TS points per usage point.
 */
const CONTEXT = contextData as unknown as Record<string, [number, number, number, number, number, number]>;

const RIM_PER_SPACING = 0.108;
const MID_PER_SPACING = 0.038;
const TS_PER_USAGE = 0.25;
const USAGE_OTAL_POWER = 1;
const USAGE_MIN_SHARE = 0.75;
const USAGE_MAX_GROWTH = 1.05;
const USAGE_MAX = 0.45;
/**
 * Better passers beside him mean better shots (2026-10-02, the user, on KG): his shooting moves by
 * `PLAYMAKING_PER_ASSIST` per assist per 36 the average teammate here gives beyond his real
 * teammates' — an estimate (a five of elite passers ~+2 points of FG%), capped.
 */
const PLAYMAKING_PER_ASSIST = 0.006;
const MAX_PLAYMAKING_DELTA = 0.03;
const assistsPer36 = (span: PlayerSpan) => (span.box.apg * 36) / (estimatedMinutesPerGame(span) ?? 32);
const DEFAULT_CONTEXT: [number, number, number, number, number, number] = [200, 200, 500, 880, 280, 3500];

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
  /** His weight when the five picks a shooter: usage minus the share of it that is turnovers. */
  shotWeight: number;
  /** His real free-throw attempts per field-goal attempt. */
  freeThrowRate: number;
  /** Change to his shooting from how well the four teammates here pass, against his real ones. */
  playmakingDelta: number;
  /** Share of his two-point attempts taken at the rim. */
  rimShare: number;
}

function context(span: PlayerSpan): [number, number, number, number, number, number] {
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
  // A star who shot more than today's leaders claims less of the ball (`modernBox.ts`); his real
  // usage stays the yardstick, so the shots he gives up come back as efficiency.
  const own = five.map((span) => (context(span)[1] / 1000) * modernBox(span).usageFactor);
  const top = Math.max(...five.map((span) => computeOffensiveTalent(span)));
  const claim = five.map((span, i) => own[i] * (computeOffensiveTalent(span) / top) ** USAGE_OTAL_POWER);
  const lo = own.map((u) => u * USAGE_MIN_SHARE);
  // Only a five that would leave possessions unused (its real usages add up to less than 100%) lets
  // anyone take more than his real share (2026-10-02: Jordan took 37% beside Lowry and Bosh, more
  // than with the Bulls).
  const growth = Math.max(1, Math.min(USAGE_MAX_GROWTH, 1 / own.reduce((sum, u) => sum + u, 0)));
  const hi = own.map((u) => Math.min(USAGE_MAX, u * growth));
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
  // The caps can leave the split short of (or over) 100%; the possessions are all used anyway, so
  // each player's real share — and the efficiency cost of a bigger one — is his share of the total
  // (2026-10-02: Kareem scored 31.5 beside four low-usage teammates at no cost).
  const capped = splitUsage(five);
  const total = capped.reduce((sum, u) => sum + u, 0) || 1;
  const usage = capped.map((u) => u / total);
  return five.map((span, i) => {
    const [originalSpacing, originalUsage, rimShare, shotShare, freeThrowRate, originalMatesAssists] = context(span).map((v) => v / 1000);
    const matesAssists = five.filter((_, j) => j !== i).reduce((sum, m) => sum + assistsPer36(m), 0) / 4;
    const spacing = modernSpacing(five.filter((_, j) => j !== i));
    const room = spacing - originalSpacing;
    return {
      span,
      originalSpacing,
      spacing,
      originalUsage,
      usage: usage[i],
      rimShare,
      twoPointDelta: room * (rimShare * RIM_PER_SPACING + (1 - rimShare) * MID_PER_SPACING),
      usageDelta: -TS_PER_USAGE * (usage[i] - originalUsage),
      shotWeight: usage[i] * shotShare,
      freeThrowRate,
      playmakingDelta: Math.max(-MAX_PLAYMAKING_DELTA, Math.min(MAX_PLAYMAKING_DELTA, PLAYMAKING_PER_ASSIST * (matesAssists - originalMatesAssists))),
    };
  });
}
