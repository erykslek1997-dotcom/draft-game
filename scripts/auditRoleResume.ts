import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { computeTalent } from '../src/engine/talent';
import { spanEndYears } from '../src/engine/era';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import rapmData from '../src/data/awards/peakRapm.json';
import primeCareerData from '../src/data/raw/wowyrPrimeCareer.json';

/**
 * 2026-10-29 (the user: role players should be credited for (a) playing on strong teams and (b)
 * longevity — "proof he holds up in all-time conditions, not two good years on an average team who
 * never smelled the playoffs"; Derek Fisher, P.J. Tucker): a role player's career résumé — seasons
 * of 1,000+ minutes, and of those, seasons on a playoff team / a +4 SRS team — against how much his
 * peak RAPM and prime WOWYR sit over his TAL (the reverse fit, in TAL points).
 *
 *   npx tsx scripts/auditRoleResume.ts
 */
const key = (n: string) => normalizePlayerName(n).replace(/[^a-z0-9]+/g, ' ').trim();
const team = new Map((teamSeasons as { season: string; team: string; srs: number; playoffs: boolean }[]).map((t) => [`${Number(t.season.slice(0, 4)) + 1}|${t.team}`, t]));
type Car = { seasons: number; playoff: number; strong: number; srsMin: number; min: number; first: number };
const car = new Map<string, Car>();
const perSeason = new Map<string, { min: number; po: number; strong: number; srsMin: number }>();
for (const l of readFileSync(resolve(import.meta.dirname, '../src/data/raw/playerSeasonTeams.csv'), 'utf8').trim().split(/\r?\n/).slice(1)) {
  const m = l.match(/^(\d+),(.*),(\d{4}),(.*),(\d+),(\d+)$/); if (!m) continue;
  const name = key(m[2].replace(/^"|"$/g, '')), end = Number(m[3]), t = team.get(`${end}|${m[4].replace(/^"|"$/g, '')}`), min = Number(m[6]);
  const k = `${name}|${end}`; const ps = perSeason.get(k) ?? { min: 0, po: 0, strong: 0, srsMin: 0 };
  ps.min += min; if (t) { ps.srsMin += t.srs * min; if (t.playoffs) ps.po += min; if (t.srs >= 4) ps.strong += min; }
  perSeason.set(k, ps);
}
for (const [k, ps] of perSeason) {
  const [name, end] = k.split('|'); const c = car.get(name) ?? { seasons: 0, playoff: 0, strong: 0, srsMin: 0, min: 0, first: 9999 };
  c.first = Math.min(c.first, Number(end));
  if (ps.min >= 1000) { c.seasons++; if (ps.po >= ps.min / 2) c.playoff++; if (ps.strong >= ps.min / 2) c.strong++; }
  c.srsMin += ps.srsMin; c.min += ps.min; car.set(name, c);
}
export const careerResume = car;

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) byName.set(key(s.playerName), [...(byName.get(key(s.playerName)) ?? []), s]);
const best = (sp: PlayerSpan[]) => sp.reduce((a, b) => (computeTalent(b) > computeTalent(a) ? b : a));

