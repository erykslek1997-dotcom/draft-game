/**
 * 2026-11-11 (the user: "teraz chociażby o-tal"): OBPM for windows before 1973-74, where BBRef has no
 * BPM, read off the players statistically closest to them. From 1973-74 on, raw offense is anchored
 * 60% toward the offense a player's own OBPM implies (talent.ts `OFFENSE_ANCHOR`, the 2026-11-04 fix
 * for a box formula that over-credits efficient volume and under-credits rim creators); before it the
 * box formula stood alone. This estimates the missing OBPM so the same anchor can lean on it.
 *
 * Donors: windows wholly from 1976-77 on with a real OBPM (one per player, his middle window).
 * Features: only what a pre-1974 window has — scoring, rebounds, assists, shots, FG%, FT%, TS%, size,
 * position, minutes, AST%, WS/48, PER — each a z-score inside its era. Honesty test: leave one player
 * out on the donors. `--out` writes the estimate for every window ending by 1973-74.
 *
 *   npx tsx scripts/estimateObpm.ts [--k=10] [--out=src/data/preBpmObpmTwins.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { getBodyWeightLbs, getHeightInches } from '../src/data/heightLookup';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const K = Number(args.k ?? 10);
const ADV = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/bbrefAdvanced.json'), 'utf8')) as { fields: string[]; rows: Record<string, (number | null)[]> };
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
const NAMEOF = (s: PlayerSpan) => normalizePlayerName(s.playerName);
const years = (s: PlayerSpan) => spanEndYears(s.spanLabel);
const midYear = (s: PlayerSpan) => { const ys = years(s); return ys[Math.floor(ys.length / 2)]; };
const avgYears = (s: PlayerSpan, pick: (key: string) => number | null): number | null => {
  const vals = years(s).map((y) => pick(`${NAMEOF(s)}|${y}`)).filter((v): v is number => v !== null && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const adv = (name: string) => { const i = ADV.fields.indexOf(name); return (s: PlayerSpan) => avgYears(s, (k) => ADV.rows[k]?.[i] ?? null); };
const obpm = adv('obpm');

const FEATURES: { name: string; w: number; get: (s: PlayerSpan) => number | null }[] = [
  ...(['ppg', 'rpg', 'apg'] as const).map((k) => ({ name: k, w: 1, get: (s: PlayerSpan) => s.box[k] })),
  { name: 'fga', w: 1, get: (s) => s.fga },
  { name: 'fgPct', w: 1, get: (s) => s.box.fgPct },
  { name: 'ftPct', w: 1, get: (s) => s.box.ftPct },
  { name: 'tsPct', w: 1, get: (s) => s.box.tsPct },
  { name: 'height', w: 1, get: (s) => getHeightInches(s.playerName) ?? null },
  { name: 'weight', w: 1, get: (s) => getBodyWeightLbs(s.playerName) ?? null },
  { name: 'position', w: 1, get: (s) => POS.indexOf(s.primaryPosition) },
  { name: 'mpg', w: 1, get: adv('mpg') },
  { name: 'ast_pct', w: 1, get: adv('ast_pct') },
  { name: 'ws_per_48', w: 1, get: adv('ws_per_48') },
  { name: 'per', w: 1, get: adv('per') },
];

const bin = (s: PlayerSpan) => Math.floor(midYear(s) / 5);
const stats = new Map<string, { m: number; sd: number }>();
FEATURES.forEach((f, fi) => {
  const byBin = new Map<number, number[]>();
  for (const s of draftPool) { const v = f.get(s); if (v !== null && Number.isFinite(v)) byBin.set(bin(s), [...(byBin.get(bin(s)) ?? []), v]); }
  for (const [b, vs] of byBin) {
    const m = vs.reduce((a, c) => a + c, 0) / vs.length;
    stats.set(`${fi}|${b}`, { m, sd: Math.sqrt(vs.reduce((a, c) => a + (c - m) ** 2, 0) / vs.length) || 1 });
  }
});
const VEC = new Map(draftPool.map((s) => [s.id, Float64Array.from(FEATURES, (f, fi) => {
  const v = f.get(s); const st = stats.get(`${fi}|${bin(s)}`);
  return v === null || !Number.isFinite(v) || !st ? NaN : (v - st.m) / st.sd;
})]));

const byPlayer = new Map<string, PlayerSpan[]>();
for (const s of draftPool) if (Math.min(...years(s)) >= 1977 && obpm(s) !== null) byPlayer.set(NAMEOF(s), [...(byPlayer.get(NAMEOF(s)) ?? []), s]);
const DONORS = [...byPlayer.values()].map((ws) => ws.sort((a, b) => midYear(a) - midYear(b))[Math.floor(ws.length / 2)]);
const TRUTH = new Map(DONORS.map((s) => [s.id, obpm(s)!]));

function estimate(s: PlayerSpan): { value: number; near: PlayerSpan[] } {
  const v = VEC.get(s.id)!, me = NAMEOF(s);
  const all: { d: number; span: PlayerSpan }[] = [];
  for (const o of DONORS) {
    if (NAMEOF(o) === me) continue;
    const u = VEC.get(o.id)!;
    let sum = 0, wsum = 0;
    FEATURES.forEach((f, i) => { if (f.w === 0 || Number.isNaN(v[i]) || Number.isNaN(u[i])) return; sum += f.w * (v[i] - u[i]) ** 2; wsum += f.w; });
    if (wsum > 0) all.push({ d: Math.sqrt(sum / wsum), span: o });
  }
  const ns = all.sort((a, b) => a.d - b.d).slice(0, K);
  let a = 0, b = 0; for (const n of ns) { const w = 1 / (0.1 + n.d); a += w * TRUTH.get(n.span.id)!; b += w; }
  return { value: a / b, near: ns.map((n) => n.span) };
}
function honesty(): { r: number; rec: number; a: number; b: number } {
  const truth = DONORS.map((s) => TRUTH.get(s.id)!), pred = DONORS.map((s) => estimate(s).value);
  const mt = truth.reduce((x, y) => x + y, 0) / truth.length, mp = pred.reduce((x, y) => x + y, 0) / pred.length;
  const variance = truth.reduce((x, y) => x + (y - mt) ** 2, 0) / truth.length;
  const mse = pred.reduce((x, p, i) => x + (p - truth[i]) ** 2, 0) / pred.length;
  let c1 = 0, c2 = 0, c3 = 0; pred.forEach((p, i) => { c1 += (p - mp) * (truth[i] - mt); c2 += (p - mp) ** 2; c3 += (truth[i] - mt) ** 2; });
  const b = c1 / c2;
  return { r: c1 / Math.sqrt(c2 * c3), rec: 1 - mse / variance, a: mt - b * mp, b };
}

if (args.tune === '1') {
  let best = honesty().rec;
  console.log(`equal weights: ${(best * 100).toFixed(1)}%`);
  for (let pass = 0; pass < 2; pass++) for (const f of FEATURES) {
    const keep = f.w;
    for (const v of [0, 0.5, 2, 3]) { f.w = v; const sc = honesty().rec; if (sc > best + 0.003) { best = sc; break; } f.w = keep; }
    if (f.w !== keep) console.log(`  ${f.name}: ${keep} -> ${f.w} (${(best * 100).toFixed(1)}%)`);
  }
}
const h = honesty();
console.log(`Donors (windows from 1976-77 on), n ${DONORS.length}; weights ${FEATURES.filter((f) => f.w).map((f) => `${f.name} ${f.w}`).join(', ')}`);
console.log(`  leave-one-player-out: r ${h.r.toFixed(2)}, variance recovered ${(h.rec * 100).toFixed(0)}%; stretch truth = ${h.a.toFixed(2)} + ${h.b.toFixed(2)} x estimate`);
const stretched = (s: PlayerSpan) => h.a + h.b * estimate(s).value;

console.log('\nBefore 1973-74, estimated OBPM (best-scoring window):');
for (const n of ['Wilt Chamberlain', 'Oscar Robertson', 'Jerry West', 'Elgin Baylor', 'Bill Russell', 'Bob Pettit', 'Bob Cousy', 'Rick Barry', 'John Havlicek', 'Walt Frazier', 'Kareem Abdul-Jabbar', 'Willis Reed', 'Jerry Lucas', 'Hal Greer', 'Earl Monroe', 'George Mikan', 'Dolph Schayes', 'Sam Jones']) {
  const s = draftPool.filter((x) => x.playerName === n && Math.max(...years(x)) <= 1974).sort((a, b) => b.box.ppg - a.box.ppg)[0];
  if (!s) continue;
  const e = estimate(s);
  console.log(`  ${n.padEnd(20)} ${s.spanLabel}  OBPM ${stretched(s) >= 0 ? '+' : ''}${stretched(s).toFixed(1)}   ${e.near.slice(0, 4).map((x) => `${x.playerName} ${x.spanLabel}`).join(', ')}`);
}

if (args.out) {
  const out: Record<string, number> = {};
  for (const s of draftPool) if (Math.max(...years(s)) <= 1974) out[s.id] = Math.round(stretched(s) * 10) / 10;
  writeFileSync(args.out, JSON.stringify(out));
  console.log(`\nwrote ${Object.keys(out).length} windows to ${args.out}`);
}
