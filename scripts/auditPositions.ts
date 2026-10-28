import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import competenceData from '../src/data/positionCompetence.json';
import { draftPool } from '../src/data/draftPool';
import { getBodyWeightLbs, getHeightInches } from '../src/data/heightLookup';
import { normalizePlayerName, type PlayerSpan, type Position } from '../src/data/schema';
import { resolveSourceName } from '../src/data/sourceNameResolver';
import { spanEndYears } from '../src/engine/era';
import { functionalPosition } from '../src/engine/functionalPosition';
import { effectiveTalent } from '../src/engine/grades';
import '../src/engine/fit';

/**
 * 2026-10-28 (the user: "trzeba jeszcze zrobić audyt pozycji... Tatum czy Cam Johnson, którzy są
 * PF-ami, a all time raczej będą grać głównie na SF"): a span's position is the tag of the games
 * he played in his own era, and the positionless era tags wings as fours and fours as fives. This
 * reads every span's "all-time position" from what he did instead — a line fitted on 1980-2008,
 * when the five positions still meant one thing (BBRef's season position, PG 1 … C 5), from height
 * and the era-relative rates that say where a player lives on the floor: DRB%, ORB%, AST%, BLK%,
 * STL%, USG% and three-point rate, each as a z-score within its own season. Then it holds that
 * against the pool tag, `functionalPosition` (the small-ball PF -> SF read D-TAL already uses) and
 * the multi-position table (`positionCompetence.json`).
 *
 *   npx tsx scripts/auditPositions.ts [--gap=0.75] [--top=40]
 *
 * Writes reports/position-audit.csv (one line a span).
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const GAP = Number(args.gap ?? 0.75);
const TOP = Number(args.top ?? 40);
const root = resolve(import.meta.dirname, '..');
const POS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
const num = (p: Position) => POS.indexOf(p) + 1;
const nameOf = (x: number) => POS[Math.max(0, Math.min(4, Math.round(x) - 1))];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

// Two models, one per source, both fitted on 1980-2008 against BBRef's season position:
//  A (1973-74 on): height, weight and the BBRef Advanced rates.
//  B (every season, for the years before A): height, weight and the box per game — rebounds,
//    assists, points — from `raw/playerSeasonStats.csv`.
// Each feature is a z-score within its own season, so a 1965 rebounding line and a 2024 one are
// read against their own league.
const FEATURES_A = ['height', 'weight', 'drb_pct', 'orb_pct', 'ast_pct', 'blk_pct', 'stl_pct', 'usg_pct', 'fg3a_per_fga_pct'] as const;
const FEATURES_B = ['height', 'weight', 'rpg', 'apg', 'ppg'] as const;
interface Season { end: number; mp: number; pos?: number; raw: Record<string, number>; z: number[] }
const body = (name: string) => ({ height: getHeightInches(name) ?? NaN, weight: getBodyWeightLbs(name) ?? NaN });

const seasonsA = new Map<string, Season>();
{
  const [head, ...lines] = readFileSync(resolve(root, 'src/data/raw/bbref/player_advanced.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
  const cols = parseCsvLine(head);
  for (const line of lines) {
    const f = Object.fromEntries(parseCsvLine(line).map((v, i) => [cols[i], v]));
    const end = parseInt(f.SEASON.slice(0, 4), 10) + 1;
    const name = resolveSourceName(f.name_display, end);
    const key = `${name}|${end}`;
    const total = /^(\d+TM|TOT)$/.test(f.team_name_abbr);
    const pos = POS.includes(f.pos as Position) ? num(f.pos as Position) : undefined;
    const prior = seasonsA.get(key);
    if (prior && !total) {
      prior.pos ??= pos;
      continue;
    }
    const raw: Record<string, number> = body(name);
    for (const c of FEATURES_A.slice(2)) raw[c] = f[c] === '' ? NaN : Number(f[c]);
    seasonsA.set(key, { end, mp: Number(f.mp) || 0, pos: prior?.pos ?? pos, raw, z: [] });
  }
}
const seasonsB = new Map<string, Season>();
{
  const [head, ...lines] = readFileSync(resolve(root, 'src/data/raw/playerSeasonStats.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
  const cols = head.split(',');
  for (const line of lines) {
    const f = Object.fromEntries(line.split(',').map((v, i) => [cols[i], v]));
    const end = Number(f.seasonEnd);
    const g = Number(f.games);
    if (!g) continue;
    const name = resolveSourceName(f.name, end);
    const key = `${name}|${end}`;
    const prior = seasonsB.get(key);
    const add = { reb: Number(f.reboundsTotal) || 0, ast: Number(f.assists) || 0, pts: Number(f.points) || 0, g, mp: Number(f.numMinutes) || 0 };
    // A player traded mid-season has a line a team; summed.
    const acc = prior ? { reb: prior.raw.reb + add.reb, ast: prior.raw.ast + add.ast, pts: prior.raw.pts + add.pts, g: prior.raw.g + add.g, mp: prior.mp + add.mp } : add;
    seasonsB.set(key, { end, mp: acc.mp, pos: seasonsA.get(key)?.pos, raw: { ...body(name), reb: acc.reb, ast: acc.ast, pts: acc.pts, g: acc.g, rpg: acc.reb / acc.g, apg: acc.ast / acc.g, ppg: acc.pts / acc.g }, z: [] });
  }
}

function zScore(map: Map<string, Season>, features: readonly string[], inReference: (s: Season) => boolean) {
  for (const group of Object.values(Object.groupBy([...map.values()], (s) => String(s.end)))) {
    const ref = group!.filter(inReference);
    const stats = features.map((f) => {
      const v = ref.map((s) => s.raw[f]).filter((x) => !Number.isNaN(x));
      const m = v.reduce((a, b) => a + b, 0) / (v.length || 1);
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length || 1)) || 1;
      return { m, sd };
    });
    for (const s of group!) s.z = features.map((f, i) => (Number.isNaN(s.raw[f]) ? 0 : (s.raw[f] - stats[i].m) / stats[i].sd));
  }
}
zScore(seasonsA, FEATURES_A, (s) => s.mp >= 500);
zScore(seasonsB, FEATURES_B, (s) => s.raw.g >= 40);

/** Least squares on 1980-2008, then the line's output mapped back onto 1-5 through each position's
 * mean read — a straight line pulls both ends toward the middle (every PG reads a little SG, every
 * C a little PF). */
