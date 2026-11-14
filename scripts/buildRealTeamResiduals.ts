/** Builds src/data/realTeamResiduals.json (run with REAL_RES=0 — the script sets it). Based on the out-of-sample check: do per-player ridge residuals (real SRS over Overall) learned on one half of
 * the seasons predict the other half? Prints Overall vs SRS r on the held-out half, before and after
 * adding k · Σ share·coef, for both splits. */
process.env.REAL_RES = '0';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { autoAssignRotation } from '../src/engine/rotation';
import { scoreTeam } from '../src/engine/scoring';
import type { Team } from '../src/engine/types';
const TOP = 8;
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) { const k = normalizePlayerName(s.playerName); byName.set(k, [...(byName.get(k) ?? []), s]); }
const spanFor = (name: string, endYear: number) => (byName.get(normalizePlayerName(name)) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(endYear)).sort((a, b) => { const mid = (s: PlayerSpan) => { const ys = spanEndYears(s.spanLabel); return Math.abs(ys[Math.floor(ys.length / 2)] - endYear); }; return mid(a) - mid(b); })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => { const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/); return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null; }).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const teamOf = (r: PlayerSpan[], id: string): Team => ({ id, name: id, draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) });
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (xs: number[], ys: number[]) => { const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; }); return a / Math.sqrt(b * c); };
type Row = { end: number; srs: number; ortg: number; drtg: number; ovr: number; off: number; def: number; names: string[]; share: number[] };
const rows: Row[] = [];
for (const ts of teamSeasons as { season: string; team: string; srs: number; ortg: number; drtg: number }[]) {
  const end = parseInt(ts.season.slice(0, 4), 10) + 1;
  const all = [...(byTeam[`${end}|${ts.team}`] ?? [])].sort((p, q) => q.minutes - p.minutes);
  const top = all.slice(0, TOP);
  const spans = top.map((r) => spanFor(r.name, end));
  if (top.length < TOP || spans.some((s) => !s)) continue;
  const total = all.reduce((s, r) => s + r.minutes, 0);
  const b = scoreTeam(teamOf(spans as PlayerSpan[], `${end}-${ts.team}`));
  rows.push({ end, srs: ts.srs, ortg: ts.ortg, drtg: ts.drtg, ovr: b.overallExact, off: b.offenseScore, def: b.defenseScore, names: (spans as PlayerSpan[]).map((s) => s.playerName), share: top.map((r) => (r.minutes / total) * 5) });
}
// League-centre ORtg / DRtg by season.
for (const [, g] of Object.entries(Object.groupBy(rows, (r) => String(r.end)))) { const mo = mean(g!.map((x) => x.ortg)), md = mean(g!.map((x) => x.drtg)); for (const x of g!) { x.ortg -= mo; x.drtg = md - x.drtg; } }
function ridge(train: Row[], y: (x: Row) => number, lambda: number): Map<string, number> {
  const ids = new Map<string, number>(); const names: string[] = [];
  for (const x of train) for (const n of x.names) if (!ids.has(n)) { ids.set(n, names.length); names.push(n); }
  const n = names.length; const XtX = new Map<string, number>(); const Xty = new Float64Array(n);
  for (const x of train) { const yy = y(x); const ent = x.names.map((nm, i) => [ids.get(nm)!, x.share[i]] as const); for (const [i, wi] of ent) { Xty[i] += wi * yy; for (const [j, wj] of ent) XtX.set(`${i},${j}`, (XtX.get(`${i},${j}`) ?? 0) + wi * wj); } }
  const b = new Float64Array(n); const nb: [number, number][][] = Array.from({ length: n }, () => []);
  for (const [k, v] of XtX) { const [i, j] = k.split(',').map(Number); if (i !== j) nb[i].push([j, v]); }
  for (let it = 0; it < 200; it++) for (let i = 0; i < n; i++) { let s = Xty[i]; for (const [j, v] of nb[i]) s -= v * b[j]; b[i] = s / ((XtX.get(`${i},${i}`) ?? 0) + lambda); }
  return new Map(names.map((nm, i) => [nm, b[i]]));
}

const LAMBDA = 6;
const sd = (v: number[]) => Math.sqrt(mean(v.map((q) => (q - mean(v)) ** 2)));
function coefs(score: (x: Row) => number, target: (x: Row) => number) {
  const r = corr(rows.map(score), rows.map(target));
  const slope = (r * sd(rows.map(target))) / sd(rows.map(score)), ms = mean(rows.map(score)), mt = mean(rows.map(target));
  return ridge(rows, (x) => target(x) - (mt + slope * (score(x) - ms)), LAMBDA);
}
const o = coefs((x) => x.off, (x) => x.ortg), d = coefs((x) => x.def, (x) => x.drtg);
const weight = new Map<string, number>();
for (const x of rows) x.names.forEach((n, i) => weight.set(n, (weight.get(n) ?? 0) + x.share[i]));
const out: Record<string, [number, number]> = {};
for (const [n, w] of weight) if (w >= 4) out[normalizePlayerName(n)] = [Math.round((o.get(n) ?? 0) * 100) / 100, Math.round((d.get(n) ?? 0) * 100) / 100];
writeFileSync(resolve(import.meta.dirname, '../src/data/realTeamResiduals.json'), JSON.stringify(out, null, 0) + '\n');
console.log(`${Object.keys(out).length} players from ${rows.length} team-seasons`);
for (const n of ['Reggie Miller', 'Jrue Holiday', 'Steve Nash', 'Kobe Bryant', 'Chris Paul']) console.log(n, out[normalizePlayerName(n)]);
