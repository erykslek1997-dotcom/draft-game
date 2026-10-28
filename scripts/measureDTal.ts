import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName } from '../src/data/schema';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { spanEndYears } from '../src/engine/era';

/**
 * 2026-10-28, weeks 2-3 step 1, second half: the game's D-TAL against what the real numbers say
 * about the same seasons — BBRef DBPM, STL%, BLK%, DRB% (1973-74 on) and NBA.com deflections and
 * contests a 36 minutes (2015-16 on). Not a verdict by itself (DBPM is a box-score estimate too),
 * a list of where to look: the spans whose D-TAL sits furthest from what the real numbers predict.
 *
 *   npx tsx scripts/measureDTal.ts [--min-mpg=20] [--top=25]
 *
 * Writes reports/dtal-vs-real.csv (every span) next to the printout.
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const MIN_MPG = Number(args['min-mpg'] ?? 20);
const TOP = Number(args.top ?? 25);
const root = resolve(import.meta.dirname, '..');

function csv(path: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(resolve(root, path), 'utf8').trim().split(/\r?\n/);
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const keys = split(head);
  return lines.map((l) => Object.fromEntries(split(l).map((v, i) => [keys[i], v])));
}
const endYear = (season: string) => parseInt(season.slice(0, 4), 10) + 1;

// BBRef: one line a player-season — the multi-team total ("2TM", "3TM", "TOT") when he moved.
interface Season { mp: number; g: number; dbpm: number; stl: number; blk: number; drb: number }
const bbref = new Map<string, Season>();
for (const r of csv('src/data/raw/bbref/player_advanced.csv')) {
  const k = `${normalizePlayerName(r.name_display)}|${endYear(r.SEASON)}`;
  const total = /^(\d+TM|TOT)$/.test(r.team_name_abbr);
  if (bbref.has(k) && !total) continue;
  const n = (x: string) => (x === '' ? NaN : Number(x));
  bbref.set(k, { mp: n(r.mp), g: n(r.games), dbpm: n(r.dbpm), stl: n(r.stl_pct), blk: n(r.blk_pct), drb: n(r.drb_pct) });
}
// NBA.com hustle: summed over a player's teams that season.
const hustle = new Map<string, { min: number; defl: number; cont: number }>();
for (const r of csv('src/data/raw/nbaStats/hustle_player.csv')) {
  const k = `${normalizePlayerName(r.PLAYER_NAME)}|${endYear(r.SEASON)}`;
  const h = hustle.get(k) ?? { min: 0, defl: 0, cont: 0 };
  h.min += Number(r.MIN);
  h.defl += Number(r.DEFLECTIONS);
  h.cont += Number(r.CONTESTED_SHOTS);
  hustle.set(k, h);
}

interface Row { id: string; name: string; span: string; pos: string; role: string; dtal: number; mpg: number; dbpm: number; stl: number; blk: number; drb: number; defl36: number; cont36: number }
const rows: Row[] = [];
for (const s of draftPool) {
  const name = normalizePlayerName(s.playerName);
  const seasons = spanEndYears(s.spanLabel).map((y) => bbref.get(`${name}|${y}`)).filter((x): x is Season => Boolean(x) && x!.mp > 0);
  if (!seasons.length) continue;
  const mp = seasons.reduce((a, x) => a + x.mp, 0);
  const w = (f: (x: Season) => number) => seasons.filter((x) => !isNaN(f(x))).reduce((a, x) => a + f(x) * x.mp, 0) / seasons.filter((x) => !isNaN(f(x))).reduce((a, x) => a + x.mp, 0);
  const hs = spanEndYears(s.spanLabel).map((y) => hustle.get(`${name}|${y}`)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const hMin = hs.reduce((a, x) => a + x.min, 0);
  rows.push({
    id: s.id,
    name: s.playerName,
    span: s.spanLabel,
    pos: s.primaryPosition,
    role: s.defensiveRole,
    dtal: computeDefensiveTalent(s),
    mpg: mp / seasons.reduce((a, x) => a + x.g, 0),
    dbpm: w((x) => x.dbpm),
    stl: w((x) => x.stl),
    blk: w((x) => x.blk),
    drb: w((x) => x.drb),
    defl36: hMin > 500 ? (36 * hs.reduce((a, x) => a + x.defl, 0)) / hMin : NaN,
    cont36: hMin > 500 ? (36 * hs.reduce((a, x) => a + x.cont, 0)) / hMin : NaN,
  });
}

// Least squares, D-TAL on the real numbers (all spans with them, at the minutes floor).
function solve(X: number[][], y: number[]): number[] {
  const k = X[0].length;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k + 1 }, (_, j) => (j < k ? X.reduce((s, r) => s + r[i] * r[j], 0) : X.reduce((s, r, n) => s + r[i] * y[n], 0))));
  for (let i = 0; i < k; i++) {
    const p = A[i][i];
    for (let j = i; j <= k; j++) A[i][j] /= p;
    for (let r = 0; r < k; r++) if (r !== i) for (let j = k; j >= i; j--) A[r][j] -= A[r][i] * A[i][j];
  }
  return A.map((r) => r[k]);
}
const corr = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => ((sxy += (x - mx) * (ys[i] - my)), (sxx += (x - mx) ** 2), (syy += (ys[i] - my) ** 2)));
  return sxy / Math.sqrt(sxx * syy);
};

const pool = rows.filter((r) => r.mpg >= MIN_MPG && [r.dbpm, r.stl, r.blk, r.drb].every((x) => !isNaN(x)));
const feats = (r: Row) => [1, r.dbpm, r.stl, r.blk, r.drb];
const beta = solve(pool.map(feats), pool.map((r) => r.dtal));
const predict = (r: Row) => feats(r).reduce((s, x, i) => s + x * beta[i], 0);
const pred = pool.map(predict);
console.log(`${pool.length} spans with BBRef numbers at ${MIN_MPG}+ mpg (of ${draftPool.length} in the pool)`);
console.log(`D-TAL ≈ ${beta[0].toFixed(1)} + ${beta[1].toFixed(2)}·DBPM + ${beta[2].toFixed(2)}·STL% + ${beta[3].toFixed(2)}·BLK% + ${beta[4].toFixed(2)}·DRB%   R² ${(corr(pred, pool.map((r) => r.dtal)) ** 2).toFixed(2)}`);
console.log('\nr with D-TAL:', (['dbpm', 'stl', 'blk', 'drb'] as const).map((k) => `${k} ${corr(pool.map((r) => r[k]), pool.map((r) => r.dtal)).toFixed(2)}`).join('  '));
const withH = pool.filter((r) => !isNaN(r.defl36));
const resid = (r: Row) => r.dtal - predict(r);
console.log(
  `2016+ spans with hustle (${withH.length}): r(D-TAL, deflections/36) ${corr(withH.map((r) => r.defl36), withH.map((r) => r.dtal)).toFixed(2)}, r(D-TAL, contests/36) ${corr(withH.map((r) => r.cont36), withH.map((r) => r.dtal)).toFixed(2)};` +
    ` r(what BBRef misses, deflections) ${corr(withH.map((r) => r.defl36), withH.map(resid)).toFixed(2)}, (contests) ${corr(withH.map((r) => r.cont36), withH.map(resid)).toFixed(2)}`,
);
console.log('\nBy position, mean D-TAL minus what BBRef predicts:');
for (const p of ['PG', 'SG', 'SF', 'PF', 'C']) {
  const g = pool.filter((r) => r.pos === p);
  console.log(`  ${p}  ${(g.reduce((s, r) => s + resid(r), 0) / g.length).toFixed(1).padStart(5)}  (${g.length})`);
}

const n1 = (x: number) => (isNaN(x) ? '  –  ' : x.toFixed(1).padStart(5));
const line = (r: Row) => `  ${resid(r) >= 0 ? '+' : ''}${resid(r).toFixed(0).padStart(3)}  D-TAL ${String(Math.round(r.dtal)).padStart(3)} (BBRef ${predict(r).toFixed(0).padStart(3)})  DBPM${n1(r.dbpm)} STL%${n1(r.stl)} BLK%${n1(r.blk)} DRB%${n1(r.drb)} defl${n1(r.defl36)} cont${n1(r.cont36)}  ${r.mpg.toFixed(0)}mpg  ${r.pos} ${r.name} ${r.span}`;
// One line a player: his span furthest from the fit.
const byPlayer = (sign: 1 | -1) => {
  const best = new Map<string, Row>();
  for (const r of pool) if (!best.has(r.name) || sign * resid(r) > sign * resid(best.get(r.name)!)) best.set(r.name, r);
  return [...best.values()].sort((a, b) => sign * (resid(b) - resid(a))).slice(0, TOP);
};
console.log(`\nD-TAL ABOVE the real numbers (game rates the defense higher), top ${TOP}:`);
byPlayer(1).forEach((r) => console.log(line(r)));
console.log(`\nD-TAL BELOW the real numbers (game rates the defense lower), top ${TOP}:`);
byPlayer(-1).forEach((r) => console.log(line(r)));

mkdirSync(resolve(root, 'reports'), { recursive: true });
const cols = ['name', 'span', 'pos', 'role', 'dtal', 'mpg', 'dbpm', 'stl', 'blk', 'drb', 'defl36', 'cont36'] as const;
writeFileSync(
  resolve(root, 'reports/dtal-vs-real.csv'),
  [[...cols, 'bbrefPredicted', 'gap'].join(','), ...rows.map((r) => [...cols.map((c) => (typeof r[c] === 'number' ? (r[c] as number).toFixed(2) : `"${r[c]}"`)), predict(r).toFixed(1), resid(r).toFixed(1)].join(','))].join('\n'),
);
console.log('\nsaved reports/dtal-vs-real.csv');