function fitModel(label: string, map: Map<string, Season>, features: readonly string[], enough: (s: Season) => boolean) {
  const train = [...map.values()].filter((s) => s.end >= 1980 && s.end <= 2008 && enough(s) && s.pos !== undefined && !Number.isNaN(s.raw.height));
  const X = train.map((s) => [1, ...s.z]);
  const y = train.map((s) => s.pos!);
  const k = X[0].length;
  const A = Array.from({ length: k }, (_, i) => [...Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0)), X.reduce((s, r, n) => s + r[i] * y[n], 0)]);
  for (let i = 0; i < k; i++) {
    const p = A[i][i];
    for (let j = i; j <= k; j++) A[i][j] /= p;
    for (let r = 0; r < k; r++) if (r !== i) for (let j = k; j >= i; j--) A[r][j] -= A[r][i] * A[i][j];
  }
  const beta = A.map((r) => r[k]);
  const linear = (z: number[]) => [1, ...z].reduce((s, x, i) => s + x * beta[i], 0);
  const lin = train.map((s) => linear(s.z));
  const anchors = POS.map((_, i) => {
    const v = lin.filter((_, n) => train[n].pos === i + 1);
    return v.reduce((a, b) => a + b, 0) / v.length;
  });
  const predict = (z: number[]) => {
    const x = linear(z);
    if (x <= anchors[0]) return 1 + (x - anchors[0]) / (anchors[1] - anchors[0]);
    for (let i = 1; i < 5; i++) if (x <= anchors[i]) return i + (x - anchors[i - 1]) / (anchors[i] - anchors[i - 1]);
    return 5 + (x - anchors[4]) / (anchors[4] - anchors[3]);
  };
  const fitted = train.map((s) => predict(s.z));
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  const r2 = 1 - fitted.reduce((s, f, i) => s + (y[i] - f) ** 2, 0) / y.reduce((s, v) => s + (v - my) ** 2, 0);
  const exact = fitted.filter((f, i) => Math.max(1, Math.min(5, Math.round(f))) === y[i]).length / y.length;
  console.log(`Model ${label}: ${train.length} seasons 1980-2008, R² ${r2.toFixed(2)}, ${(100 * exact).toFixed(0)}% exact; weights ${['const', ...features].map((f, i) => `${f} ${beta[i].toFixed(2)}`).join(', ')}`);
  return predict;
}
const predictA = fitModel('A (BBRef Advanced)', seasonsA, FEATURES_A, (s) => s.mp >= 1000);
const predictB = fitModel('B (box, every era)', seasonsB, FEATURES_B, (s) => s.raw.g >= 50 && (s.mp >= 1000 || s.mp === 0));

