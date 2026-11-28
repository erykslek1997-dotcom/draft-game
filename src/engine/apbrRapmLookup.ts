import { envVar } from './env';
import { ERA_MASK } from './eraMask';
import type { PlayerSpan } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { spanEndYears } from './era';
import data from '../data/apbrRapm.json';
import lineupData from '../data/lineupRapm.json';

/**
 * 2026-11-25: single-season RAPM 1996-97 .. 2018-19 (APBRmetrics "NBA RAPM", Simon Zou and Raj Vir;
 * `scripts/fetchApbrRapm.sh`, merged to src/data/apbrRapm.json: name -> end year -> [possessions, ORAPM,
 * DRAPM, RAPM]). A span's value is its seasons' RAPM weighted by possessions; null without coverage.
 */
const byName = new Map<string, Record<string, [number, number, number, number]>>();
for (const [name, seasons] of Object.entries(data as unknown as Record<string, Record<string, [number, number, number, number]>>)) byName.set(normalizePlayerName(name), seasons);
// 2026-11-28 (the user: "nie masz jak odtworzyć RAPM?"): a lineup-level ridge RAPM from the pbpstats five-man lineups,
// 2000-01 .. 2025-26 (`scripts/buildLineupRapm.ts`; r ~0.9 with APBR where both exist). `RAPM_LINEUP=1` fills the seasons
// APBR lacks (2019-20 on), `RAPM_LINEUP=all` averages the two where both exist. 0 = APBR only.
const RAPM_LINEUP = envVar('RAPM_LINEUP') ?? '1';
if (RAPM_LINEUP !== '0') for (const [name, seasons] of Object.entries(lineupData as unknown as Record<string, Record<string, [number, number, number, number]>>)) {
  const key = normalizePlayerName(name); const cur = { ...(byName.get(key) ?? {}) };
  for (const [y, r] of Object.entries(seasons)) { const a = cur[y]; cur[y] = !a ? r : RAPM_LINEUP === 'all' ? [a[0], (a[1] + r[1]) / 2, (a[2] + r[2]) / 2, (a[3] + r[3]) / 2] : a; }
  byName.set(key, cur);
}
const cache = new Map<string, { o: number; d: number; net: number; poss: number } | null>();
export function apbrRapmForSpan(span: PlayerSpan): { o: number; d: number; net: number; poss: number } | null {
  if (ERA_MASK) return null;
  const hit = cache.get(span.id);
  if (hit !== undefined) return hit;
  const seasons = byName.get(normalizePlayerName(span.playerName));
  let poss = 0, o = 0, d = 0, net = 0;
  if (seasons) for (const y of spanEndYears(span.spanLabel)) { const r = seasons[String(y)]; if (!r) continue; poss += r[0]; o += r[0] * r[1]; d += r[0] * r[2]; net += r[0] * r[3]; }
  const result = poss > 0 ? { o: o / poss, d: d / poss, net: net / poss, poss } : null;
  cache.set(span.id, result);
  return result;
}

/** 2026-11-27: defensive RAPM over the window's seasons and `reach` seasons either side, weighted by
 * possessions (single-season RAPM swings: Bowen +2.7 / +0.7 / −0.2 in three straight years). */
const RAPM_GAP = (envVar('RAPM_GAP') ?? '1') === '1';
const RAPM_GAP_POSS = 2000;
export function apbrDrapmAround(span: PlayerSpan, reach = 2): { d: number; poss: number } | null {
  if (ERA_MASK) return null;
  const seasons = byName.get(normalizePlayerName(span.playerName));
  if (!seasons) return null;
  const ys = spanEndYears(span.spanLabel);
  if (!ys.length) return null;
  let poss = 0, d = 0;
  const lo = Math.min(...ys), hi = Math.max(...ys);
  for (let y = lo; y <= hi; y++) { const r = seasons[String(y)]; if (!r) continue; poss += r[0]; d += r[0] * r[2]; }
  // 2026-11-27 (the user: Kawhi 2015-17 read Toronto 2018-19 across his lost 2017-18): the neighbours stop at the
  // first lost season (under `RAPM_GAP_POSS` possessions — injury, a year out); `RAPM_GAP=0` = plain calendar reach.
  const walk = (start: number, step: number) => { for (let k = 1; k <= reach; k++) { const r = seasons[String(start + step * k)]; if (RAPM_GAP && (!r || r[0] < RAPM_GAP_POSS)) return; if (!r) continue; poss += r[0]; d += r[0] * r[2]; } };
  walk(lo, -1); walk(hi, 1);
  return poss > 0 ? { d: d / poss, poss } : null;
}
