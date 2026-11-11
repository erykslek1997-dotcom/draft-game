/**
 * 2026-11-11 (the user: "pobieraj wszystko"): the play-by-play habits of each pool window, for the
 * live game. Input: `scripts/py/pbp_tendencies.py`'s per player-season counts (NBA.com pbp from
 * 1996-97). Output `src/data/pbpHabits.json`:
 *
 *   spans:   { [spanId]: [transition %, late-possession %] } of the window's made field goals;
 *   league:  [transition %, late %] over all of them, the reference the game scales by;
 *   passers: { [player key]: { [passer key]: assists } } — a career's top passers to him, both in
 *            the pool, so a real duo in a drafted five finds each other more often.
 *
 *   npx tsx scripts/buildPbpHabits.ts <pbp_all.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { draftPool } from '../src/data/draftPool';
import { resolveSourceName } from '../src/data/sourceNameResolver';
import { normalizePlayerName } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';

const raw = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, { made: number; trans: number; late: number; passers: Record<string, number> }>;
const MIN_MADE = 60;
const MIN_DUO = 40;

const seasons = new Map<string, { made: number; trans: number; late: number }>();
const duo = new Map<string, Map<string, number>>();
let lm = 0, lt = 0, ll = 0;
for (const [k, v] of Object.entries(raw)) {
  const [name, y] = k.split('|');
  const end = Number(y);
  const key = resolveSourceName(name, end);
  seasons.set(`${key}|${end}`, v);
  lm += v.made; lt += v.trans; ll += v.late;
  for (const [p, c] of Object.entries(v.passers)) {
    const pk = resolveSourceName(p, end);
    const m = duo.get(key) ?? new Map<string, number>();
    m.set(pk, (m.get(pk) ?? 0) + c);
    duo.set(key, m);
  }
}

const inPool = new Set(draftPool.map((s) => normalizePlayerName(s.playerName)));
const spans: Record<string, [number, number]> = {};
for (const s of draftPool) {
  const years = spanEndYears(s.spanLabel);
  if (Math.max(...years) < 1997) continue;
  const name = normalizePlayerName(s.playerName);
  let made = 0, trans = 0, late = 0;
  for (const y of years) {
    const v = seasons.get(`${name}|${y}`);
    if (v) { made += v.made; trans += v.trans; late += v.late; }
  }
  if (made >= MIN_MADE) spans[s.id] = [Math.round((100 * trans) / made), Math.round((100 * late) / made)];
}
const passers: Record<string, Record<string, number>> = {};
for (const [k, m] of duo) {
  if (!inPool.has(k)) continue;
  const top = [...m].filter(([p, c]) => c >= MIN_DUO && inPool.has(p) && p !== k).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (top.length) passers[k] = Object.fromEntries(top);
}
const league: [number, number] = [Math.round((1000 * lt) / lm) / 10, Math.round((1000 * ll) / lm) / 10];
writeFileSync('src/data/pbpHabits.json', JSON.stringify({ league, spans, passers }));
console.log(`league transition ${league[0]}%, late ${league[1]}%; ${Object.keys(spans).length} windows, ${Object.keys(passers).length} players with pool duos`);
for (const n of ['karl malone', 'amare stoudemire', 'shaquille oneal', 'kevin durant', 'russell westbrook', 'dirk nowitzki']) console.log(`  ${n}:`, passers[n]);
