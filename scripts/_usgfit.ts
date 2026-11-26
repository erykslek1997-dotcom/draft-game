// 2026-11-26 (center calibration): pre-1977-78 windows have no USG%; fit USG% on windows that do, from
// points a 36 minutes relative to the league (+ assists), to estimate it where it is missing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { realSpan } from '../src/engine/realAdvancedLookup';
import { usageForSpan } from '../src/engine/usageLookup';
import { estimatedMinutesPerGame } from '../src/engine/minutesPerGame';
import { spanEndYears } from '../src/engine/era';
const [h, ...ls] = readFileSync(resolve('src/data/raw/leagueAverages.csv'), 'utf8').trim().split('\n'); const c = h.split(',');
const lg = new Map<number, number>(); for (const l of ls) { const r = Object.fromEntries(c.map((k, i) => [k, l.split(',')[i]])); if (r.lg_id === 'NBA' && r.pts_per_g) lg.set(Number(r.season.slice(0, 4)) + 1, Number(r.pts_per_g)); }
const rows: number[][] = [];
for (const s of draftPool) {
  const y = spanEndYears(s.spanLabel); const mid = y[Math.floor(y.length / 2)];
  const u = usageForSpan(s)?.usgPct ?? ((realSpan(s) as { usg?: number } | null)?.usg ?? NaN) / 100;
  const mpg = estimatedMinutesPerGame(s); const L = lg.get(mid);
  if (!Number.isFinite(u) || !mpg || mpg < 15 || !L) continue;
  rows.push([u, (s.box.ppg * 36 / mpg) / L, (s.box.apg * 36 / mpg), mid]);
}
const fit = (R: number[][]) => { const n = R.length; const X = R.map((r) => [1, r[1], r[2]]); const k = 3; const A = Array.from({ length: k }, () => new Array(k + 1).fill(0)); X.forEach((x, i) => { for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += x[a] * x[b]; A[a][k] += x[a] * R[i][0]; } }); for (let col = 0; col < k; col++) { let p = col; for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r; [A[col], A[p]] = [A[p], A[col]]; for (let r = 0; r < k; r++) { if (r === col) continue; const f = A[r][col] / A[col][col]; for (let j = col; j <= k; j++) A[r][j] -= f * A[col][j]; } } return A.map((row, i) => row[k] / row[i]); };
const early = rows.filter((r) => r[3] < 1997), late = rows.filter((r) => r[3] >= 1997);
const corr = (a: number[], b: number[]) => { const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length; let ab = 0, aa = 0, bb = 0; a.forEach((v, i) => { ab += (v - ma) * (b[i] - mb); aa += (v - ma) ** 2; bb += (b[i] - mb) ** 2; }); return ab / Math.sqrt(aa * bb); };
const bl = fit(late); console.log('n', rows.length, 'coef (fit 1997+)', bl.map((x) => x.toFixed(4)).join(' '), '| hold-out r on 1978-96:', corr(early.map((r) => bl[0] + bl[1] * r[1] + bl[2] * r[2]), early.map((r) => r[0])).toFixed(3));
const ba = fit(rows); console.log('coef (all)', ba.map((x) => x.toFixed(4)).join(' '));
