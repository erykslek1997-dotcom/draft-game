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
 *   handling       AST% × √(AST% / USG%) less half his TOV% (passing, not ball dominance)
 *   rimPressure    rim attempts a 36
 *   post           unassisted twos a 36 that are not at the rim (mid + post) — bigs and wings alike
 *   roll           assisted rim makes a 36, plus screen assists a 36 where tracked
 *   spotUp         assisted threes made a 36 × 3P%
 *   pullUp3        unassisted threes made a 36 × 3P% (off his own dribble)
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
import { realDefenseExcessDetail } from '../src/engine/darkoCorrection';
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
  const d = realDefenseExcessDetail(span);
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
    // 2026-11-18 (the user: "self creation a creation to dwie różne rzeczy"): AST% alone grows with
    // the ball in his hands (Iverson, Kobe read as playmakers) — weighed by how much of what he uses he
    // gives away (AST% / USG%), less half his TOV%.
    handling: n(r?.ast) !== null && n(r?.usg) ? r!.ast! * Math.sqrt(r!.ast! / r!.usg!) - 0.5 * (n(r?.tov) ?? 0) : null,
    rimPressure: zs.length ? per36(rimFga) : null,
    post: zs.length && un2 !== null && twoMakes > 0 ? per36(midFgm * un2 * 1) : null,
    roll: zs.length && un2 !== null ? (per36(rimFgm * (1 - un2)) ?? 0) + (n(r?.screenAssists36) ?? 0) * 0.5 : null,
    spotUp: zs.length && un3 !== null && p3 !== null ? (per36(threeFgm * (1 - un3)) ?? 0) * p3 : zs.length ? 0 : null,
    // 2026-11-18: threes he makes off his own dribble (unassisted 3PM a 36 × 3P%) — what spacing's
    // self-creation credit needs; self-creation as a whole lifted non-shooting bigs (Antoine Walker 33 → 76).
    pullUp3: zs.length && un3 !== null && p3 !== null ? (per36(threeFgm * un3) ?? 0) * p3 : zs.length ? 0 : null,
    stretch: fga > 50 ? (threeFga / fga) * (p3 ?? 0.3) : null,
    offBall: OFF[span.id]?.[0] ?? null,
    offGlass: n(r?.orb),
    // rimDiff > 0: opponents shoot worse at the rim against him than expected (Gobert +11, Klay -3).
    rimProtect: n(r?.blk) !== null ? r!.blk! + (n(r?.rimDiff) ?? 0) * 0.15 + (n(r?.rimAttempts36) ?? 0) * 0.15 : null,
    activity: n(r?.stl) !== null && n(r?.blk) !== null ? r!.stl! + r!.blk! * 0.6 + (n(r?.deflections36) ?? 0) * 0.3 + (n(r?.looseBalls36) ?? 0) * 0.5 : null,
    defGlass: n(r?.drb),
    _mpg: mpg,
    // Components for the two composite skills below (z-scored across windows, then combined).
    _stl: n(r?.stl), _blk: n(r?.blk), _drb: n(r?.drb), _defl: n(r?.deflections36), _c3: n(r?.contests3pt36),
    _matchup: d?.matchupDefense ?? null,
    // BPM2 left out (box-built: it rewards the very steals and rebounds `help` takes out — Jokic +3.9); matchup defense in.
    _impact: (() => { const v = [d?.onOffDdpm, d?.raptorDefense, d?.matchupDefense].filter((x): x is number => typeof x === 'number' && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })(),
  };
}

const mid = (s: PlayerSpan) => { const y = spanEndYears(s.spanLabel); return (y[0] + y[y.length - 1]) / 2; };
const windows = draftPool.filter((s) => { const y = spanEndYears(s.spanLabel); return y.length > 0 && Math.min(...y) >= FIRST; });
const raws = windows.map((s) => ({ s, m: mid(s), r: raw(s) }));
// 2026-11-18 (the user: point of attack and help "zdecydowanie do poprawki" — Klay 37 on steals alone,
// Jokic / Westbrook ~100 on DBPM's rebounds):
//  pointOfAttack  mean of the z-scores he has of: STL% (x1), deflections a 36 (x1), three-point contests
//                 a 36 (x0.7), matchup defense 2018+ (x1.5) — a stopper who rarely steals still reads
//  help           defensive impact (mean of on/off, RAPTOR, matchup defense) less the part his steals,
//                 blocks and defensive rebounds explain (least squares over the windows): positioning,
//                 help and rotations
const zOf = (k: string) => { const v = raws.map((q) => q.r[k]).filter((x): x is number => x !== null); const m = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; return (x: number | null) => (x === null ? null : (x - m) / sd); };
const Z = Object.fromEntries(['_stl', '_blk', '_drb', '_defl', '_c3', '_matchup', '_impact'].map((k) => [k, zOf(k)]));
for (const q of raws) {
  const parts = ([['_stl', 1], ['_defl', 1], ['_c3', 0.7], ['_matchup', 1.5]] as const).map(([k, w]) => [Z[k](q.r[k]), w] as const).filter(([z]) => z !== null) as [number, number][];
  q.r.pointOfAttack = parts.length ? parts.reduce((t, [z, w]) => t + z * w, 0) / parts.reduce((t, [, w]) => t + w, 0) : null;
}
{
  const rows = raws.filter((q) => q.r._impact !== null && q.r._stl !== null && q.r._blk !== null && q.r._drb !== null);
  const X = rows.map((q) => [1, Z._stl(q.r._stl)!, Z._blk(q.r._blk)!, Z._drb(q.r._drb)!]), y = rows.map((q) => Z._impact(q.r._impact)!);
  const k = 4, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((x, i) => { for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += x[a] * x[b]; A[a][k] += x[a] * y[i]; } });
  for (let c = 0; c < k; c++) { for (let r2 = 0; r2 < k; r2++) { if (r2 === c) continue; const f = A[r2][c] / A[c][c]; for (let j = c; j <= k; j++) A[r2][j] -= f * A[c][j]; } }
  const b = A.map((row, i) => row[k] / row[i]);
  console.log('help: impact explained by stl / blk / drb (z):', b.slice(1).map((v) => v.toFixed(2)).join(' / '));
  for (const q of raws) q.r.help = q.r._impact === null || q.r._stl === null || q.r._blk === null || q.r._drb === null ? null : Z._impact(q.r._impact)! - (b[0] + b[1] * Z._stl(q.r._stl)! + b[2] * Z._blk(q.r._blk)! + b[3] * Z._drb(q.r._drb)!);
}
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
