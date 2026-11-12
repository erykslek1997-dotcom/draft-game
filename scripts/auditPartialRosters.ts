/**
 * 2026-11-12 (the user: "co możemy jakkolwiek policzyć z dostępnych danych przed 1976"): a judge that
 * reaches back to 1951. Before 1974 not one real team has its top 8 in the card pool (the pool covers
 * ~40% of a 1960s team's minutes), so the full-team judges (auditMetrics, _defAudit) cannot run there.
 * This one needs only the carded players: per team-season, Σ minutes share × the player's value over
 * the carded players, read against the team's real number with the carded share as a second term
 * (y ~ a + b·Σshare·X + c·share), so the uncarded minutes count as "whatever the rest were".
 * The same judge runs on 1974+ so the eras are read on one ruler.
 *
 *   D-TAL vs relative DRtg (league mean − team, + = better), O-TAL vs relative ORtg, TAL vs SRS.
 *
 * Read a cell as "how much X adds over just knowing how many minutes went to carded players".
 *
 *   npx tsx scripts/auditPartialRosters.ts [--min=0.3] [--half=even|odd] [--players[=1951-1973]]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import pre74 from '../src/data/raw/bbref/team_ratings_pre1974.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { computeTalent, computeOffensiveTalent } from '../src/engine/talent';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']) as [string, string][]);
const MIN_SHARE = Number(args.min ?? 0.3);
const HALF = args.half as 'even' | 'odd' | undefined;

const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) {
  const k = normalizePlayerName(s.playerName);
  byName.set(k, [...(byName.get(k) ?? []), s]);
}
const spanFor = (name: string, endYear: number) =>
  (byName.get(normalizePlayerName(name)) ?? [])
    .filter((s) => spanEndYears(s.spanLabel).includes(endYear))
    .sort((a, b) => {
      const mid = (s: PlayerSpan) => {
        const ys = spanEndYears(s.spanLabel);
        return Math.abs(ys[Math.floor(ys.length / 2)] - endYear);
      };
      return mid(a) - mid(b);
    })[0];
const roster = readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/);
  return m ? { name: m[2].replace(/^"|"$/g, ''), end: Number(m[3]), team: m[4].replace(/^"|"$/g, ''), minutes: Number(m[6]) } : null;
}).filter((r): r is NonNullable<typeof r> => r !== null);
const byTeam = Object.groupBy(roster, (r) => `${r.end}|${r.team}`);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs), my = mean(ys);
  let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return a / Math.sqrt(b * c);
};
/** Least squares y ~ 1 + x1 + x2: the fit's r against y and the partial r of x1 given x2. */
function fit2(x1: number[], x2: number[], y: number[]) {
  const X = x1.map((v, i) => [1, v, x2[i]]);
  const k = 3;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, row) => s + row[i] * row[j], 0)));
  const b = Array.from({ length: k }, (_, i) => X.reduce((s, row, t) => s + row[i] * y[t], 0));
  for (let i = 0; i < k; i++) {
    const piv = A[i][i];
    for (let j = i; j < k; j++) A[i][j] /= piv;
    b[i] /= piv;
    for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i]; for (let j = i; j < k; j++) A[r][j] -= f * A[i][j]; b[r] -= f * b[i]; }
  }
  const r12 = corr(x1, x2), r1y = corr(x1, y), r2y = corr(x2, y);
  const partial = (r1y - r12 * r2y) / Math.sqrt((1 - r12 ** 2) * (1 - r2y ** 2));
  return { R: corr(X.map((row) => row.reduce((s, v, i) => s + v * b[i], 0)), y), partial, slope: b[1] };
}

