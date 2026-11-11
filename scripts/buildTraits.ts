/**
 * 2026-11-11 (the user: "może popracujemy nad takimi drobnymi elementami?" — Hustle, Clutch,
 * Microwave, Glue guy; Veteran is `veteran.ts`): card traits from data, each with a small, named
 * effect in the game. Output `src/data/playerTraits.json`: { [spanId]: trait[] }.
 *
 *  - Hustle: the hustle defenders' list (`hustleDefenders.ts`) within its years — its D-TAL bonus
 *    already runs; the trait only shows it.
 *  - Microwave: a bench scorer — over the window at least `MICRO.benchShare` of his games off the
 *    bench (BBRef games started, from 1981-82), `MICRO.minMpg`+ minutes and `MICRO.pts36`+ points per
 *    36; or a Sixth Man of the Year in the window.
 *  - Glue: his teams were much better with him on the floor than his box says — BBRef on-off
 *    (`plus_minus_net`, per 100, 1996-97 on) less his box impact (BPM), `GLUE.overBox`+ over
 *    `GLUE.minMinutes`+ minutes, and not a star (TAL under `GLUE.maxTal`).
 *  - Clutch: last five minutes of the fourth or overtime within five (NBA.com play-by-play from
 *    1996-97, `scripts/py/pbp_tendencies.py`): true shooting `CLUTCH.tsOver` above his own outside
 *    the clutch, shrunk by `CLUTCH.shrink` attempts, on `CLUTCH.minAttempts`+ clutch shots in the
 *    window (a go-to player) — one who gets better, not one who only shoots more.
 *
 *   npx tsx scripts/buildTraits.ts --deep=<bbref_deep (3).json> [--pbp=<pbp_all2.json>] [--out=src/data/playerTraits.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { resolveSourceName } from '../src/data/sourceNameResolver';
import { HUSTLE_DEFENDERS } from '../src/data/hustleDefenders';
import { spanEndYears } from '../src/engine/era';
import { displayTalentForSpan } from '../src/engine/grades';
import { tierContextWithSixthMan } from '../src/engine/sixthMan';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const MICRO = { benchShare: 0.6, minMpg: 18, pts36: 20 };
const GLUE = { overBox: Number(args.glue ?? 8), minMinutes: 3000, maxTal: 80 };
const CLUTCH = { tsOver: Number(args.clutch ?? 0.02), minAttempts: 120, shrink: 150 };

const csv = (path: string) => {
  const [head, ...lines] = readFileSync(path, 'utf8').replace(/\r/g, '').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => { const p = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, p[i]])); });
};
const add = <T>(m: Map<string, T>, k: string, f: (old: T | undefined) => T) => m.set(k, f(m.get(k)));

// Games and games started (BBRef), points and minutes (NBA.com), name|season-end.
const gs = new Map<string, { g: number; gs: number; awards: string; bpm: number; mp: number }>();
for (const r of csv('src/data/raw/bbref/player_advanced.csv')) {
  if (r.team_name_abbr === 'TOT' || /^\dTM$/.test(r.team_name_abbr)) continue;
  const y = Number(r.SEASON.slice(0, 4)) + 1;
  add(gs, `${resolveSourceName(r.name_display, y)}|${y}`, (o) => ({ g: (o?.g ?? 0) + Number(r.games || 0), gs: (o?.gs ?? 0) + Number(r.games_started || 0), awards: `${o?.awards ?? ''},${r.awards ?? ''}`, bpm: (o?.bpm ?? 0) + Number(r.bpm || 0) * Number(r.mp || 0), mp: (o?.mp ?? 0) + Number(r.mp || 0) }));
}
const box = new Map<string, { pts: number; min: number; g: number }>();
for (const r of csv('src/data/raw/playerSeasonStats.csv')) {
  const y = Number(r.seasonEnd);
  add(box, `${resolveSourceName(r.name, y)}|${y}`, (o) => ({ pts: (o?.pts ?? 0) + Number(r.points || 0), min: (o?.min ?? 0) + Number(r.numMinutes || 0), g: (o?.g ?? 0) + Number(r.games || 0) }));
}
// On-off (BBRef play-by-play table, per 100), minutes-weighted.
const onoff = new Map<string, { net: number; mp: number }>();
if (args.deep) {
  const deep = JSON.parse(readFileSync(args.deep, 'utf8')) as { tables: { pbp: Record<string, Record<string, string>[]> } };
  for (const [year, rows] of Object.entries(deep.tables.pbp)) {
    const y = Number(year);
    for (const r of rows) {
      if (!r.name_display || r.team_name_abbr === 'TOT' || /^\dTM$/.test(r.team_name_abbr ?? '')) continue;
      const net = Number(r.plus_minus_net), mp = Number(r.mp);
      if (!Number.isFinite(net) || !mp) continue;
      add(onoff, `${resolveSourceName(r.name_display, y)}|${y}`, (o) => ({ net: (o?.net ?? 0) + net * mp, mp: (o?.mp ?? 0) + mp }));
    }
  }
}
// Clutch and all shots (NBA.com play-by-play).
const pbp = args.pbp ? (JSON.parse(readFileSync(args.pbp, 'utf8')) as Record<string, { clutch?: number[] }>) : {};
const clutch = new Map<string, number[]>();
for (const [k, v] of Object.entries(pbp)) {
  if (!v.clutch) continue;
  const [name, y] = k.split('|');
  clutch.set(`${resolveSourceName(name, Number(y))}|${y}`, v.clutch);
}
const allShots = new Map<string, { fga: number; fta: number; pts: number }>();
for (const r of csv('src/data/raw/playerSeasonStats.csv')) {
  const y = Number(r.seasonEnd);
  add(allShots, `${resolveSourceName(r.name, y)}|${y}`, (o) => ({ fga: (o?.fga ?? 0) + Number(r.fieldGoalsAttempted || 0), fta: (o?.fta ?? 0) + Number(r.freeThrowsAttempted || 0), pts: (o?.pts ?? 0) + Number(r.points || 0) }));
}
/** Before play-by-play (1996-97): the legends of the last shot, all their windows before 1997. */
const CLUTCH_LEGENDS = new Set(['Jerry West', 'Larry Bird', 'Michael Jordan', 'John Havlicek', 'Sam Jones', 'Reggie Miller', 'Robert Horry'].map(normalizePlayerName));
const ts = (pts: number, fga: number, fta: number) => (fga + 0.44 * fta > 0 ? pts / (2 * (fga + 0.44 * fta)) : 0);

