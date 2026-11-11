/**
 * 2026-11-11 (the user: "łatwiej nabijać tym którzy grają w słabych zespołach"): do players on weak
 * teams pad their numbers? Same player, consecutive seasons, a whole season with one team each, the
 * team changing. Next season's BPM (and points per 36, TS%) on last season's, his age, and the change
 * in his team's strength WITHOUT him (team SRS less his own share: BPM x his minutes / 3,936, a
 * fifth of a season's minutes). A real "empty stats" effect shows as a negative coefficient: moving
 * to a better team costs numbers beyond aging and regression to the mean.
 *
 *   npx tsx scripts/teamContextPairs.ts
 */
import { readFileSync } from 'node:fs';
import { normalizePlayerName } from '../src/data/schema';

const csv = (path: string) => {
  const [head, ...lines] = readFileSync(path, 'utf8').replace(/\r/g, '').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => { const p = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, p[i]])); });
};
const srs = new Map<string, number>();
for (const r of csv('src/data/raw/bbref/team_advanced.csv')) srs.set(`${Number(r.SEASON.slice(0, 4)) + 1}|${r.team.replace(/\*/g, '').trim()}`, Number(r.srs));
// One team for the whole season (NBA.com minutes by team).
const teamsOf = new Map<string, { team: string; min: number }[]>();
for (const r of csv('src/data/raw/playerSeasonTeams.csv')) {
  const k = `${normalizePlayerName(r.name)}|${r.seasonEnd}`;
  teamsOf.set(k, [...(teamsOf.get(k) ?? []), { team: r.team, min: Number(r.minutes) }]);
}
const box = new Map<string, { pts: number; min: number; fga: number; fta: number }>();
for (const r of csv('src/data/raw/playerSeasonStats.csv')) {
  const k = `${normalizePlayerName(r.name)}|${r.seasonEnd}`;
  box.set(k, { pts: Number(r.points), min: Number(r.numMinutes), fga: Number(r.fieldGoalsAttempted), fta: Number(r.freeThrowsAttempted) });
}
const adv = new Map<string, { bpm: number; mp: number; age: number }>();
for (const r of csv('src/data/raw/bbref/player_advanced.csv')) {
  if (r.team_name_abbr === 'TOT' || /^\dTM$/.test(r.team_name_abbr)) continue;
  const k = `${normalizePlayerName(r.name_display)}|${Number(r.SEASON.slice(0, 4)) + 1}`;
  if (adv.has(k)) { adv.delete(k); continue; } // traded: skip
  adv.set(k, { bpm: Number(r.bpm), mp: Number(r.mp), age: Number(r.age) });
}
type Row = { y: number[]; x: number[] };
const rows: Record<'bpm' | 'pts36' | 'ts', Row[]> = { bpm: [], pts36: [], ts: [] };
let pairs = 0;
for (const [k, a] of adv) {
  const [name, ys] = k.split('|');
  const y = Number(ys);
  const b = adv.get(`${name}|${y + 1}`);
  const t0 = teamsOf.get(k), t1 = teamsOf.get(`${name}|${y + 1}`);
  if (!b || !t0 || !t1 || t0.length !== 1 || t1.length !== 1 || t0[0].team === t1[0].team) continue;
  if (a.mp < 1000 || b.mp < 1000) continue;
  const s0 = srs.get(`${y}|${t0[0].team}`), s1 = srs.get(`${y + 1}|${t1[0].team}`);
  if (s0 === undefined || s1 === undefined) continue;
  const ctx0 = s0 - (a.bpm * a.mp) / 3936, ctx1 = s1 - (b.bpm * b.mp) / 3936;
  const dctx = ctx1 - ctx0;
  const age = a.age, x0 = [1, age - 27, (age - 27) ** 2, dctx];
  rows.bpm.push({ y: [b.bpm], x: [...x0, a.bpm] });
  const p0 = box.get(k), p1 = box.get(`${name}|${y + 1}`);
  if (p0?.min && p1?.min) {
    rows.pts36.push({ y: [(36 * p1.pts) / p1.min], x: [...x0, (36 * p0.pts) / p0.min] });
    const ts = (p: { pts: number; fga: number; fta: number }) => p.pts / (2 * (p.fga + 0.44 * p.fta));
    rows.ts.push({ y: [100 * ts(p1)], x: [...x0, 100 * ts(p0)] });
  }
  pairs++;
}
function ols(data: Row[]) {
  const k = data[0].x.length;
  const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (const r of data) for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += r.x[i] * r.x[j]; A[i][k] += r.x[i] * r.y[0]; }
  const inv = A.map((row) => row.slice());
  for (let i = 0; i < k; i++) { const p = inv[i][i]; for (let j = i; j <= k; j++) inv[i][j] /= p; for (let r = 0; r < k; r++) if (r !== i) { const f = inv[r][i]; for (let j = i; j <= k; j++) inv[r][j] -= f * inv[i][j]; } }
  const beta = inv.map((r) => r[k]);
  const res = data.map((r) => r.y[0] - r.x.reduce((s, x, i) => s + x * beta[i], 0));
  const s2 = res.reduce((s, e) => s + e * e, 0) / (data.length - k);
  // Standard error of the context coefficient (index 3) via the diagonal of (X'X)^-1.
  const M = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => data.reduce((s, r) => s + r.x[i] * r.x[j], 0)));
  const I = M.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < k; i++) { const p = I[i][i]; for (let j = 0; j < 2 * k; j++) I[i][j] /= p; for (let r = 0; r < k; r++) if (r !== i) { const f = I[r][i]; for (let j = 0; j < 2 * k; j++) I[r][j] -= f * I[i][j]; } }
  return { beta, se: Math.sqrt(s2 * I[3][k + 3]), n: data.length };
}
console.log(`team-changing pairs: ${pairs}`);
for (const [label, data] of Object.entries(rows)) {
  const r = ols(data);
  console.log(`  ${label.padEnd(6)} n ${r.n}: per +1 SRS of team strength without him -> ${r.beta[3] >= 0 ? '+' : ''}${r.beta[3].toFixed(3)} (se ${r.se.toFixed(3)}, t ${(r.beta[3] / r.se).toFixed(1)}); carry-over of last season ${r.beta[4].toFixed(2)}`);
}