// Every pool span: each season read by A where BBRef has it, else by B; weighted by games.
const competence = competenceData as Record<string, { nat: Position[]; pos: Partial<Record<Position, number>> }>;
interface Row { span: PlayerSpan; tag: number; pred: number; functional: Position; nat: Position[]; eff: number; height?: number; bbrefPos: number; byB: number; seasons: number }
const rows: Row[] = [];
for (const s of draftPool) {
  const name = normalizePlayerName(s.playerName);
  if (getHeightInches(s.playerName) === undefined) continue;
  let sum = 0;
  let w = 0;
  let wB = 0;
  let posSum = 0;
  let posW = 0;
  for (const e of spanEndYears(s.spanLabel)) {
    const a = seasonsA.get(`${name}|${e}`);
    const b = seasonsB.get(`${name}|${e}`);
    const games = b?.raw.g ?? (a?.mp ? a.mp / 30 : 0);
    if (!games) continue;
    if (a && a.mp > 0) sum += games * predictA(a.z);
    else if (b) {
      sum += games * predictB(b.z);
      wB += games;
    } else continue;
    w += games;
    if (a?.pos !== undefined) {
      posSum += games * a.pos;
      posW += games;
    }
  }
  if (!w) continue;
  rows.push({
    span: s,
    tag: num(s.primaryPosition),
    pred: sum / w,
    functional: functionalPosition(s),
    nat: competence[name]?.nat ?? [],
    eff: effectiveTalent(s),
    height: getHeightInches(s.playerName),
    bbrefPos: posW ? posSum / posW : NaN,
    byB: wB / w,
    seasons: w,
  });
}