const out: Record<string, string[]> = {};
const lists: Record<string, string[]> = { Hustle: [], Microwave: [], Glue: [], Clutch: [] };
for (const s of draftPool) {
  const name = normalizePlayerName(s.playerName);
  const years = spanEndYears(s.spanLabel);
  const traits: string[] = [];
  const tal = displayTalentForSpan(tierContextWithSixthMan(s));
  // Hustle
  const h = HUSTLE_DEFENDERS.find((d) => normalizePlayerName(d.playerName) === name);
  if (h && years.some((y) => y >= h.from && y <= h.to)) traits.push('Hustle');
  // Microwave
  let g = 0, start = 0, pts = 0, min = 0, sixth = false, gsKnown = true;
  for (const y of years) {
    const a = gs.get(`${name}|${y}`), b = box.get(`${name}|${y}`);
    if (a) { g += a.g; start += a.gs; if (/6MOY-1\b/.test(a.awards)) sixth = true; if (y < 1982) gsKnown = false; }
    if (b) { pts += b.pts; min += b.min; }
  }
  const bench = g && gsKnown ? 1 - start / g : 0;
  const mpg = g ? min / g : 0;
  if (sixth || (bench >= MICRO.benchShare && mpg >= MICRO.minMpg && min && (36 * pts) / min >= MICRO.pts36)) traits.push('Microwave');
  // Glue
  let net = 0, mp = 0, bpm = 0, bmp = 0;
  for (const y of years) {
    const o = onoff.get(`${name}|${y}`);
    const a = gs.get(`${name}|${y}`);
    if (o && a?.mp) { net += o.net; mp += o.mp; bpm += a.bpm; bmp += a.mp; }
  }
  if (mp >= GLUE.minMinutes && bmp && net / mp - bpm / bmp >= GLUE.overBox && tal < GLUE.maxTal) traits.push('Glue');
  // Clutch
  const c = [0, 0, 0, 0, 0, 0, 0];
  let fga = 0, fta = 0, allPts = 0;
  for (const y of years) {
    const v = clutch.get(`${name}|${y}`);
    if (v) v.forEach((x, i) => (c[i] += x));
    const a = allShots.get(`${name}|${y}`);
    if (a) { fga += a.fga; fta += a.fta; allPts += a.pts; }
  }
  if (CLUTCH_LEGENDS.has(name) && Math.max(...years) < 1997) traits.push('Clutch');
  else if (c[1] >= CLUTCH.minAttempts) {
    const tsC = ts(c[6], c[1], c[5]);
    const tsRest = ts(allPts - c[6], fga - c[1], fta - c[5]);
    // Shrunk toward no difference by the sample (`shrink` attempts weigh as much as the data).
    const diff = ((tsC - tsRest) * c[1]) / (c[1] + CLUTCH.shrink);
    if (diff >= CLUTCH.tsOver) traits.push('Clutch');
  }
  if (traits.length) {
    out[s.id] = traits;
    for (const t of traits) lists[t].push(`${s.playerName} ${s.spanLabel}`);
  }
}
for (const [t, l] of Object.entries(lists)) console.log(`${t} (${l.length}): ${l.slice(0, 40).join(', ')}${l.length > 40 ? ' …' : ''}`);
if (args.out) writeFileSync(args.out, JSON.stringify(out));
