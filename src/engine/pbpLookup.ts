import { ERA_MASK } from './eraMask';
import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import data from '../data/pbpPlayer.json';

/**
 * 2026-11-25 (docs/pbp-plan.md): pbpstats season totals (2000-01 on) for a span — counts summed over its
 * seasons, shares weighted by minutes, null without coverage. Built by scripts/buildPbpPlayer.ts.
 */
export interface PbpSpan {
  minutes: number;
  offPoss: number;
  usage: number;
  atRimFga: number; atRimFgm: number; shortMidFga: number; shortMidFgm: number; longMidFga: number; longMidFgm: number;
  corner3Fga: number; corner3Fgm: number; arc3Fga: number; arc3Fgm: number;
  atRimAssisted: number; corner3Assisted: number; arc3Assisted: number; assisted2s: number; assisted3s: number;
  fta: number; and1: number; foulsDrawn2: number; foulsDrawn3: number; nonShootingDrawn: number;
  fouls: number; shootingFouls: number; turnovers: number; liveBallTurnovers: number; assists: number; putbackPts: number; selfOreb: number;
  onOffRtg: number; onDefRtg: number;
}
const KEYS: (keyof PbpSpan)[] = ['minutes', 'offPoss', 'usage', 'atRimFga', 'atRimFgm', 'shortMidFga', 'shortMidFgm', 'longMidFga', 'longMidFgm',
  'corner3Fga', 'corner3Fgm', 'arc3Fga', 'arc3Fgm', 'atRimAssisted', 'corner3Assisted', 'arc3Assisted', 'assisted2s', 'assisted3s',
  'fta', 'and1', 'foulsDrawn2', 'foulsDrawn3', 'nonShootingDrawn', 'fouls', 'shootingFouls', 'turnovers', 'liveBallTurnovers', 'assists', 'putbackPts', 'selfOreb',
  'onOffRtg', 'onDefRtg'];
/** Shares (weighted by minutes) — everything else is a count (summed). */
const SHARES = new Set<keyof PbpSpan>(['usage', 'atRimAssisted', 'corner3Assisted', 'arc3Assisted', 'assisted2s', 'assisted3s', 'onOffRtg', 'onDefRtg']);
const players = (data as unknown as { players: Record<string, Record<string, (number | null)[]>> }).players;
const cache = new Map<string, PbpSpan | null>();

export function pbpForSpan(span: PlayerSpan): PbpSpan | null {
  if (ERA_MASK) return null;
  const hit = cache.get(span.id);
  if (hit !== undefined) return hit;
  const seasons = players[normalizePlayerName(span.playerName)];
  const sum: Record<string, number> = {};
  const wsum: Record<string, number> = {};
  let found = false;
  if (seasons) for (const y of spanEndYears(span.spanLabel)) {
    const row = seasons[String(y)];
    if (!row) continue;
    found = true;
    const min = row[0] ?? 0;
    KEYS.forEach((k, i) => {
      const v = row[i];
      if (v === null || v === undefined) return;
      if (SHARES.has(k)) { sum[k] = (sum[k] ?? 0) + v * min; wsum[k] = (wsum[k] ?? 0) + min; } else sum[k] = (sum[k] ?? 0) + v;
    });
  }
  const result = found ? (Object.fromEntries(KEYS.map((k) => [k, SHARES.has(k) ? (wsum[k] ? sum[k] / wsum[k] : NaN) : (sum[k] ?? 0)])) as unknown as PbpSpan) : null;
  cache.set(span.id, result);
  return result;
}
