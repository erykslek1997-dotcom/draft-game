/**
 * 2026-11-18 (the user: archetypes rebuilt for this engine from the ground up; start and finish at
 * 1997 where the data is complete): every window from 1996-97 on gets 0-100 on each skill — its
 * percentile among windows of its own era (middle year ±3, 15+ minutes a game), from the data that
 * measures that skill directly. Pre-1997 windows are left out (they keep their labels for now).
 *
 *   npx tsx scripts/buildSkills.ts            → src/data/skills.json  { spanId: { skill: 0-100 } }
 *   npx tsx scripts/buildSkills.ts --show     → plus a table of well-known players
 *
 * Each skill's raw read (per window, seasons weighted by minutes):
 *  attack
 *   selfCreation   usage × share of his makes unassisted
 *   handling       AST% less half his TOV%
 *   rimPressure    rim attempts a 36
 *   post           unassisted twos a 36 that are not at the rim (mid + post) — bigs and wings alike
 *   roll           assisted rim makes a 36, plus screen assists a 36 where tracked
 *   spotUp         assisted threes made a 36 × 3P%
 *   stretch        share of his shots from three × 3P% (the gravity a defense has to respect)
 *   offBall        off-ball movement share (offBallProfile)
 *   offGlass       ORB%
 *  defense
 *   rimProtect     BLK%, and where tracked how much worse opponents shoot at the rim against him and how many rim shots he contests
 *   pointOfAttack  STL% and deflections a 36 where tracked; matchup defense on guards
 *   activity       STL% + BLK% + deflections + loose balls
 *   help           DBPM minus what his blocks and steals explain (defensive Win Shares follow the team)
 *   defGlass       DRB%
 * A skill a window has no data for is left out of its record (the engine falls back to the label).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { realSpan } from '../src/engine/realAdvancedLookup';
import { estimatedMinutesPerGame } from '../src/engine/minutesPerGame';
import zoneData from '../src/data/awards/zoneEfficiency.json';
import selfData from '../src/data/awards/selfCreation.json';
import usageData from '../src/data/awards/usage.json';
import offBall from '../src/data/offBallProfile.json';

const FIRST = 1997;
type Row = Record<string, number | string>;
const index = (rows: Row[]) => {
  const m = new Map<string, Row>();
  for (const r of rows) m.set(`${normalizePlayerName(String(r.name))}|${parseInt(String(r.season).slice(0, 4), 10) + 1}`, r);
  return m;
};
const zone = index(zoneData as Row[]), self = index(selfData as Row[]), usage = index(usageData as Row[]);
const OFF = offBall as Record<string, [number, string]>;

/** Seasons of a window summed (counts) or minutes-weighted (rates). */
function seasonsOf(span: PlayerSpan) {
  const key = normalizePlayerName(span.playerName);
  return spanEndYears(span.spanLabel).map((y) => ({ z: zone.get(`${key}|${y}`), s: self.get(`${key}|${y}`), u: usage.get(`${key}|${y}`) }));
}
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function raw(span: PlayerSpan): Record<string, number | null> {
  const r = realSpan(span);
  const mpg = estimatedMinutesPerGame(span) ?? r?.mpg ?? null;
  const ss = seasonsOf(span);
  const zs = ss.map((x) => x.z).filter(Boolean) as Row[];
  const sum = (k: string) => zs.reduce((t, z) => t + (n(z[k]) ?? 0), 0);
  // Minutes in the zone seasons: games × mpg from the usage file where present.
  const zMin = ss.reduce((t, x) => t + (x.z && x.u ? (n(x.u.games) ?? 0) * (n(x.u.mpg) ?? 0) : 0), 0);
  const per36 = (v: number) => (zMin > 0 ? (v * 36) / zMin : null);
  const sw = ss.filter((x) => x.s);
  const unFg = sw.length ? sw.reduce((t, x) => t + (n(x.s!.unassistedFg) ?? 0), 0) / sw.length : null;
  const un2 = sw.length ? sw.reduce((t, x) => t + (n(x.s!.unassisted2Pt) ?? 0), 0) / sw.length : null;
  const un3 = sw.length ? sw.reduce((t, x) => t + (n(x.s!.unassisted3Pt) ?? 0), 0) / sw.length : null;
  const rimFga = sum('rimFga'), midFga = sum('midFga'), threeFga = sum('threeFga'), threeFgm = sum('threeFgm'), rimFgm = sum('rimFgm'), midFgm = sum('midFgm');
  const fga = rimFga + midFga + threeFga;
  const p3 = threeFga > 20 ? threeFgm / threeFga : null;
  const usg = n(r?.usg);
  const twoMakes = rimFgm + midFgm;
  return {
    selfCreation: usg !== null && unFg !== null ? usg * unFg : null,
    handling: n(r?.ast) !== null ? r!.ast! - 0.5 * (n(r?.tov) ?? 0) : null,
    rimPressure: zs.length ? per36(rimFga) : null,
    post: zs.length && un2 !== null && twoMakes > 0 ? per36(midFgm * un2 * 1) : null,
    roll: zs.length && un2 !== null ? (per36(rimFgm * (1 - un2)) ?? 0) + (n(r?.screenAssists36) ?? 0) * 0.5 : null,
    spotUp: zs.length && un3 !== null && p3 !== null ? (per36(threeFgm * (1 - un3)) ?? 0) * p3 : zs.length ? 0 : null,
    stretch: fga > 50 ? (threeFga / fga) * (p3 ?? 0.3) : null,
    offBall: OFF[span.id]?.[0] ?? null,
    offGlass: n(r?.orb),
    // rimDiff > 0: opponents shoot worse at the rim against him than expected (Gobert +11, Klay -3).
    rimProtect: n(r?.blk) !== null ? r!.blk! + (n(r?.rimDiff) ?? 0) * 0.15 + (n(r?.rimAttempts36) ?? 0) * 0.15 : null,
    pointOfAttack: n(r?.stl) !== null ? r!.stl! + (n(r?.deflections36) ?? 0) * 0.3 : null,
    activity: n(r?.stl) !== null && n(r?.blk) !== null ? r!.stl! + r!.blk! * 0.6 + (n(r?.deflections36) ?? 0) * 0.3 + (n(r?.looseBalls36) ?? 0) * 0.5 : null,
    // DBPM less what his blocks and steals already explain (defensive Win Shares follow the team).
    help: n(r?.dbpm) !== null ? r!.dbpm! - 0.25 * (n(r?.blk) ?? 0) - 0.4 * (n(r?.stl) ?? 0) : null,
    defGlass: n(r?.drb),
    _mpg: mpg,
  };
}

