/**
 * 2026-11-11 (the user: "a wiemy czy grali w słabych albo mocnych obronach?" → "da się to zrobić
 * oprócz metody na czuja?"): a player's defense read from his teams' defensive ratings, all
 * team-seasons at once. Each team-season is one equation:
 *
 *   league DRtg - team DRtg  =  sum over its players of  5 x (his minutes / team minutes) x beta
 *
 * so beta is a player's defensive points per 100 possessions against an average teammate. Ridge
 * (lambda) pulls players with few roster changes toward 0. Every trade, injury, debut and retirement
 * adds information without picking examples by hand.
 *
 * Validation first: the same fit on 1974-2000, where BBRef has DBPM, against each player's
 * minutes-weighted DBPM. Only if it agrees there is the pre-1974 fit (1951-1973) worth reading.
 *
 *   npx tsx scripts/teamDefenseRapm.ts [--from=1974 --to=2000] [--lambda=...] [--prior=1] [--minMin=4000]
 */
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const FROM = Number(args.from ?? 1974), TO = Number(args.to ?? 2000);
const MIN_MIN = Number(args.minMin ?? 4000);
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const csv = (path: string) => {
  const [head, ...lines] = readFileSync(path, 'utf8').replace(/\r/g, '').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => { const p = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, p[i]])); });
};

// Team defensive rating by season-end year and full team name.
const drtg = new Map<string, number>();
const pre = JSON.parse(readFileSync('src/data/raw/bbref/team_ratings_pre1974.json', 'utf8')) as Record<string, Record<string, { def_rtg: number | null }>>;
for (const [y, teams] of Object.entries(pre)) for (const [t, r] of Object.entries(teams)) if (r.def_rtg != null && Number(y) < 1974) drtg.set(`${y}|${t}`, r.def_rtg);
for (const r of csv('src/data/raw/bbref/team_advanced.csv')) {
  const y = Number(r.SEASON.slice(0, 4)) + 1;
  if (r.def_rtg) drtg.set(`${y}|${r.team.replace(/\*/g, '').trim()}`, Number(r.def_rtg));
}

// Minutes by team-season.
const rows = csv('src/data/raw/playerSeasonTeams.csv').filter((r) => Number(r.seasonEnd) >= FROM && Number(r.seasonEnd) <= TO && drtg.has(`${r.seasonEnd}|${r.team}`) && Number(r.minutes) > 0);
const teamSeasons = new Map<string, { y: number; players: { p: number; m: number }[] }>();
const playerIdx = new Map<string, number>(), names: string[] = [], playerMinutes: number[] = [];
for (const r of rows) {
  const key = `${r.seasonEnd}|${r.team}`;
  const name = norm(r.name);
  if (!playerIdx.has(name)) { playerIdx.set(name, names.length); names.push(r.name); playerMinutes.push(0); }
  const p = playerIdx.get(name)!;
  playerMinutes[p] += Number(r.minutes);
  const ts = teamSeasons.get(key) ?? { y: 0, players: [] };
  ts.players.push({ p, m: Number(r.minutes) });
  teamSeasons.set(key, ts);
}
const byYear = new Map<number, number[]>();
for (const k of teamSeasons.keys()) { const y = Number(k.split('|')[0]); byYear.set(y, [...(byYear.get(y) ?? []), drtg.get(k)!]); }
const lgAvg = new Map([...byYear].map(([y, v]) => [y, v.reduce((a, b) => a + b, 0) / v.length]));
const X: { idx: number[]; val: number[]; y: number }[] = [];
for (const [k, ts] of teamSeasons) {
  const total = ts.players.reduce((a, b) => a + b.m, 0);
  X.push({ idx: ts.players.map((q) => q.p), val: ts.players.map((q) => (5 * q.m) / total), y: lgAvg.get(Number(k.split('|')[0]))! - drtg.get(k)! });
}

