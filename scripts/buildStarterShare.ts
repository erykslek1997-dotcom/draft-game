/**
 * 2026-11-05, the user ("czy gracz IRL był starterem czy raczej ławkowiczem i ile grał. Bo Caruso
 * raczej wchodził z ławki"): for every window in the draft pool, the share of his games a player
 * started (kept when under half), from Basketball-Reference's advanced table (games started on
 * record from 1981-82). A traded player's season counts once (its TOT/2TM/3TM row).
 *
 *   npx tsx scripts/buildStarterShare.ts   →   src/data/starterShare.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizePlayerName } from '../src/data/schema';
import { draftPool } from '../src/data/draftPool';
import { spanEndYears } from '../src/engine/era';

const text = readFileSync('src/data/raw/bbref/player_advanced.csv', 'utf8').trim().split('\n');
const head = text[0].split(',');
const col = (name: string) => head.indexOf(name);
const [cSeason, cName, cTeam, cG, cGs, cMp] = ['SEASON', 'name_display', 'team_name_abbr', 'games', 'games_started', 'mp'].map(col);
type Season = { g: number; gs: number | null; mp: number };
const seasons = new Map<string, Season>();
const multi = new Set<string>();
for (const line of text.slice(1)) {
  const f = line.split(',');
  const end = Number(f[cSeason].slice(0, 4)) + 1;
  const key = `${normalizePlayerName(f[cName])}|${end}`;
  const team = f[cTeam];
  const total = team === 'TOT' || /^\dTM$/.test(team);
  if (multi.has(key) && !total) continue; // per-team rows of a traded season
  if (total) multi.add(key);
  const gs = f[cGs] === '' ? null : Number(f[cGs]);
  seasons.set(key, { g: Number(f[cG]), gs, mp: Number(f[cMp]) });
}
// Only the windows under half: the rest read as starters, and the file ships in the bundle.
const out: Record<string, number> = {};
let covered = 0;
for (const span of draftPool) {
  let g = 0, gs = 0, mp = 0, known = true;
  for (const y of spanEndYears(span.spanLabel)) {
    const s = seasons.get(`${normalizePlayerName(span.playerName)}|${y}`);
    if (!s) continue;
    if (s.gs === null) known = false;
    g += s.g; gs += s.gs ?? 0; mp += s.mp;
  }
  if (!known || g === 0) continue;
  covered++;
  void mp;
  const share = Math.round((gs / g) * 100) / 100;
  if (share < 0.5) out[`${normalizePlayerName(span.playerName)}|${span.spanLabel}`] = share;
}
writeFileSync('src/data/starterShare.json', JSON.stringify(out));
console.log(`windows ${draftPool.length}, with games started ${covered}`);
