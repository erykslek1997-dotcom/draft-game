import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import data from '../data/apbrRapm.json';

/**
 * 2026-11-25: single-season RAPM 1996-97 .. 2018-19 (APBRmetrics "NBA RAPM", Simon Zou and Raj Vir;
 * `scripts/fetchApbrRapm.sh`, merged to src/data/apbrRapm.json: name -> end year -> [possessions, ORAPM,
 * DRAPM, RAPM]). A span's value is its seasons' RAPM weighted by possessions; null without coverage.
 */
const byName = new Map<string, Record<string, [number, number, number, number]>>();
for (const [name, seasons] of Object.entries(data as unknown as Record<string, Record<string, [number, number, number, number]>>)) byName.set(normalizePlayerName(name), seasons);
const cache = new Map<string, { o: number; d: number; net: number; poss: number } | null>();
export function apbrRapmForSpan(span: PlayerSpan): { o: number; d: number; net: number; poss: number } | null {
  const hit = cache.get(span.id);
  if (hit !== undefined) return hit;
  const seasons = byName.get(normalizePlayerName(span.playerName));
  let poss = 0, o = 0, d = 0, net = 0;
  if (seasons) for (const y of spanEndYears(span.spanLabel)) { const r = seasons[String(y)]; if (!r) continue; poss += r[0]; o += r[0] * r[1]; d += r[0] * r[2]; net += r[0] * r[3]; }
  const result = poss > 0 ? { o: o / poss, d: d / poss, net: net / poss, poss } : null;
  cache.set(span.id, result);
  return result;
}
