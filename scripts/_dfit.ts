// 2026-11-18: D-TAL skill weights fitted on real team defense (1998+): minutes-weighted team means of
// each defensive skill, split guards/wings vs bigs, regressed on real DRtg (season-centred) on even
// seasons, checked on odd — against the minutes-weighted D-TAL alone.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { skill } from '../src/engine/skills';
import '../src/engine/fit';
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) { const k = normalizePlayerName(s.playerName); byName.set(k, [...(byName.get(k) ?? []), s]); }
const spanFor = (name: string, end: number) => (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => { const m = (s: PlayerSpan) => { const y = spanEndYears(s.spanLabel); return Math.abs(y[Math.floor(y.length / 2)] - end); }; return m(a) - m(b); })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => { const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/); return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null; }).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const KEYS = ['pointOfAttack', 'help', 'activity', 'rimProtect', 'defGlass'] as const;
type R = { end: number; real: number; dtal: number; x: number[] };
const rows: R[] = [];
for (const ts of teamSeasons as { season: string; team: string; drtg: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  if (end < 1998) continue;
  const top = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((a, b) => b.minutes - a.minutes).slice(0, 9);
  const sp = top.map((r) => spanFor(r.name, end));
  if (top.length < 8 || sp.some((s) => !s || skill(s, 'pointOfAttack') === null)) continue;
  const tot = top.reduce((a, r) => a + r.minutes, 0);
  const x: number[] = [];
  for (const grp of [false, true]) for (const k of KEYS) x.push(top.reduce((a, r, i) => { const s = sp[i]!; const big = s.primaryPosition === 'PF' || s.primaryPosition === 'C'; return a + (big === grp ? (r.minutes / tot) * ((skill(s, k) ?? 50) - 50) : 0); }, 0));
  rows.push({ end, real: -ts.drtg, dtal: top.reduce((a, r, i) => a + (r.minutes / tot) * computeDefensiveTalent(sp[i]!), 0), x });
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
for (const g of Object.values(Object.groupBy(rows, (r) => String(r.end)))) { const m = mean(g!.map((r) => r.real)), md = mean(g!.map((r) => r.dtal)); for (const r of g!) { r.real -= m; r.dtal -= md; } }
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let s = 0, x = 0, y = 0; a.forEach((v, i) => { s += (v - ma) * (b[i] - mb); x += (v - ma) ** 2; y += (b[i] - mb) ** 2; }); return s / Math.sqrt(x * y); };
function ols(X: number[][], y: number[], lam = 1) { const k = X[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0)); X.forEach((x, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; A[i][k] += x[i] * y[n]; } }); for (let i = 1; i < k; i++) A[i][i] += lam; for (let c = 0; c < k; c++) for (let r = 0; r < k; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; } return A.map((row, i) => row[k] / row[i]); }
const even = rows.filter((r) => r.end % 2 === 0), odd = rows.filter((r) => r.end % 2 === 1);
console.log(`${rows.length} team-seasons 1998+ (even ${even.length}, odd ${odd.length})`);
console.log(`D-TAL alone: odd r ${corr(odd.map((r) => r.dtal), odd.map((r) => r.real)).toFixed(3)}`);
const names = [...KEYS.map((k) => 'g.' + k), ...KEYS.map((k) => 'b.' + k)];
const b = ols(even.map((r) => [1, ...r.x]), even.map((r) => r.real));
console.log(`skills alone (fit even): odd r ${corr(odd.map((r) => [1, ...r.x].reduce((s, v, i) => s + v * b[i], 0)), odd.map((r) => r.real)).toFixed(3)}`);
console.log('  weights (DRtg pts per skill point):', names.map((n, i) => `${n} ${b[i + 1].toFixed(3)}`).join(' · '));
const b2 = ols(even.map((r) => [1, r.dtal, ...r.x]), even.map((r) => r.real));
console.log(`D-TAL + skills: odd r ${corr(odd.map((r) => [1, r.dtal, ...r.x].reduce((s, v, i) => s + v * b2[i], 0)), odd.map((r) => r.real)).toFixed(3)}`);
console.log('  weights:', ['dtal', ...names].map((n, i) => `${n} ${b2[i + 1].toFixed(3)}`).join(' · '));