type Real = { end: number; team: string; srs: number; relD: number | null; relO: number | null };
const reals: Real[] = [];
for (const [year, teams] of Object.entries(pre74 as Record<string, Record<string, { srs: number | null; def_rtg: number | null; off_rtg: number | null }>>)) {
  const end = Number(year);
  if (end < 1951 || end > 1973) continue;
  const ds = Object.values(teams).map((t) => t.def_rtg).filter((v): v is number => v != null);
  const os = Object.values(teams).map((t) => t.off_rtg).filter((v): v is number => v != null);
  for (const [team, t] of Object.entries(teams)) {
    if (t.srs == null) continue;
    reals.push({ end, team, srs: t.srs, relD: t.def_rtg != null && ds.length ? mean(ds) - t.def_rtg : null, relO: t.off_rtg != null && os.length ? t.off_rtg - mean(os) : null });
  }
}
type TS = { season: string; team: string; srs: number; ortg: number; drtg: number };
const post = teamSeasons as TS[];
const lg = Object.groupBy(post, (t) => t.season);
for (const t of post) {
  const g = lg[t.season]!;
  reals.push({ end: parseInt(t.season.slice(0, 4), 10) + 1, team: t.team, srs: t.srs, relD: mean(g.map((x) => x.drtg)) - t.drtg, relO: t.ortg - mean(g.map((x) => x.ortg)) });
}

const memo = new Map<PlayerSpan, [number, number, number]>();
const vals = (s: PlayerSpan) => {
  let v = memo.get(s);
  if (!v) memo.set(s, (v = [computeTalent(s), computeOffensiveTalent(s), computeDefensiveTalent(s)]));
  return v;
};
type Row = { end: number; label: string; who: { name: string; w: number; d: number }[]; share: number; tal: number; otal: number; dtal: number; srs: number; relD: number | null; relO: number | null };
const rows: Row[] = [];
for (const r of reals) {
  const all = byTeam[`${r.end}|${r.team}`] ?? [];
  const total = all.reduce((s, p) => s + p.minutes, 0);
  if (!total) continue;
  let share = 0, tal = 0, otal = 0, dtal = 0;
  const who: Row['who'] = [];
  for (const p of all) {
    const s = spanFor(p.name, r.end);
    if (!s) continue;
    const w = p.minutes / total;
    const [t, o, d] = vals(s);
    share += w; tal += w * t; otal += w * o; dtal += w * d;
    who.push({ name: s.playerName, w, d });
  }
  if (share < MIN_SHARE) continue;
  if (HALF && (r.end % 2 === 0) !== (HALF === 'even')) continue;
  rows.push({ end: r.end, label: `${r.end} ${r.team}`, who, share, tal, otal, dtal, srs: r.srs, relD: r.relD, relO: r.relO });
}

const ERAS: [string, number, number][] = [['1951-62', 1951, 1962], ['1963-73', 1963, 1973], ['1974-85', 1974, 1985], ['1986-2000', 1986, 2000], ['2001+', 2001, 2100]];
const f = (v: number) => v.toFixed(3);
console.log(`carded share ≥ ${MIN_SHARE}; per cell: fit R of y ~ Σshare·X + share, vs |r| of the carded share alone`);
console.log('era        n    share  D-TAL~relDRtg      O-TAL~relORtg      TAL~SRS');
for (const [name, a, b] of ERAS) {
  const g = rows.filter((x) => x.end >= a && x.end <= b);
  if (g.length < 12) continue;
  const cell = (pick: (x: Row) => number, y: (x: Row) => number | null) => {
    const h = g.filter((x) => y(x) != null);
    if (h.length < 12) return '      —          ';
    const q = fit2(h.map(pick), h.map((x) => x.share), h.map((x) => y(x)!));
    return `${f(q.R)} vs ${f(Math.abs(corr(h.map((x) => x.share), h.map((x) => y(x)!))))}`.padEnd(19);
  };
  console.log(`${name.padEnd(10)} ${String(g.length).padEnd(4)} ${f(mean(g.map((x) => x.share)))}  ${cell((x) => x.dtal, (x) => x.relD)}${cell((x) => x.otal, (x) => x.relO)}${cell((x) => x.tal, (x) => x.srs)}`);
}

