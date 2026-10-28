/**
 * Writes the engine's copies of the real advanced numbers the user downloaded on 2026-10-28
 * (weeks 2-3 step 2, TODO "Kolejność prac"), the way RAPTOR and BPM2 are kept — one row a
 * player-season, keyed by name and season, read by span through `src/engine/realAdvancedLookup.ts`:
 *
 *  - src/data/awards/realAdvanced.json + .pool.json (players who ever appear in the draft pool):
 *    BBRef Advanced 1973-74 on (`raw/bbref/player_advanced.csv`; the multi-team total when he
 *    moved) and, where NBA.com has it, the same season's hustle (2015-16 on), close-defense by
 *    zone and tracking (2013-14 on) and on/off (2007-08 on) from `raw/nbaStats/`, summed over
 *    his teams. Counts are season totals; rates are as published.
 *  - src/data/awards/teamSeasons.json: every BBRef team-season 1973-74 on (`raw/bbref/
 *    team_advanced.csv`) — record, MOV, SRS, ORtg, DRtg, pace — the real results to hold the
 *    team score against.
 *  - src/data/awards/lineups5.json: NBA.com five-man units 2007-08 on with 100+ minutes
 *    (`raw/nbaStats/lineups_advanced.csv`), players by pool-resolved name — real fives to hold
 *    Fit and the live game against.
 *
 * Nothing in the game reads these yet; steps 3-8 decide what does.
 *
 * Run: npx tsx scripts/buildRealAdvanced.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { resolveSourceName } from '../src/data/sourceNameResolver';

const root = resolve(import.meta.dirname, '..');

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}
function csv(path: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(resolve(root, path), 'utf8').split(/\r?\n/).filter(Boolean);
  const keys = parseCsvLine(head);
  return lines.map((l) => Object.fromEntries(parseCsvLine(l).map((v, i) => [keys[i], v])));
}
const endYear = (season: string) => parseInt(season.slice(0, 4), 10) + 1;
const num = (x: string | undefined) => (x === undefined || x.trim() === '' ? undefined : Number(x));
/** NBA.com's on/off table writes "Bibby, Mike". */
const unflip = (n: string) => (n.includes(', ') ? n.split(', ').reverse().join(' ') : n);
const keyOf = (name: string, season: string) => `${resolveSourceName(unflip(name), endYear(season))}|${season}`;
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

type Row = Record<string, string | number>;
const rows = new Map<string, Row>();
const rowFor = (name: string, season: string): Row => {
  const k = keyOf(name, season);
  let r = rows.get(k);
  if (!r) {
    r = { name: resolveSourceName(unflip(name), endYear(season)), season };
    rows.set(k, r);
  }
  return r;
};
const add = (r: Row, field: string, x: number | undefined) => {
  if (x === undefined || Number.isNaN(x)) return;
  r[field] = ((r[field] as number | undefined) ?? 0) + x;
};

// BBRef Advanced: one line a player-season, the multi-team total when he moved.
const BBREF: [string, string][] = [
  ['g', 'games'],
  ['mp', 'mp'],
  ['per', 'per'],
  ['ts', 'ts_pct'],
  ['orb', 'orb_pct'],
  ['drb', 'drb_pct'],
  ['ast', 'ast_pct'],
  ['stl', 'stl_pct'],
  ['blk', 'blk_pct'],
  ['tov', 'tov_pct'],
  ['usg', 'usg_pct'],
  ['obpm', 'obpm'],
  ['dbpm', 'dbpm'],
  ['bpm', 'bpm'],
  ['vorp', 'vorp'],
  ['dws', 'dws'],
];
const bbrefTaken = new Set<string>();
for (const r of csv('src/data/raw/bbref/player_advanced.csv')) {
  const k = keyOf(r.name_display, r.SEASON);
  const total = /^(\d+TM|TOT)$/.test(r.team_name_abbr);
  if (bbrefTaken.has(k) && !total) continue;
  bbrefTaken.add(k);
  const row = rowFor(r.name_display, r.SEASON);
  row.team = r.team_name_abbr;
  for (const [field, col] of BBREF) {
    const x = num(r[col]);
    if (x !== undefined && !Number.isNaN(x)) row[field] = x;
  }
}

