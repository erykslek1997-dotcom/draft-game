import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import competenceData from '../src/data/positionCompetence.json';
import { draftPool } from '../src/data/draftPool';
import { getHeightInches } from '../src/data/heightLookup';
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

// Player-seasons (the multi-team total when he moved; position from his first team line).
const FEATURES = ['height', 'drb_pct', 'orb_pct', 'ast_pct', 'blk_pct', 'stl_pct', 'usg_pct', 'fg3a_per_fga_pct'] as const;
interface Season { key: string; end: number; mp: number; pos?: number; raw: Record<string, number>; z: number[] }
const seasons = new Map<string, Season>();
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
    const prior = seasons.get(key);
    if (prior && !total) {
      prior.pos ??= pos;
      continue;
    }
    const raw: Record<string, number> = { height: getHeightInches(name) ?? NaN };
    for (const c of FEATURES.slice(1)) raw[c] = f[c] === '' ? NaN : Number(f[c]);
    seasons.set(key, { key, end, mp: Number(f.mp) || 0, pos: prior?.pos ?? pos, raw, z: [] });
  }
}
// z-scores within each season (players with 500+ minutes set the mean and spread).
for (const [end, group] of Object.entries(Object.groupBy([...seasons.values()], (s) => String(s.end)))) {
  void end;
  const ref = group!.filter((s) => s.mp >= 500);
  const stats = FEATURES.map((f) => {
    const v = ref.map((s) => s.raw[f]).filter((x) => !Number.isNaN(x));
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
    return { m, sd };
  });
  for (const s of group!) s.z = FEATURES.map((f, i) => (Number.isNaN(s.raw[f]) ? 0 : (s.raw[f] - stats[i].m) / stats[i].sd));
}

// Least squares on the classic era.
const train = [...seasons.values()].filter((s) => s.end >= 1980 && s.end <= 2008 && s.mp >= 1000 && s.pos !== undefined && !Number.isNaN(s.raw.height));
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
// A straight line pulls both ends toward the middle (every PG reads a little SG, every C a little
// PF), so the line's output is mapped back onto the scale through each position's classic-era
// mean read: piecewise linear, PG's mean -> 1 … C's mean -> 5.
const linearFit = train.map((s) => linear(s.z));
const anchors = POS.map((_, i) => {
  const v = linearFit.filter((_, n) => train[n].pos === i + 1);
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
const exact = fitted.filter((f, i) => Math.round(f) === y[i]).length / y.length;
console.log(`Classic-era mean read by position: ${POS.map((p, i) => `${p} ${anchors[i].toFixed(2)}`).join(', ')}`);
console.log(`Fit on ${train.length} seasons 1980-2008 (1000+ min): R² ${r2.toFixed(2)}, ${(100 * exact).toFixed(0)}% exact, weights: ${['const', ...FEATURES].map((f, i) => `${f} ${beta[i].toFixed(2)}`).join(', ')}`);

// Every pool span: minutes-weighted over its seasons.
const competence = competenceData as Record<string, { nat: Position[]; pos: Partial<Record<Position, number>> }>;
interface Row { span: PlayerSpan; tag: number; pred: number; functional: Position; nat: Position[]; eff: number; height?: number; bbrefPos: number }
const rows: Row[] = [];
for (const s of draftPool) {
  const name = normalizePlayerName(s.playerName);
  const ss = spanEndYears(s.spanLabel).map((e) => seasons.get(`${name}|${e}`)).filter((x): x is Season => Boolean(x && x.mp > 0));
  if (!ss.length || getHeightInches(s.playerName) === undefined) continue;
  const mp = ss.reduce((a, x) => a + x.mp, 0);
  const pred = ss.reduce((a, x) => a + x.mp * predict(x.z), 0) / mp;
  const withPos = ss.filter((x) => x.pos !== undefined);
  rows.push({
    span: s,
    tag: num(s.primaryPosition),
    pred,
    functional: functionalPosition(s),
    nat: competence[name]?.nat ?? [],
    eff: effectiveTalent(s),
    height: getHeightInches(s.playerName),
    bbrefPos: withPos.length ? withPos.reduce((a, x) => a + x.mp * x.pos!, 0) / withPos.reduce((a, x) => a + x.mp, 0) : NaN,
  });
}

console.log(`\n${rows.length} pool spans (1973-74 on, with a height). Pool tag minus all-time position, by era (+ = tagged bigger than he plays):`);
for (const [label, lo, hi] of [['1974-1989', 1974, 1989], ['1990-1999', 1990, 1999], ['2000-2009', 2000, 2009], ['2010-2017', 2010, 2017], ['2018-2026', 2018, 2026]] as const) {
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
