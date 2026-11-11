/**
 * 2026-11-11 (the user: "jak mamy mosty i bliźniaków, to możemy oszacować spacing tych którzy nie
 * mieli możliwości rzucać za 3"): spacing for a window before the three-point line, read off the
 * modern players whose game looked like his — without any three-point number, since he has none.
 *
 * Donors: windows from 2000-01 on (the three fully adopted), target their engine spacing (0-100).
 * Features: only what a window before 1973-74 has — scoring, rebounds, assists, shots, FG%, FT%,
 * TS%, size, position, minutes, AST%, WS/48, PER — each a z-score inside its era. Free-throw
 * shooting carries its own weight (the classic predictor of a jump shot).
 *
 * Honesty test first: leave-one-player-out on the modern donors with the same pre-1974 feature set.
 * Then the estimate for the windows before the line next to what the engine gives them today (the
 * hand-set list in `preZoneShooting.ts` at 0.85, zero off the list).
 *
 *   npx tsx scripts/estimateSpacing.ts [--k=10] [--ft=3]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { getBodyWeightLbs, getHeightInches } from '../src/data/heightLookup';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { computeSpacing } from '../src/engine/spacing';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const K = Number(args.k ?? 10);
const FT_W = Number(args.ft ?? 3);
// TS% folds FG and FT (and how often he drew fouls) into one number, double-counting both; --ts=0 drops it.
const TS_W = Number(args.ts ?? 0); // off by default: for modern donors TS% carries three-point efficiency, which a pre-line window cannot have
const FG_W = Number(args.fg ?? 1);

const ADV = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/bbrefAdvanced.json'), 'utf8')) as { fields: string[]; rows: Record<string, (number | null)[]> };
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
const NAMEOF = (s: PlayerSpan) => normalizePlayerName(s.playerName);
const midYear = (s: PlayerSpan) => { const ys = spanEndYears(s.spanLabel); return ys[Math.floor(ys.length / 2)]; };
const lastYear = (s: PlayerSpan) => Math.max(...spanEndYears(s.spanLabel));
const avgYears = (s: PlayerSpan, pick: (key: string) => number | null): number | null => {
  const vals = spanEndYears(s.spanLabel).map((y) => pick(`${NAMEOF(s)}|${y}`)).filter((v): v is number => v !== null && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const adv = (name: string) => { const i = ADV.fields.indexOf(name); return (s: PlayerSpan) => avgYears(s, (k) => ADV.rows[k]?.[i] ?? null); };

const FEATURES: { name: string; w: number; get: (s: PlayerSpan) => number | null }[] = [
  ...(['ppg', 'rpg', 'apg'] as const).map((k) => ({ name: k, w: 1, get: (s: PlayerSpan) => s.box[k] })),
  { name: 'fga', w: 1, get: (s) => s.fga },
  { name: 'fgPct', w: FG_W, get: (s) => s.box.fgPct },
  { name: 'ftPct', w: FT_W, get: (s) => s.box.ftPct },
  { name: 'tsPct', w: TS_W, get: (s) => s.box.tsPct },
  { name: 'height', w: 1, get: (s) => getHeightInches(s.playerName) ?? null },
  { name: 'weight', w: 1, get: (s) => getBodyWeightLbs(s.playerName) ?? null },
  { name: 'position', w: 2, get: (s) => POS.indexOf(s.primaryPosition) },
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

const spacing = new Map(draftPool.map((s) => [s.id, computeSpacing(s)]));
// Donors: one modern window per player (the middle of his windows from 2000-01 on).
const byPlayer = new Map<string, PlayerSpan[]>();
for (const s of draftPool) if (midYear(s) >= 2001) byPlayer.set(NAMEOF(s), [...(byPlayer.get(NAMEOF(s)) ?? []), s]);
const DONORS = [...byPlayer.values()].map((ws) => ws.sort((a, b) => midYear(a) - midYear(b))[Math.floor(ws.length / 2)]);

function neighbours(s: PlayerSpan): { d: number; span: PlayerSpan }[] {
  const v = VEC.get(s.id)!, me = NAMEOF(s);
  const out: { d: number; span: PlayerSpan }[] = [];
  for (const o of DONORS) {
    if (NAMEOF(o) === me) continue;
    const u = VEC.get(o.id)!;
    let sum = 0, wsum = 0;
    FEATURES.forEach((f, i) => { if (f.w === 0 || Number.isNaN(v[i]) || Number.isNaN(u[i])) return; sum += f.w * (v[i] - u[i]) ** 2; wsum += f.w; });
    if (wsum > 0) out.push({ d: Math.sqrt(sum / wsum), span: o });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, K);
}
const estimate = (s: PlayerSpan) => { const ns = neighbours(s); let a = 0, b = 0; for (const n of ns) { const w = 1 / (0.1 + n.d); a += w * spacing.get(n.span.id)!; b += w; } return { value: a / b, near: ns }; };

// Honesty test on the donors.
{
  const truth = DONORS.map((s) => spacing.get(s.id)!);
  const pred = DONORS.map((s) => estimate(s).value);
  const mean = truth.reduce((a, b) => a + b, 0) / truth.length;
  const variance = truth.reduce((a, b) => a + (b - mean) ** 2, 0) / truth.length;
  const mse = pred.reduce((a, p, i) => a + (p - truth[i]) ** 2, 0) / pred.length;
  const mx = pred.reduce((a, b) => a + b, 0) / pred.length;
  let c1 = 0, c2 = 0, c3 = 0; pred.forEach((p, i) => { c1 += (p - mx) * (truth[i] - mean); c2 += (p - mx) ** 2; c3 += (truth[i] - mean) ** 2; });
  const posMean = new Map(POS.map((p) => { const vs = DONORS.filter((s) => s.primaryPosition === p).map((s) => spacing.get(s.id)!); return [p, vs.reduce((a, b) => a + b, 0) / vs.length]; }));
  const base = DONORS.reduce((a, s, i) => a + (posMean.get(s.primaryPosition)! - truth[i]) ** 2, 0) / DONORS.length;
  console.log(`Modern donors (2000-01 on), n ${DONORS.length}, no three-point feature, FT weight ${FT_W}:`);
  console.log(`  r ${(c1 / Math.sqrt(c2 * c3)).toFixed(2)}, variance recovered ${(100 * (1 - mse / variance)).toFixed(0)}%  (position mean alone ${(100 * (1 - base / variance)).toFixed(0)}%)`);
  for (const n of ['Stephen Curry', 'Klay Thompson', 'Ray Allen', 'Dirk Nowitzki', 'Steve Nash', 'Kyle Korver', 'Shaquille O\'Neal', 'Rajon Rondo', 'Russell Westbrook', 'Ben Simmons']) {
    const s = DONORS.find((x) => x.playerName === n);
    if (s) console.log(`    ${n.padEnd(18)} ${s.spanLabel}  spacing ${spacing.get(s.id)}  predicted ${estimate(s).value.toFixed(0)}`);
  }
}

// Windows wholly before the line.
const old = draftPool.filter((s) => lastYear(s) <= 1979);
const peak = new Map<string, PlayerSpan>();
for (const s of old) { const k = NAMEOF(s); if (!peak.has(k) || s.box.ppg > peak.get(k)!.box.ppg) peak.set(k, s); }
const rows = [...peak.values()].map((s) => ({ s, now: spacing.get(s.id)!, est: estimate(s) })).filter((r) => r.s.box.ppg >= 15);
console.log(`\nBefore the line (best-scoring window, 15+ ppg): ${rows.length} players. today = engine (hand list x 0.85, 0 off it), twins = estimate`);
console.log('  biggest gaps first:');
for (const r of rows.sort((a, b) => Math.abs(b.est.value - b.now) - Math.abs(a.est.value - a.now)).slice(0, 30)) {
  console.log(`  ${r.s.playerName.padEnd(20)} ${r.s.spanLabel}  FT ${(r.s.box.ftPct * 100).toFixed(0)}%  today ${String(r.now).padStart(3)}  twins ${r.est.value.toFixed(0).padStart(3)}   ${r.est.near.slice(0, 4).map((n) => n.span.playerName).join(', ')}`);
}
const offList = rows.filter((r) => r.now === 0);
console.log(`\n  ${offList.length} of ${rows.length} read 0 today (off the hand list)`);

// 2026-11-11 (the user: "ratingi typu A chyba zbyt wysoko"): two corrections before any use.
// 1) Stretch: the estimate shrinks to the mean (Rondo 0 -> 34, Curry 100 -> 82); refit truth on the
//    estimate over the donors (leave-one-out) and invert the shrink.
// 2) The engine's pre-line share (0.85): a three is a harder shot than a fifteen-footer.
{
  const pred = DONORS.map((s) => estimate(s).value), truth = DONORS.map((s) => spacing.get(s.id)!);
  const mp = pred.reduce((a, b) => a + b, 0) / pred.length, mt = truth.reduce((a, b) => a + b, 0) / truth.length;
  const b = pred.reduce((a, p, i) => a + (p - mp) * (truth[i] - mt), 0) / pred.reduce((a, p) => a + (p - mp) ** 2, 0);
  const a = mt - b * mp;
  const SHARE = Number(args.share ?? 0.85);
  const final = (v: number) => Math.max(0, Math.min(100, (a + b * v) * SHARE));
  console.log(`\nStretch: truth = ${a.toFixed(1)} + ${b.toFixed(2)} x estimate; then x ${SHARE}`);
  const { spacingGrade } = await import('../src/engine/grades');
  const pick = ['Calvin Murphy', 'Tiny Archibald', 'Gail Goodrich', 'Fred Brown', 'Earl Monroe', 'Bob Cousy', 'Bobby Wanzer', 'Jerry West', 'Oscar Robertson', 'Rick Barry', 'Pete Maravich', 'Walt Frazier', 'John Havlicek', 'Bill Sharman', 'Elgin Baylor', 'Hal Greer', 'Dave Bing', 'Bill Russell', 'Wilt Chamberlain', 'Wes Unseld'];
  console.log('  player               window    FT    today       twins raw     final');
  for (const n of pick) {
    const r = rows.find((x) => x.s.playerName === n) ?? (() => { const s = peak.get(normalizePlayerName(n)); return s ? { s, now: spacing.get(s.id)!, est: estimate(s) } : undefined; })();
    if (!r) continue;
    const f = final(r.est.value);
    console.log(`  ${n.padEnd(20)} ${r.s.spanLabel}  ${(r.s.box.ftPct * 100).toFixed(0)}%  ${String(r.now).padStart(3)} ${spacingGrade(r.now).padEnd(3)}    ${r.est.value.toFixed(0).padStart(3)} ${spacingGrade(r.est.value).padEnd(3)}    ${f.toFixed(0).padStart(3)} ${spacingGrade(f)}`);
  }
}