// Optional prior: the player's own minutes-weighted DBPM is NOT used (that is the answer key);
// --prior=1 centres each player on 0 anyway. Kept as a hook for a box prior later.
const P = names.length;
function fit(lambda: number): Float64Array {
  // Conjugate gradient on (X'X + lambda I) b = X'y.
  const mul = (v: Float64Array) => {
    const out = new Float64Array(P);
    for (const r of X) { let s = 0; for (let i = 0; i < r.idx.length; i++) s += r.val[i] * v[r.idx[i]]; for (let i = 0; i < r.idx.length; i++) out[r.idx[i]] += r.val[i] * s; }
    for (let i = 0; i < P; i++) out[i] += lambda * v[i];
    return out;
  };
  const b = new Float64Array(P), rhs = new Float64Array(P);
  for (const r of X) for (let i = 0; i < r.idx.length; i++) rhs[r.idx[i]] += r.val[i] * r.y;
  let res = rhs.slice(), dir = res.slice(), rr = res.reduce((a, v) => a + v * v, 0);
  for (let it = 0; it < 500 && rr > 1e-10; it++) {
    const Ad = mul(dir); const alpha = rr / dir.reduce((a, v, i) => a + v * Ad[i], 0);
    for (let i = 0; i < P; i++) { b[i] += alpha * dir[i]; res[i] -= alpha * Ad[i]; }
    const rr2 = res.reduce((a, v) => a + v * v, 0);
    for (let i = 0; i < P; i++) dir[i] = res[i] + (rr2 / rr) * dir[i];
    rr = rr2;
  }
  return b;
}

// Answer key (1974 on): minutes-weighted DBPM per player over the same years.
const dbpm = new Map<string, [number, number]>();
for (const r of csv('src/data/raw/bbref/player_advanced.csv')) {
  const y = Number(r.SEASON.slice(0, 4)) + 1;
  if (y < FROM || y > TO || !r.dbpm || !r.mp || r.team_name_abbr === 'TOT' || /^\dTM$/.test(r.team_name_abbr)) continue;
  const k = norm(r.name_display); const a = dbpm.get(k) ?? [0, 0];
  dbpm.set(k, [a[0] + Number(r.dbpm) * Number(r.mp), a[1] + Number(r.mp)]);
}
const corr = (a: number[], b: number[]) => {
  const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
  let c = 0, va = 0, vb = 0; a.forEach((x, i) => { c += (x - ma) * (b[i] - mb); va += (x - ma) ** 2; vb += (b[i] - mb) ** 2; });
  return c / Math.sqrt(va * vb);
};

console.log(`${FROM}-${TO}: ${X.length} team-seasons, ${P} players (${playerMinutes.filter((m) => m >= MIN_MIN).length} with ${MIN_MIN}+ minutes)`);
const lambdas = args.lambda ? [Number(args.lambda)] : [0.5, 1, 2, 4, 8];
let best: Float64Array | null = null;
for (const lam of lambdas) {
  const b = fit(lam);
  const pairs = names.map((n, i) => ({ i, d: dbpm.get(norm(n)) })).filter((x) => x.d && playerMinutes[x.i] >= MIN_MIN);
  const r = pairs.length > 20 ? corr(pairs.map((x) => b[x.i]), pairs.map((x) => x.d![0] / x.d![1])) : NaN;
  console.log(`  lambda ${lam}: r vs DBPM ${Number.isNaN(r) ? 'n/a (no DBPM in these years)' : r.toFixed(2)} (n ${pairs.length}); spread sd ${Math.sqrt(names.reduce((a, _, i) => a + (playerMinutes[i] >= MIN_MIN ? b[i] ** 2 : 0), 0) / Math.max(1, playerMinutes.filter((m) => m >= MIN_MIN).length)).toFixed(2)}`);
  best = b;
}
const ranked = names.map((n, i) => ({ n, b: best![i], m: playerMinutes[i] })).filter((x) => x.m >= MIN_MIN).sort((a, b) => b.b - a.b);
console.log('\nTop 20:'); for (const x of ranked.slice(0, 20)) console.log(`  ${x.n.padEnd(24)} ${x.b >= 0 ? '+' : ''}${x.b.toFixed(2)}  (${Math.round(x.m)} min)`);
console.log('Bottom 10:'); for (const x of ranked.slice(-10)) console.log(`  ${x.n.padEnd(24)} ${x.b >= 0 ? '+' : ''}${x.b.toFixed(2)}`);
if (args.show) for (const s of args.show.split(';')) { const x = ranked.find((r) => norm(r.n) === norm(s)); console.log(`  ${s}: ${x ? `${x.b.toFixed(2)} (rank ${ranked.indexOf(x) + 1}/${ranked.length})` : '-'}`); }
// --dump=path: every player's beta and minutes in this fit, keyed by normalized name.
if (args.dump) {
  const out: Record<string, [number, number]> = {};
  names.forEach((n, i) => { out[norm(n)] = [Math.round(best![i] * 1000) / 1000, Math.round(playerMinutes[i])]; });
  (await import('node:fs')).writeFileSync(args.dump, JSON.stringify(out));
  console.log(`wrote ${names.length} players to ${args.dump}`);
}
