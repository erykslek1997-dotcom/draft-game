/**
 * 2026-11-18: `src/data/raw/playerSeasonStats.csv` rebuilt from Basketball-Reference's season totals
 * (`scripts/fetch_bbref_totals_browser.js`, run by the user in the browser). The old file was
 * incomplete before the 1980s — 1960 held 22.6k minutes of the league's ~140k, 1973-74 3,371 steals of
 * 12,128, Walt Frazier 1973-74 21 steals of 161.
 *
 *   npx tsx scripts/buildPlayerSeasonStats.ts <bbref_player_totals.csv>
 *
 * Same columns and one row per player-season as before (a traded player's TOT / 2TM row, else his one
 * team row). `personId` is kept from the old file by name (the season first, then a name with one id),
 * else from players_bio.csv by name, else a new negative id. The old file is kept as
 * `playerSeasonStats.old.csv` for comparison.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizePlayerName } from '../src/data/schema';

const src = process.argv[2];
if (!src) throw new Error('usage: buildPlayerSeasonStats.ts <bbref_player_totals.csv>');
const RAW = resolve(import.meta.dirname, '../src/data/raw');
const parse = (l: string) => { const o: string[] = []; let c = '', q = false; for (const ch of l) { if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { o.push(c); c = ''; continue; } c += ch; } o.push(c); return o; };
const read = (f: string) => { const [h, ...ls] = readFileSync(f, 'utf8').trim().split(/\r?\n/); const cols = parse(h); return ls.map((l) => { const v = parse(l); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ''])); }); };

const oldPath = resolve(RAW, 'playerSeasonStats.csv'), backup = resolve(RAW, 'playerSeasonStats.old.csv');
if (!existsSync(backup)) copyFileSync(oldPath, backup);
const old = read(backup);
const idBySeason = new Map<string, string>(), idsByName = new Map<string, Set<string>>();
for (const r of old) { const k = normalizePlayerName(r.name); idBySeason.set(`${k}|${r.seasonEnd}`, r.personId); (idsByName.get(k) ?? idsByName.set(k, new Set()).get(k)!).add(r.personId); }
const bioIds = new Map<string, Set<string>>();
for (const r of read(resolve(RAW, 'players_bio.csv'))) { const k = normalizePlayerName(`${r.firstName} ${r.lastName}`); (bioIds.get(k) ?? bioIds.set(k, new Set()).get(k)!).add(r.personId); }
const newIds = new Map<string, string>();
let next = -1;
const idFor = (name: string, end: string, bbrefId: string) => {
  const k = normalizePlayerName(name);
  const s = idBySeason.get(`${k}|${end}`); if (s) return s;
  const one = (m: Map<string, Set<string>>) => { const v = m.get(k); return v && v.size === 1 ? [...v][0] : null; };
  const n = one(idsByName) ?? one(bioIds); if (n) return n;
  if (!newIds.has(bbrefId)) newIds.set(bbrefId, String(next--));
  return newIds.get(bbrefId)!;
};

const rows = read(src);
const bySeasonPlayer = new Map<string, Record<string, string>[]>();
for (const r of rows) { const k = `${r.SEASON_END}|${r.name_display_id}`; (bySeasonPlayer.get(k) ?? bySeasonPlayer.set(k, []).get(k)!).push(r); }
const num = (v: string) => (v === '' || v === undefined ? 0 : Number(v));
const out = ['personId,name,seasonEnd,games,numMinutes,points,assists,blocks,steals,fieldGoalsAttempted,fieldGoalsMade,threePointersAttempted,threePointersMade,freeThrowsAttempted,freeThrowsMade,reboundsDefensive,reboundsOffensive,reboundsTotal,foulsPersonal,turnovers'];
let mapped = 0, fresh = 0;
for (const [, list] of bySeasonPlayer) {
  const r = list.find((x) => /^(TOT|\dTM)$/.test(x.team_name_abbr)) ?? list[0];
  const id = idFor(r.name_display, r.SEASON_END, r.name_display_id);
  if (Number(id) < 0) fresh++; else mapped++;
  const name = r.name_display.includes(',') ? `"${r.name_display}"` : r.name_display;
  out.push([id, name, r.SEASON_END, num(r.games), num(r.mp), num(r.pts), num(r.ast), num(r.blk), num(r.stl), num(r.fga), num(r.fg), num(r.fg3a), num(r.fg3), num(r.fta), num(r.ft), num(r.drb), num(r.orb), num(r.trb), num(r.pf), num(r.tov)].join(','));
}
writeFileSync(oldPath, out.join('\n') + '\n');
console.log(`${out.length - 1} player-seasons written (old file: ${old.length}); ids kept ${mapped}, new ${fresh}`);
