import type { PlayerSpan } from '../data/schema';
import modernData from '../data/modernBox.json';

/**
 * 2026-10-02, stage 2, the user: "gramy na zasady obecne". A span's numbers translated to today's
 * game (pace, league shooting, today's leaders, stars' shots) — built by `scripts/buildModernBox.ts`,
 * which explains every step. The live engine plays these, not the raw box; spans from 2019 on are
 * unchanged, and a span outside the pool falls back to its own box.
 */
export interface ModernBox {
  twoPct: number;
  threePct: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  /** Share of his real claim on the ball he keeps today (below 1 for stars who shot more than
   * today's leaders). */
  usageFactor: number;
}

const DATA = modernData as unknown as Record<string, number[]>;
const cache = new Map<string, ModernBox>();

function ownTwoPointPct(span: PlayerSpan): number {
  const threeA = Math.min(span.box.threePA, span.fga * 0.9);
  const twoA = span.fga - threeA;
  if (twoA <= 0.5) return 0.45;
  return (span.fga * span.box.fgPct - threeA * span.box.threePct) / twoA;
}

export function modernBox(span: PlayerSpan): ModernBox {
  let m = cache.get(span.id);
  if (!m) {
    const row = DATA[span.id]?.map((v) => v / 1000);
    const b = span.box;
    m = row
      ? { twoPct: row[0], threePct: row[1], ppg: row[2], rpg: row[3], apg: row[4], spg: row[5], bpg: row[6], usageFactor: row[7] }
      : { twoPct: ownTwoPointPct(span), threePct: b.threePct, ppg: b.ppg, rpg: b.rpg, apg: b.apg, spg: b.spg, bpg: b.bpg, usageFactor: 1 };
    cache.set(span.id, m);
  }
  return m;
}