function judge(label: string, pairs: { k: string; s: PlayerSpan; y: number }[]) {
  const xs = pairs.map((p) => computeTalent(p.s)), ys = pairs.map((p) => p.y);
  const mx = mean(xs), my = mean(ys); let a = 0, b = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; });
  const s = a / b;
  const rows = pairs.map((p, i) => ({ ...p, tal: xs[i], res: (p.y - (my + s * (xs[i] - mx))) / s, c: car.get(p.k) })).filter((r) => r.c && r.c.first >= 1975 && r.tal < 80 && r.tal >= 35);
  console.log(`\n${label}: ${rows.length} role players (TAL 35-79, careers from 1975). Mean (judge-implied TAL − TAL), + = TAL too low:`);
  const g = (lab: string, f: (r: (typeof rows)[number]) => string) => console.log(` by ${lab}:`, Object.entries(Object.groupBy(rows, f)).sort().map(([k, v]) => { const x = v!.map((r) => r.res), m = mean(x), se = Math.sqrt(mean(x.map((q) => (q - m) ** 2)) / x.length); return `${k} ${m.toFixed(1)}±${(1.64 * se).toFixed(1)} (n ${x.length})`; }).join(' · '));
  g('1000-min seasons', (r) => (r.c!.seasons <= 3 ? 'a ≤3' : r.c!.seasons <= 6 ? 'b 4-6' : r.c!.seasons <= 9 ? 'c 7-9' : 'd 10+'));
  g('of those on playoff teams', (r) => (r.c!.playoff <= 1 ? 'a 0-1' : r.c!.playoff <= 3 ? 'b 2-3' : r.c!.playoff <= 6 ? 'c 4-6' : 'd 7+'));
  g('on +4 SRS teams', (r) => (r.c!.strong === 0 ? 'a 0' : r.c!.strong <= 2 ? 'b 1-2' : r.c!.strong <= 4 ? 'c 3-4' : 'd 5+'));
  // Joint linear fit: residual on seasons and strong seasons.
  const X = rows.map((r) => [1, r.c!.seasons, r.c!.playoff, r.c!.strong]); const Y = rows.map((r) => r.res);
  const n = X[0].length, A = Array.from({ length: n }, () => Array(n + 1).fill(0));
  X.forEach((x, i) => { for (let p = 0; p < n; p++) { for (let q = 0; q < n; q++) A[p][q] += x[p] * x[q]; A[p][n] += x[p] * Y[i]; } });
  for (let p = 0; p < n; p++) { for (let r = p + 1; r < n; r++) { const f = A[r][p] / A[p][p]; for (let q = p; q <= n; q++) A[r][q] -= f * A[p][q]; } }
  const beta = Array(n).fill(0); for (let p = n - 1; p >= 0; p--) { let v = A[p][n]; for (let q = p + 1; q < n; q++) v -= A[p][q] * beta[q]; beta[p] = v / A[p][p]; }
  console.log(` joint fit, TAL points per season: 1000-min ${beta[1].toFixed(2)} · playoff ${beta[2].toFixed(2)} · +4 SRS ${beta[3].toFixed(2)} (const ${beta[0].toFixed(1)})`);
}
const rapm = (rapmData as { name: string; peakRapm: number }[]).flatMap((r) => { const k = key(r.name); const sp = (byName.get(k) ?? []).filter((s) => spanEndYears(s.spanLabel)[0] >= 1998); return sp.length ? [{ k, s: best(sp), y: r.peakRapm }] : []; });
judge('peak RAPM', rapm);
const wowy = (primeCareerData.rows as string[][]).flatMap((r) => { if (r[0].startsWith('np') || Number(r[2]) < 300) return []; const k = key(r[0].replace(/\./g, ' ')); const sp = byName.get(k); return sp ? [{ k, s: best(sp), y: Number(r[1]) }] : []; });
judge('prime WOWYR', wowy);

// Candidate lift: `perStrong` TAL a +4 SRS season, `perPlayoff` a playoff season past the third,
// capped at `cap`, faded over TAL 80-90. r against both judges before and after.
const LIFT = { perStrong: Number(process.env.PER_STRONG ?? 1.1), perPlayoff: Number(process.env.PER_PO ?? 0.5), cap: Number(process.env.CAP ?? 6) };
export const resumeLift = (k: string, tal: number) => {
  const c = car.get(k); if (!c || c.first < 1975) return 0;
  const raw = Math.min(LIFT.cap, LIFT.perStrong * c.strong + LIFT.perPlayoff * Math.max(0, c.playoff - 3));
  return raw * Math.min(1, Math.max(0, (90 - tal) / 10));
};
const rOf = (pairs: { k: string; s: PlayerSpan; y: number }[], lift: boolean) => {
  const xs = pairs.map((p) => { const t = computeTalent(p.s); return t + (lift ? resumeLift(p.k, t) : 0); }), ys = pairs.map((p) => p.y);
  const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return (a / Math.sqrt(b * c)).toFixed(3);
};
console.log(`\nlift ${JSON.stringify(LIFT)}: RAPM r ${rOf(rapm, false)} -> ${rOf(rapm, true)} · WOWYR r ${rOf(wowy, false)} -> ${rOf(wowy, true)}`);
for (const n of ['Derek Fisher', 'P.J. Tucker', 'Robert Horry', 'Bruce Bowen', 'Danny Green', 'Andre Iguodala', 'Shane Battier', 'Udonis Haslem', 'Steve Kerr', 'Tony Allen', 'Tree Rollins', 'Bobby Jones', 'Norm Van Lier', 'Brian Taylor', 'Charlie Ward', 'Bo Outlaw', 'Kendrick Perkins', 'Royce O\'Neale', 'Josh Okogie', 'Larry Smith', 'Michael Cooper', 'Jae Crowder', 'Kurt Rambis', 'A.C. Green', 'Ron Harper']) {
  const k = key(n), c = car.get(k), sp = byName.get(k); if (!c || !sp) { console.log(`  ${n}: -`); continue; }
  const b = best(sp), t = computeTalent(b);
  console.log(`  ${n.padEnd(17)} seasons ${String(c.seasons).padStart(2)} · playoff ${String(c.playoff).padStart(2)} · +4 SRS ${String(c.strong).padStart(2)} · best TAL ${t} (${b.spanLabel}) +${resumeLift(k, t).toFixed(1)}`);
}