console.log(`\n${rows.length} of ${draftPool.length} pool spans read (${rows.filter((r) => r.byB > 0.5).length} mostly by model B). Pool tag minus all-time position, by era (+ = tagged bigger than he plays):`);
for (const [label, lo, hi] of [['1947-1973', 1947, 1973], ['1974-1989', 1974, 1989], ['1990-1999', 1990, 1999], ['2000-2009', 2000, 2009], ['2010-2017', 2010, 2017], ['2018-2026', 2018, 2026]] as const) {
  const g = rows.filter((r) => {
    const e = spanEndYears(r.span.spanLabel).at(-1)!;
    return e >= lo && e <= hi;
  });
  const by = (p: Position) => {
    const h = g.filter((r) => r.span.primaryPosition === p);
    if (!h.length) return '';
    const d = h.reduce((s, r) => s + r.tag - r.pred, 0) / h.length;
    return `${p} ${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
  };
  console.log(`  ${label}: all ${(g.reduce((s, r) => s + r.tag - r.pred, 0) / g.length).toFixed(2)}   ${POS.map(by).join('  ')}  (${g.length})`);
}

// Past either end of the scale is not a wrong tag (Gobert reads more C than a C), so the read is
// held to 1-5 before the gap.
const gapOf = (r: Row) => r.tag - Math.max(1, Math.min(5, r.pred));
const flagged = rows.filter((r) => Math.abs(gapOf(r)) >= GAP);
console.log(`\n${flagged.length} spans (${new Set(flagged.map((r) => r.span.playerName)).size} players) whose tag sits ${GAP}+ of a position from what they play:`);
const moves = Object.groupBy(flagged, (r) => `${r.span.primaryPosition} -> ${nameOf(r.pred)}`);
console.log('  ' + Object.entries(moves).sort((a, b) => b[1]!.length - a[1]!.length).map(([k, v]) => `${k} ${v!.length}`).join(', '));
const coveredByFunctional = flagged.filter((r) => r.functional !== r.span.primaryPosition && num(r.functional) - r.pred < gapOf(r)).length;
const coveredByCompetence = flagged.filter((r) => r.nat.includes(nameOf(r.pred))).length;
console.log(`  already read elsewhere: functionalPosition ${coveredByFunctional}, a natural position in positionCompetence ${coveredByCompetence}`);

// One line a player: his most-played-off span, best players first.
const byPlayer = new Map<string, Row[]>();
for (const r of flagged) byPlayer.set(r.span.playerName, [...(byPlayer.get(r.span.playerName) ?? []), r]);
const ft = (inches?: number) => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : '?');
const players = [...byPlayer.entries()].map(([name, rs]) => ({ name, rs, eff: Math.max(...rs.map((r) => r.eff)) })).sort((a, b) => b.eff - a.eff);
console.log(`\nTop ${TOP} players by TAL among them (spans flagged / all his spans):`);
for (const { name, rs } of players.slice(0, TOP)) {
  const all = rows.filter((r) => r.span.playerName === name);
  const g = rs.reduce((s, r) => s + gapOf(r), 0) / rs.length;
  const tags = [...new Set(rs.map((r) => r.span.primaryPosition))].join('/');
  console.log(
    `  ${name.padEnd(24)} ${ft(rs[0].height).padEnd(6)} tag ${tags.padEnd(6)} plays ~${nameOf(rs.reduce((s, r) => s + r.pred, 0) / rs.length)} (${(rs.reduce((s, r) => s + r.pred, 0) / rs.length).toFixed(1)}), gap ${g >= 0 ? '+' : ''}${g.toFixed(2)}  ${rs.length}/${all.length} spans  functional ${[...new Set(rs.map((r) => r.functional))].join('/')}  natural ${rs[0].nat.join('/') || '–'}  TAL ${Math.max(...rs.map((r) => r.eff)).toFixed(0)}  (${rs.map((r) => r.span.spanLabel).join(', ')})`,
  );
}

const modernPf = rows
  .filter((r) => r.span.primaryPosition === 'PF' && spanEndYears(r.span.spanLabel).at(-1)! >= 2010 && r.pred < 3.5)
  .sort((a, b) => b.eff - a.eff);
const modernPfPlayers = new Map<string, Row[]>();
for (const r of modernPf) modernPfPlayers.set(r.span.playerName, [...(modernPfPlayers.get(r.span.playerName) ?? []), r]);
console.log(`\nTagged PF, 2010 on, plays SF (read under 3.5): ${modernPf.length} spans, ${modernPfPlayers.size} players; read as SF already by functionalPosition (D-TAL only): ${modernPf.filter((r) => r.functional === 'SF').length}. Best 30 by TAL:`);
for (const [name, rs] of [...modernPfPlayers.entries()].slice(0, 30))
  console.log(`  ${name.padEnd(24)} ${ft(rs[0].height).padEnd(6)} read ${(rs.reduce((s, r) => s + r.pred, 0) / rs.length).toFixed(1)}  functional ${[...new Set(rs.map((r) => r.functional))].join('/')}  natural ${rs[0].nat.join('/') || '–'}  TAL ${Math.max(...rs.map((r) => r.eff)).toFixed(0)}  (${rs.map((r) => r.span.spanLabel).join(', ')})`);

const watch = (args.watch ?? 'Jayson Tatum,Cameron Johnson,Kevin Durant,LeBron James,Giannis Antetokounmpo,Draymond Green,Paul George,Kawhi Leonard,Jimmy Butler,Pascal Siakam,Jaren Jackson Jr.,Bam Adebayo,Al Horford,Chris Bosh,Dirk Nowitzki,Magic Johnson,Larry Bird').split(',');
console.log('\nWatch list (each span: tag / all-time read):');
for (const n of watch) {
  const rs = rows.filter((r) => normalizePlayerName(r.span.playerName) === normalizePlayerName(n));
  if (!rs.length) continue;
  console.log(`  ${n.padEnd(24)} ${ft(rs[0].height).padEnd(6)} natural ${rs[0].nat.join('/') || '–'}: ${rs.map((r) => `${r.span.spanLabel} ${r.span.primaryPosition}/${r.pred.toFixed(1)}`).join('  ')}`);
}

mkdirSync(resolve(root, 'reports'), { recursive: true });
writeFileSync(
  resolve(root, 'reports/position-audit.csv'),
  ['name,span,tag,functional,natural,allTime,allTimePos,bbrefPos,gap,tal,height', ...rows.map((r) => `"${r.span.playerName}",${r.span.spanLabel},${r.span.primaryPosition},${r.functional},${r.nat.join('/')},${r.pred.toFixed(2)},${nameOf(r.pred)},${r.bbrefPos.toFixed(2)},${gapOf(r).toFixed(2)},${r.eff.toFixed(0)},${r.height ?? ''}`)].join('\n'),
);

// The proposal the user reviews (`--review`): each span's all-time position where it sits GAP+ of a
// position from its tag, except a tagged PG who runs the offense (Primary Ball Handler, or an AST%
// in his season's top ~7%) — size alone doesn't make Magic or Luka a wing.
/**
 * 2026-10-28, fitted to the user's 2,032 reviewed windows (212 players, TAL 55+): he stays at the tag
 * until the read leaves it by a threshold of its own for each position and direction, and moves one
 * position at a time (a model jump of two — C -> SF, PF -> SG — he always cut to one step). The
 * thresholds came out at the old 0.75 almost everywhere; the exceptions are SG -> PG at 0.55 and PF ->
 * C at 0.9, and a Stretch Big stays a PF. Validated by player: 82.7% of his picks against 81.6% for
 * the plain 0.75 rule — the rest is a call about the player, not a number.
 */
const STEP_UP: Partial<Record<Position, number>> = { PG: 0.85, SG: 0.75, SF: 0.75, PF: 0.9 };
const STEP_DOWN: Partial<Record<Position, number>> = { SG: 0.55, SF: 0.75, PF: 0.75, C: 0.75 };
function proposeStep(tag: Position, read: number, archetype: string): Position {
  const t = num(tag);
  const d = read - t;
  if (d > 0 && d > (STEP_UP[tag] ?? 9) && !(tag === 'PF' && archetype === 'Stretch Big')) return POS[t];
  if (d < 0 && -d > (STEP_DOWN[tag] ?? 9)) return POS[t - 2];
  return tag;
}
if ('review' in args) {
  const evidence = (s: PlayerSpan) => {
    const name = normalizePlayerName(s.playerName);
    const as = spanEndYears(s.spanLabel).map((e) => seasonsA.get(`${name}|${e}`)).filter((x): x is Season => Boolean(x && x.mp > 0));
    const bs = spanEndYears(s.spanLabel).map((e) => seasonsB.get(`${name}|${e}`)).filter((x): x is Season => Boolean(x));
    const avg = (xs: Season[], f: string, z = false) => {
      const v = xs.map((x) => (z ? x.z[FEATURES_A.indexOf(f as never)] : x.raw[f])).filter((x) => !Number.isNaN(x));
      return v.length ? Math.round((10 * v.reduce((a, b) => a + b, 0)) / v.length) / 10 : null;
    };
    return { drb: avg(as, 'drb_pct'), ast: avg(as, 'ast_pct'), astZ: avg(as, 'ast_pct', true), blk: avg(as, 'blk_pct'), three: as.length ? avg(as, 'fg3a_per_fga_pct') : null, rpg: avg(bs, 'rpg'), apg: avg(bs, 'apg'), listed: [...new Set(as.map((x) => x.pos).filter((p): p is number => p !== undefined).map((p) => POS[p - 1]))] };
  };
  const out = new Map<string, { name: string; height?: number; weight?: number; natural: Position[]; tal: number; spans: unknown[] }>();
  for (const r of rows) {
    const c = Math.max(1, Math.min(5, r.pred));
    const ev = evidence(r.span);
    let proposal = proposeStep(r.span.primaryPosition, c, r.span.offensiveArchetype);
    let reason = proposal === r.span.primaryPosition ? '' : 'profile';
    if (r.span.primaryPosition === 'PG' && proposal !== 'PG' && (r.span.offensiveArchetype === 'Primary Ball Handler' || (ev.astZ ?? 0) >= 1.5)) {
      proposal = 'PG';
      reason = 'kept: runs the offense';
    }
    const p = out.get(r.span.playerName) ?? { name: r.span.playerName, height: r.height, weight: getBodyWeightLbs(r.span.playerName), natural: r.nat, tal: 0, spans: [] };
    p.tal = Math.max(p.tal, Math.round(r.eff));
    p.spans.push({ label: r.span.spanLabel, tag: r.span.primaryPosition, secondary: r.span.secondaryPositions, read: Math.round(100 * r.pred) / 100, proposal, reason, tal: Math.round(r.eff), role: r.span.offensiveArchetype, def: r.span.defensiveRole, ...ev });
    out.set(r.span.playerName, p);
  }
  const changed = [...out.values()].filter((p) => (p.spans as { proposal: string; tag: string }[]).some((s) => s.proposal !== s.tag));
  for (const p of changed) (p.spans as { label: string }[]).sort((a, b) => a.label.localeCompare(b.label));
  changed.sort((a, b) => b.tal - a.tal);
  writeFileSync(resolve(root, 'reports/position-review.json'), JSON.stringify(changed));
  const spans = changed.flatMap((p) => p.spans as { proposal: string; tag: string }[]);
  console.log(`\nreview: ${changed.length} players, ${spans.filter((s) => s.proposal !== s.tag).length} span changes proposed (TAL 70+: ${changed.filter((p) => p.tal >= 70).length} players, 55+: ${changed.filter((p) => p.tal >= 55).length}) -> reports/position-review.json`);
  const moves = Object.groupBy(spans.filter((s) => s.proposal !== s.tag), (s) => `${s.tag}->${s.proposal}`);
  console.log('  ' + Object.entries(moves).sort((a, b) => b[1]!.length - a[1]!.length).map(([k, v]) => `${k} ${v!.length}`).join(', '));
}
