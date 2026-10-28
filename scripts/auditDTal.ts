import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import teamSeasons from '../src/data/awards/teamSeasons.json';
import { draftPool } from '../src/data/draftPool';
import { normalizePlayerName, type PlayerSpan, type Position } from '../src/data/schema';
import { resolveSourceName } from '../src/data/sourceNameResolver';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { spanEndYears } from '../src/engine/era';
import '../src/engine/fit'; // registers the neighbour windows D-TAL blends with
import { realSpan } from '../src/engine/realAdvancedLookup';
import { HUSTLE_DEFENDERS } from '../src/data/hustleDefenders';

/**
 * 2026-10-28, weeks 2-3 step 3 (the D-TAL audit, replacing the unclear "Fix B"): D-TAL against the
 * one judge that is not itself a box-score estimate — how well real teams defended. For every
 * team-season 1973-74 on (BBRef DRtg over the league's, `teamSeasons.json`), the minutes-weighted
 * D-TAL of its players (each as his pool span centred on that season, minutes from
 * `raw/playerSeasonTeams.csv`). Then, per player, a ridge fit of what the team defense did beyond
 * what its D-TAL predicted: a player whose teams keep defending better than his D-TAL says is
 * under-rated, and the other way round.
 *
 *   npx tsx scripts/auditDTal.ts [--lambda=4] [--top=25] [--from=1974]
 *
 * Writes reports/dtal-audit.csv (one line a player).
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const LAMBDA = Number(args.lambda ?? 4);
const TOP = Number(args.top ?? 25);
const FROM = Number(args.from ?? 1974);
const MIN_COVERED = 0.8;
const root = resolve(import.meta.dirname, '..');

const TEAM_ALIAS: Record<string, string> = { 'LA Clippers': 'Los Angeles Clippers', 'Oklahoma City Hornets': 'New Orleans/Oklahoma City Hornets' };
const seasonOf = (end: number) => `${end - 1}-${String(end).slice(2)}`;

// Pool spans by player, the one centred on a season first.
const byName = new Map<string, PlayerSpan[]>();
for (const s of draftPool) {
  const k = normalizePlayerName(s.playerName);
  byName.set(k, [...(byName.get(k) ?? []), s]);
}
// `--positions=reports/position-review.json`: rate each span at the position proposed there instead
// of its tag (a copy of the span under a new id, so nothing cached for the tagged one is reused).
const proposed = new Map<string, Position>();
if (args.positions)
  for (const p of JSON.parse(readFileSync(resolve(root, args.positions), 'utf8')) as { name: string; spans: { label: string; proposal: Position }[] }[])
    for (const s of p.spans) proposed.set(`${p.name}|${s.label}`, s.proposal);
const asProposed = (s: PlayerSpan): PlayerSpan => {
  const to = proposed.get(`${s.playerName}|${s.spanLabel}`);
  if (!to || to === s.primaryPosition) return s;
  return { ...s, id: `${s.id}~${to}`, primaryPosition: to, secondaryPositions: [s.primaryPosition, ...s.secondaryPositions.filter((p) => p !== to && p !== s.primaryPosition)] };
};
const spanForTagged = (name: string, end: number) => {
  const offCentre = (s: PlayerSpan) => {
    const ys = spanEndYears(s.spanLabel);
    return Math.abs(ys[Math.floor(ys.length / 2)] - end);
  };
  return (byName.get(name) ?? []).filter((s) => spanEndYears(s.spanLabel).includes(end)).sort((a, b) => offCentre(a) - offCentre(b))[0];
};
const spanFor = (name: string, end: number) => {
  const s = spanForTagged(name, end);
  return s && asProposed(s);
};

// Player minutes by team-season.
interface Stint { name: string; minutes: number; span?: PlayerSpan }
const rosters = new Map<string, Stint[]>();
{
  const [head, ...lines] = readFileSync(resolve(root, 'src/data/raw/playerSeasonTeams.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
  const cols = head.split(',');
  const at = (c: string) => cols.indexOf(c);
  for (const line of lines) {
    const f = line.split(',');
    const end = Number(f[at('seasonEnd')]);
    if (end < FROM) continue;
    const minutes = Number(f[at('minutes')]);
    if (!minutes) continue;
    const team = TEAM_ALIAS[f[at('team')]] ?? f[at('team')];
    const name = resolveSourceName(f[at('name')], end);
    const k = `${seasonOf(end)}|${team}`;
    rosters.set(k, [...(rosters.get(k) ?? []), { name, minutes, span: spanFor(name, end) }]);
  }
}

const league = new Map<string, number>();
for (const [season, rows] of Object.entries(Object.groupBy(teamSeasons as { season: string; drtg: number }[], (r) => r.season)))
  league.set(season, rows!.reduce((s, r) => s + r.drtg, 0) / rows!.length);

interface TeamRow { key: string; season: string; relDrtg: number; dtal: number; dbpm: number; players: { name: string; share: number; span: PlayerSpan }[] }
const teams: TeamRow[] = [];
let skipped = 0;
for (const t of teamSeasons as { season: string; team: string; drtg: number }[]) {
  const end = parseInt(t.season.slice(0, 4), 10) + 1;
  if (end < FROM) continue;
  const roster = rosters.get(`${t.season}|${t.team}`);
  if (!roster) {
    skipped++;
    continue;
  }
  const total = roster.reduce((s, p) => s + p.minutes, 0);
  const covered = roster.filter((p): p is Stint & { span: PlayerSpan } => Boolean(p.span));
  const coveredMin = covered.reduce((s, p) => s + p.minutes, 0);
  if (coveredMin / total < MIN_COVERED) {
    skipped++;
    continue;
  }
  const dbpmOf = (s: PlayerSpan) => realSpan(s)?.dbpm ?? 0;
  teams.push({
    key: `${t.season} ${t.team}`,
    season: t.season,
    relDrtg: t.drtg - league.get(t.season)!,
    dtal: covered.reduce((s, p) => s + p.minutes * computeDefensiveTalent(p.span), 0) / coveredMin,
    dbpm: covered.reduce((s, p) => s + p.minutes * dbpmOf(p.span), 0) / coveredMin,
    players: covered.map((p) => ({ name: p.name, share: (5 * p.minutes) / total, span: p.span })),
  });
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    sxy += (x - mx) * (ys[i] - my);
    sxx += (x - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  });
  return { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, intercept: my - (sxy / sxx) * mx };
};

const y = teams.map((t) => t.relDrtg);
const byD = corr(teams.map((t) => t.dtal), y);
const byB = corr(teams.map((t) => t.dbpm), y);
console.log(`${teams.length} team-seasons ${FROM}+ (${skipped} skipped: under ${100 * MIN_COVERED}% of minutes in the pool)`);
console.log(`Team defense (DRtg over league, lower = better) vs minutes-weighted:`);
console.log(`  D-TAL  r ${(-byD.r).toFixed(3)}  (${byD.slope.toFixed(2)} DRtg a D-TAL point)${proposed.size ? `; player-seasons rated at a proposed position: ${teams.reduce((n, t) => n + t.players.filter((p) => p.span.id.includes('~')).length, 0)}` : ''}`);
console.log(`  DBPM   r ${(-byB.r).toFixed(2)}`);
for (const [label, lo, hi] of [['1974-1996', 1974, 1996], ['1997-2013', 1997, 2013], ['2014-2026', 2014, 2026]] as const) {
  const g = teams.filter((t) => {
    const e = parseInt(t.season.slice(0, 4), 10) + 1;
    return e >= lo && e <= hi;
  });
  console.log(`  ${label}: D-TAL r ${(-corr(g.map((t) => t.dtal), g.map((t) => t.relDrtg)).r).toFixed(2)}, DBPM r ${(-corr(g.map((t) => t.dbpm), g.map((t) => t.relDrtg)).r).toFixed(2)}  (${g.length})`);
}

// Ridge, per player over his whole career: the team defense beyond what D-TAL predicted.
const residual = teams.map((t) => t.relDrtg - (byD.intercept + byD.slope * t.dtal));
const names = [...new Set(teams.flatMap((t) => t.players.map((p) => p.name)))];
const idx = new Map(names.map((n, i) => [n, i]));
function ridge(use: (ti: number) => boolean): Float64Array {
  const beta = new Float64Array(names.length);
  const cols: { t: number; x: number }[][] = names.map(() => []);
  teams.forEach((t, ti) => {
    if (use(ti)) t.players.forEach((p) => cols[idx.get(p.name)!].push({ t: ti, x: p.share }));
  });
  const r = Float64Array.from(residual);
  for (let it = 0; it < 60; it++) {
    for (let j = 0; j < names.length; j++) {
      let num = 0;
      let den = LAMBDA;
      for (const { t, x } of cols[j]) {
        num += x * (r[t] + x * beta[j]);
        den += x * x;
      }
      const nb = num / den;
      const d = nb - beta[j];
      if (d !== 0) for (const { t, x } of cols[j]) r[t] -= x * d;
      beta[j] = nb;
    }
  }
  return beta;
}
const beta = ridge(() => true);
// Reliability: the same fit on odd and on even seasons alone, compared player by player.
const endOf = (ti: number) => parseInt(teams[ti].season.slice(0, 4), 10) + 1;
const odd = ridge((ti) => endOf(ti) % 2 === 1);
const even = ridge((ti) => endOf(ti) % 2 === 0);

// One line a player: his minutes-weighted D-TAL over the team-seasons counted, and the ridge read.
interface P { name: string; adj: number; exposure: number; dtal: number; pos: string; role: string; mpg: number; dbpm: number; seasons: number; spans: Set<string> }
const players = new Map<string, P>();
for (const t of teams)
  for (const p of t.players) {
    const q = players.get(p.name) ?? { name: p.span.playerName, adj: beta[idx.get(p.name)!], exposure: 0, dtal: 0, pos: p.span.primaryPosition, role: p.span.defensiveRole, mpg: 0, dbpm: 0, seasons: 0, spans: new Set<string>() };
    const real = realSpan(p.span);
    q.dtal += p.share * computeDefensiveTalent(p.span);
    q.mpg += p.share * (real?.mpg ?? 0);
    q.dbpm += p.share * (real?.dbpm ?? 0);
    q.exposure += p.share;
    q.seasons++;
    q.spans.add(p.span.spanLabel);
    players.set(p.name, q);
  }
for (const q of players.values()) {
  q.dtal /= q.exposure;
  q.mpg /= q.exposure;
  q.dbpm /= q.exposure;
}
// In D-TAL points: a full-time player (share 1) moves the team average by d/5, worth slope·d/5 DRtg.
const toDtal = (adj: number) => (5 * adj) / byD.slope;
// `--skip-named`: leave out players whose D-TAL carries a hand-made adjustment (named bonus or floor,
// the hustle-defender list) — the team results can't see the reasons behind those, and for some of
// them (Marion: weak Phoenix defenses around him) team results are the wrong judge by construction.
const NAMED = new Set(
  ['Shawn Marion', 'Klay Thompson', 'Toumani Camara', 'Bill Russell', 'Wilt Chamberlain', ...HUSTLE_DEFENDERS.map((h) => h.playerName)].map(normalizePlayerName),
);
const regular = [...players.values()].filter((q) => q.exposure >= 3 && !('skip-named' in args && NAMED.has(normalizePlayerName(q.name))));
{
  // Exposure in each half, so only players seen in both count.
  const half = new Map<string, [number, number]>();
  teams.forEach((t, ti) => t.players.forEach((p) => {
    const h = half.get(p.name) ?? [0, 0];
    h[endOf(ti) % 2] += p.share;
    half.set(p.name, h);
  }));
  const both = names.filter((n) => (half.get(n)?.[0] ?? 0) >= 2 && (half.get(n)?.[1] ?? 0) >= 2);
  console.log(`\nReliability: odd-season fit vs even-season fit, ${both.length} players with 2+ full-time seasons in each: r ${corr(both.map((n) => odd[idx.get(n)!]), both.map((n) => even[idx.get(n)!])).r.toFixed(2)}`);
}
console.log(`\nRidge (lambda ${LAMBDA}) over ${players.size} players; ${regular.length} with 3+ full-time seasons. Below: D-TAL points his teams' defense says he is worth beyond his D-TAL.`);

const groupBy = (label: string, key: (q: P) => string) => {
  const g = Object.groupBy(regular, key);
  console.log(`\nBy ${label} (exposure-weighted, D-TAL points):`);
  for (const [k, qs] of Object.entries(g).sort()) {
    const w = qs!.reduce((s, q) => s + q.exposure, 0);
    console.log(`  ${k.padEnd(22)} ${(qs!.reduce((s, q) => s + toDtal(q.adj) * q.exposure, 0) / w >= 0 ? '+' : '')}${(qs!.reduce((s, q) => s + toDtal(q.adj) * q.exposure, 0) / w).toFixed(1).padStart(5)}  (${qs!.length})`);
  }
};
groupBy('position', (q) => q.pos);
groupBy('defensive role', (q) => q.role);
groupBy('minutes a game', (q) => (q.mpg < 20 ? 'a <20' : q.mpg < 24 ? 'b 20-24' : q.mpg < 30 ? 'c 24-30' : q.mpg < 35 ? 'd 30-35' : 'e 35+'));
groupBy('D-TAL band', (q) => (q.dtal < 30 ? 'a <30' : q.dtal < 50 ? 'b 30-50' : q.dtal < 70 ? 'c 50-70' : q.dtal < 85 ? 'd 70-85' : 'e 85+'));

const line = (q: P) =>
  `  ${toDtal(q.adj) >= 0 ? '+' : ''}${toDtal(q.adj).toFixed(0).padStart(3)}  D-TAL ${q.dtal.toFixed(0).padStart(3)}  DBPM ${q.dbpm.toFixed(1).padStart(4)}  ${q.mpg.toFixed(0)}mpg  ${q.exposure.toFixed(1)} FT seasons  ${q.pos} ${q.role.padEnd(16)} ${q.name} (${[...q.spans].sort().join(', ')})`;
const sorted = [...regular].sort((a, b) => toDtal(b.adj) - toDtal(a.adj));
console.log(`\nTeams defend BETTER than his D-TAL says (under-rated), top ${TOP}:`);
sorted.slice(0, TOP).forEach((q) => console.log(line(q)));
console.log(`\nTeams defend WORSE than his D-TAL says (over-rated), top ${TOP}:`);
sorted.slice(-TOP).reverse().forEach((q) => console.log(line(q)));

const watch = (args.watch ?? 'Dirk Nowitzki,Nicolas Batum,Mike Conley,Nikola Jokic,Klay Thompson,Joe Dumars,Rudy Gobert,Draymond Green,Kevin Garnett,Shawn Marion,Andre Iguodala,Steve Nash,Charles Barkley').split(',');
console.log('\nWatch list:');
for (const n of watch) {
  const q = players.get(normalizePlayerName(n));
  if (q) console.log(line(q));
}

mkdirSync(resolve(root, 'reports'), { recursive: true });
writeFileSync(
  resolve(root, 'reports/dtal-audit.csv'),
  ['name,pos,role,dtal,dbpm,mpg,exposure,teamSaysDtal', ...[...players.values()].map((q) => `"${q.name}",${q.pos},${q.role},${q.dtal.toFixed(1)},${q.dbpm.toFixed(2)},${q.mpg.toFixed(1)},${q.exposure.toFixed(2)},${toDtal(q.adj).toFixed(1)}`)].join('\n'),
);
