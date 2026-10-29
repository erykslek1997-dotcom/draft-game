/**
 * Writes scripts/fetch_bbref_headshots_browser.js (2026-10-29): every player in the draft pool still
 * without a face after the NBA's image server (about 450, mostly the '80s and '90s, where the NBA
 * has only a blank stand-in), with his Basketball-Reference id. The id comes from the BBRef Advanced
 * tables (src/data/raw/bbref/player_advanced.csv), matched on the name and the span's seasons; for
 * the few before 1973-74 it is BBRef's own pattern (5 letters of the surname, 2 of the first name,
 * 01), marked as a guess so the import lists them for a look.
 *
 * Run: npx tsx scripts/buildBbrefHeadshotScript.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();
const pool = JSON.parse(readFileSync('src/data/draftPool.json', 'utf8')) as { playerName: string; spanLabel: string }[];
const ids = JSON.parse(readFileSync('src/data/headshotIds.json', 'utf8')) as Record<string, string>;

// name → bbref id → the season end years he played
const rows = readFileSync('src/data/raw/bbref/player_advanced.csv', 'utf8').trim().split('\n');
const head = rows[0].split(',');
const [iSeason, iName, iId] = ['SEASON', 'name_display', 'name_display_id'].map((k) => head.indexOf(k));
const byName = new Map<string, Map<string, Set<number>>>();
for (const line of rows.slice(1)) {
  const c = line.split(',');
  if (!c[iId]) continue;
  const end = Number(c[iSeason].slice(0, 4)) + 1;
  const m = byName.get(norm(c[iName])) ?? new Map<string, Set<number>>();
  byName.set(norm(c[iName]), m);
  (m.get(c[iId]) ?? m.set(c[iId], new Set()).get(c[iId])!).add(end);
}
const spanYears = (label: string) => {
  const [a, b] = label.split('-');
  const from = Number(a) + 1;
  const to = b ? Number(a.slice(0, 4 - b.length) + b) + 1 : from;
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
};
// Known nicknames the pattern can't reach.
const KNOWN: Record<string, string> = { 'Red Kerr': 'kerrjo01' };
const guess = (name: string) => {
  if (KNOWN[name]) return KNOWN[name];
  const parts = norm(name).split(' ');
  return `${parts.slice(1).join('').slice(0, 5)}${parts[0].slice(0, 2)}01`;
};

const todo = new Map<string, [string, string, boolean]>(); // name → [name, bbref id, guessed]
for (const p of pool) {
  if (todo.has(p.playerName)) continue;
  if (ids[p.playerName] && existsSync(`public/headshots/${ids[p.playerName]}.png`)) continue;
  const cands = byName.get(norm(p.playerName));
  if (cands) {
    const years = spanYears(p.spanLabel);
    const best = [...cands].sort((x, y) => years.filter((v) => y[1].has(v)).length - years.filter((v) => x[1].has(v)).length)[0];
    todo.set(p.playerName, [p.playerName, best[0], false]);
  } else todo.set(p.playerName, [p.playerName, guess(p.playerName), true]);
}
const list = [...todo.values()];
const template = readFileSync('scripts/fetch_bbref_headshots_browser.template.js', 'utf8');
writeFileSync('scripts/fetch_bbref_headshots_browser.js', template.replace('__PLAYERS__', JSON.stringify(list)));
console.log(`${list.length} players, ${list.filter((x) => x[2]).length} with a guessed id → scripts/fetch_bbref_headshots_browser.js`);
for (const [n, id] of list.filter((x) => x[2])) console.log(`  guess: ${n} → ${id}`);