// --players[=1951-1973]: what the team defenses say about the carded players, past their D-TAL. The
// residual of relative DRtg ~ Σshare·D-TAL + share, split over the carded players by ridge
// (minutes share × 5 as the weights, λ 6, as auditTeams does), per player over the period.
if (args.players) {
  const [a, b] = (args.players === 'true' || args.players === '1' ? '1951-1973' : args.players).split('-').map(Number);
  const g = rows.filter((x) => x.end >= a && x.end <= b && x.relD != null);
  const fitAll = (() => {
    const X = g.map((x) => [1, x.dtal, x.share]);
    const y = g.map((x) => x.relD!);
    const k = 3;
    const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s2, row) => s2 + row[i] * row[j], 0)));
    const bb = Array.from({ length: k }, (_, i) => X.reduce((s2, row, t) => s2 + row[i] * y[t], 0));
    for (let i = 0; i < k; i++) { const piv = A[i][i]; for (let j = i; j < k; j++) A[i][j] /= piv; bb[i] /= piv; for (let r2 = 0; r2 < k; r2++) if (r2 !== i) { const fct = A[r2][i]; for (let j = i; j < k; j++) A[r2][j] -= fct * A[i][j]; bb[r2] -= fct * bb[i]; } }
    return { b: bb, res: g.map((x, t) => y[t] - X[t].reduce((s2, v, i) => s2 + v * bb[i], 0)) };
  })();
  const LAMBDA = Number(args.lambda ?? 6);
  const ids = new Map<string, number>();
  for (const x of g) for (const p of x.who) if (!ids.has(p.name)) ids.set(p.name, ids.size);
  const n = ids.size;
  const M = Array.from({ length: n }, () => new Float64Array(n));
  const v = new Float64Array(n);
  const minutes = new Float64Array(n), dsum = new Float64Array(n), seasons = new Float64Array(n);
  g.forEach((x, t) => {
    for (const p of x.who) {
      const i = ids.get(p.name)!;
      v[i] += 5 * p.w * fitAll.res[t];
      minutes[i] += p.w; dsum[i] += p.w * p.d; seasons[i] += 1;
      for (const q of x.who) M[i][ids.get(q.name)!] += 25 * p.w * q.w;
    }
  });
  for (let i = 0; i < n; i++) M[i][i] += LAMBDA;
  // Gauss-Jordan on the ridge system
  for (let i = 0; i < n; i++) {
    const piv = M[i][i];
    for (let j = 0; j < n; j++) M[i][j] /= piv;
    v[i] /= piv;
    for (let r2 = 0; r2 < n; r2++) if (r2 !== i && M[r2][i] !== 0) { const fct = M[r2][i]; for (let j = 0; j < n; j++) M[r2][j] -= fct * M[i][j]; v[r2] -= fct * v[i]; }
  }
  const names = [...ids.keys()];
  const out = names.map((nm, i) => ({ nm, beta: v[i], seasons: seasons[i], share: minutes[i] / seasons[i], dtal: dsum[i] / minutes[i] })).filter((x) => x.seasons >= 4);
  out.sort((p, q) => q.beta - p.beta);
  console.log(`\n${a}-${b}: ${g.length} team-seasons; DRtg pts per D-TAL point ${fitAll.b[1].toFixed(3)} (×share); players with 4+ seasons: beta = DRtg pts a 100 trips beyond his D-TAL, per full-minutes season`);
  const line = (x: (typeof out)[number]) => `  ${x.nm.padEnd(24)} ${x.beta >= 0 ? '+' : ''}${x.beta.toFixed(2)}  D-TAL ${x.dtal.toFixed(0).padStart(3)}  seasons ${x.seasons}`;
  console.log('most above:'); out.slice(0, 15).forEach((x) => console.log(line(x)));
  console.log('most below:'); out.slice(-15).forEach((x) => console.log(line(x)));
  console.log(`(D-TAL points the 1-per-D-TAL-point slope makes of beta: ×${(1 / fitAll.b[1]).toFixed(1)})`);
}