// NBA.com: totals summed over his teams.
for (const r of csv('src/data/raw/nbaStats/hustle_player.csv')) {
  const row = rowFor(r.PLAYER_NAME, r.SEASON);
  add(row, 'hMin', num(r.MIN));
  add(row, 'defl', num(r.DEFLECTIONS));
  add(row, 'contests', num(r.CONTESTED_SHOTS));
  add(row, 'contests3', num(r.CONTESTED_SHOTS_3PT));
  add(row, 'charges', num(r.CHARGES_DRAWN));
  add(row, 'looseBalls', num(r.LOOSE_BALLS_RECOVERED));
  add(row, 'screenAst', num(r.SCREEN_ASSISTS));
  add(row, 'boxOuts', num(r.BOX_OUTS));
}
// Close defense by zone: shots he defended, and the points of FG% below what those shooters make.
const ZONES: [string, string, string, string][] = [
  ['defense_overall', 'D_FGA', 'D_FG_PCT', 'NORMAL_FG_PCT'],
  ['defense_rim', 'FGA_LT_06', 'LT_06_PCT', 'NS_LT_06_PCT'],
  ['defense_lt10', 'FGA_LT_10', 'LT_10_PCT', 'NS_LT_10_PCT'],
  ['defense_gt15', 'FGA_GT_15', 'GT_15_PCT', 'NS_GT_15_PCT'],
  ['defense_2pt', 'FG2A', 'FG2_PCT', 'NS_FG2_PCT'],
  ['defense_3pt', 'FG3A', 'FG3_PCT', 'NS_FG3_PCT'],
];
for (const [file, fga, pct, normal] of ZONES) {
  const zone = file.replace('defense_', '');
  for (const r of csv(`src/data/raw/nbaStats/${file}.csv`)) {
    const a = num(r[fga]);
    const d = num(r[pct]);
    const n = num(r[normal]);
    if (!a || d === undefined || n === undefined) continue;
    const row = rowFor(r.PLAYER_NAME, r.SEASON);
    add(row, `${zone}A`, a);
    // Kept as made-shots-saved so seasons over two teams add up: (normal − allowed) × attempts.
    add(row, `${zone}Saved`, (n - d) * a);
  }
}
for (const r of csv('src/data/raw/nbaStats/player_rebounding.csv')) {
  const row = rowFor(r.PLAYER_NAME, r.SEASON);
  add(row, 'tMin', num(r.MIN));
  add(row, 'drebChances', num(r.DREB_CHANCES));
  add(row, 'dreb', num(r.DREB));
  add(row, 'drebContest', num(r.DREB_CONTEST));
  add(row, 'orebChances', num(r.OREB_CHANCES));
  add(row, 'oreb', num(r.OREB));
}
for (const r of csv('src/data/raw/nbaStats/player_possessions.csv')) {
  const row = rowFor(r.PLAYER_NAME, r.SEASON);
  add(row, 'touches', num(r.TOUCHES));
  add(row, 'possTime', num(r.TIME_OF_POSS));
  add(row, 'paintTouches', num(r.PAINT_TOUCHES));
  add(row, 'postTouches', num(r.POST_TOUCHES));
  add(row, 'elbowTouches', num(r.ELBOW_TOUCHES));
}
for (const r of csv('src/data/raw/nbaStats/player_speed.csv')) {
  const row = rowFor(r.PLAYER_NAME, r.SEASON);
  add(row, 'milesDef', num(r.DIST_MILES_DEF));
  add(row, 'milesOff', num(r.DIST_MILES_OFF));
}
// On/off: minutes and points per 100 either way, minutes-weighted over his teams.
{
  const off = new Map<string, Record<string, string>>();
  for (const r of csv('src/data/raw/nbaStats/onoff_off.csv')) off.set(`${r.SEASON}|${r.TEAM_ID}|${r.VS_PLAYER_ID}`, r);
  for (const on of csv('src/data/raw/nbaStats/onoff_on.csv')) {
    const o = off.get(`${on.SEASON}|${on.TEAM_ID}|${on.VS_PLAYER_ID}`);
    const onMin = num(on.MIN) ?? 0;
    const offMin = num(o?.MIN) ?? 0;
    if (!o || !onMin || !offMin) continue;
    const row = rowFor(on.VS_PLAYER_NAME, on.SEASON);
    add(row, 'onMin', onMin);
    add(row, 'offMin', offMin);
    for (const [f, c] of [['onOrtg', 'OFF_RATING'], ['onDrtg', 'DEF_RATING']] as const) add(row, f, (num(on[c]) ?? 0) * onMin);
    for (const [f, c] of [['offOrtg', 'OFF_RATING'], ['offDrtg', 'DEF_RATING']] as const) add(row, f, (num(o[c]) ?? 0) * offMin);
  }
  for (const row of rows.values()) {
    if (!row.onMin) continue;
    for (const f of ['onOrtg', 'onDrtg']) row[f] = (row[f] as number) / (row.onMin as number);
    for (const f of ['offOrtg', 'offDrtg']) row[f] = (row[f] as number) / (row.offMin as number);
  }
}