const mid = (s: PlayerSpan) => { const y = spanEndYears(s.spanLabel); return (y[0] + y[y.length - 1]) / 2; };
const windows = draftPool.filter((s) => { const y = spanEndYears(s.spanLabel); return y.length > 0 && Math.min(...y) >= FIRST; });
const raws = windows.map((s) => ({ s, m: mid(s), r: raw(s) }));
const SKILLS = Object.keys(raws[0].r).filter((k) => !k.startsWith('_'));
const out: Record<string, Record<string, number>> = {};
for (const { s, m, r } of raws) {
  const rec: Record<string, number> = {};
  for (const k of SKILLS) {
    const v = r[k];
    if (v === null) continue;
    const peers = raws.filter((q) => Math.abs(q.m - m) <= 3 && (q.r._mpg ?? 0) >= 15 && q.r[k] !== null).map((q) => q.r[k] as number);
    if (peers.length < 50) continue;
    rec[k] = Math.round((100 * peers.filter((x) => x < v).length) / peers.length);
  }
  out[s.id] = rec;
}
writeFileSync(resolve(import.meta.dirname, '../src/data/skills.json'), JSON.stringify(out));
const cover = Object.fromEntries(SKILLS.map((k) => [k, Object.values(out).filter((r) => k in r).length]));
console.log(`${windows.length} windows from ${FIRST - 1}-${String(FIRST).slice(2)} on; skills present:`, cover);
if (process.argv.includes('--show')) {
  const names = ['Stephen Curry', 'Klay Thompson', 'Draymond Green', "Shaquille O'Neal", 'Tim Duncan', 'Rudy Gobert', 'Steve Nash', 'Chris Paul', 'Kobe Bryant', 'LeBron James', 'Ben Wallace', 'Kawhi Leonard', 'Nikola Jokic', 'Kyle Korver', 'Tony Allen', 'Dirk Nowitzki', 'Russell Westbrook', 'Dwight Howard', 'Rajon Rondo', 'Bruce Bowen'];
  const head = SKILLS.map((k) => k.slice(0, 6).padStart(6)).join(' ');
  console.log('player'.padEnd(26), head);
  for (const nm of names) {
    const s = windows.filter((w) => normalizePlayerName(w.playerName) === normalizePlayerName(nm)).sort((a, b) => b.fga - a.fga)[0];
    if (!s) continue;
    console.log(`${nm} ${s.spanLabel}`.padEnd(26), SKILLS.map((k) => String(out[s.id][k] ?? '—').padStart(6)).join(' '));
  }
}
