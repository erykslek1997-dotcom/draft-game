/**
 * 2026-11-06, the user ("może jeszcze jakiś bonus jak ktoś grał razem irl i wygrywał?"): who played
 * where, for the chemistry bonus (src/engine/chemistry.ts). From src/data/raw/playerSeasonTeams.csv:
 * every pool player's seasons with `MIN_MINUTES`+ for one team, and each season's champion from
 * src/data/playoffSeriesOutcomes.json (1997 on).
 *
 *   npx tsx scripts/buildTeammates.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import outcomes from '../src/data/playoffSeriesOutcomes.json';

const MIN_MINUTES = 1000;
const pool = new Set(draftPool.map((s) => normalizePlayerName(s.playerName)));
const lines = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1);
const seasons: Record<string, Record<string, string>> = {};
for (const l of lines) {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  if (!m) continue;
  const name = normalizePlayerName(m[2].replace(/^"|"$/g, ''));
  if (!pool.has(name) || Number(m[6]) < MIN_MINUTES) continue;
  (seasons[name] ??= {})[m[3]] = m[4].replace(/^"|"$/g, '');
}
const champions: Record<string, string> = {};
for (const o of outcomes as { season: number; team: string; isChampion: boolean }[]) if (o.isChampion) champions[String(o.season)] = o.team;
writeFileSync(resolve(import.meta.dirname, '../src/data/teammates.json'), JSON.stringify({ seasons, champions }));
console.log(`${Object.keys(seasons).length} players, ${Object.keys(champions).length} champions`);