for (const row of rows.values()) for (const [k, v] of Object.entries(row)) if (typeof v === 'number') row[k] = round(v, Number.isInteger(v) ? 0 : 3);
const all = [...rows.values()].sort((a, b) => String(a.season).localeCompare(String(b.season)) || String(a.name).localeCompare(String(b.name)));
const poolNames = new Set(draftPool.map((s) => normalizePlayerName(s.playerName)));
const pool = all.filter((r) => poolNames.has(String(r.name)));
const lines = (xs: unknown[]) => `[\n${xs.map((x) => JSON.stringify(x)).join(',\n')}\n]\n`;
writeFileSync(resolve(root, 'src/data/awards/realAdvanced.json'), lines(all));
writeFileSync(resolve(root, 'src/data/awards/realAdvanced.pool.json'), lines(pool));

// Team-seasons.
const teams = csv('src/data/raw/bbref/team_advanced.csv')
  .filter((r) => r.team && r.team !== 'League Average')
  .map((r) => ({
    season: r.SEASON,
    team: r.team.replace(/\*$/, ''),
    playoffs: r.team.endsWith('*'),
    w: num(r.wins),
    l: num(r.losses),
    mov: num(r.mov),
    srs: num(r.srs),
    ortg: num(r.off_rtg),
    drtg: num(r.def_rtg),
    pace: num(r.pace),
  }));
writeFileSync(resolve(root, 'src/data/awards/teamSeasons.json'), lines(teams));

// Five-man units, players by name through the NBA.com ids the per-player tables carry.
const idName = new Map<string, string>();
for (const f of ['hustle_player', 'player_rebounding', 'player_possessions', 'player_speed', 'clutch_player'])
  for (const r of csv(`src/data/raw/nbaStats/${f}.csv`)) if (r.PLAYER_ID) idName.set(r.PLAYER_ID, resolveSourceName(r.PLAYER_NAME, endYear(r.SEASON)));
for (const r of csv('src/data/raw/nbaStats/onoff_on.csv')) idName.set(r.VS_PLAYER_ID, resolveSourceName(unflip(r.VS_PLAYER_NAME), endYear(r.SEASON)));
let unnamed = 0;
const units = csv('src/data/raw/nbaStats/lineups_advanced.csv')
  .filter((r) => (num(r.MIN) ?? 0) >= 100)
  .map((r) => {
    const ids = r.GROUP_ID.split('-').filter(Boolean);
    const names = ids.map((id) => idName.get(id) ?? (unnamed++, `#${id}`));
    return { season: r.SEASON, team: r.TEAM_ABBREVIATION, players: names, min: num(r.MIN), ortg: num(r.OFF_RATING), drtg: num(r.DEF_RATING), net: num(r.NET_RATING), pace: num(r.PACE), poss: num(r.POSS) };
  });
writeFileSync(resolve(root, 'src/data/awards/lineups5.json'), lines(units));

const spansCovered = draftPool.filter((s) => {
  const n = normalizePlayerName(s.playerName);
  return pool.some((r) => r.name === n && r.mp !== undefined);
}).length;
console.log(`realAdvanced: ${all.length} player-seasons (${pool.length} of pool players); ${spansCovered}/${draftPool.length} pool spans' players have BBRef rows`);
console.log(`teamSeasons: ${teams.length}; lineups5: ${units.length} units of 100+ min (${unnamed} player ids without a name)`);
