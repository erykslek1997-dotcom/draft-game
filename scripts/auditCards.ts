/**
 * 2026-11-11, card audit (the user: "zaczynaj od audytu kart"). Each player's peak card (highest
 * displayed TAL) against the cards of the players statistically closest to it — the same era-normal
 * feature space as `scaleFarmers.ts` (box line, size, threes, minutes, bbref advanced rates and
 * quality measures, tuned group weights there). One neighbour window per player, k of them,
 * weighted by closeness.
 *
 * The gap (own TAL minus the neighbours') is NOT an error by itself: playoffs, named bonuses, tier
 * caps and hand floors all move a card on purpose. It is a list of cards to look at, largest first,
 * plus the mean gap by decade — a decade that sits systematically above or below its statistical
 * twins is the engine treating eras differently, not single players.
 *
 *   npx tsx scripts/auditCards.ts [--k=10] [--min=60] [--top=25]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { getBodyWeightLbs, getHeightInches } from '../src/data/heightLookup';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { displayTalentForSpan, overallTierForSpan } from '../src/engine/grades';
import { tierContextWithSixthMan } from '../src/engine/sixthMan';
import { computeDefensiveTalent } from '../src/engine/defensiveTalent';
import { computeOffensiveTalent } from '../src/engine/talent';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const K = Number(args.k ?? 10);
const MIN = Number(args.min ?? 60);
const TOP = Number(args.top ?? 25);

const ADV = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/bbrefAdvanced.json'), 'utf8')) as { fields: string[]; rows: Record<string, (number | null)[]> };
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
const NAMEOF = (s: PlayerSpan) => normalizePlayerName(s.playerName);
const midYear = (s: PlayerSpan) => { const ys = spanEndYears(s.spanLabel); return ys[Math.floor(ys.length / 2)]; };
const avgYears = (s: PlayerSpan, pick: (key: string) => number | null): number | null => {
  const vals = spanEndYears(s.spanLabel).map((y) => pick(`${NAMEOF(s)}|${y}`)).filter((v): v is number => v !== null && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const adv = (name: string) => { const i = ADV.fields.indexOf(name); return (s: PlayerSpan) => avgYears(s, (k) => ADV.rows[k]?.[i] ?? null); };
const tal = (s: PlayerSpan) => displayTalentForSpan(tierContextWithSixthMan(s));

// Same features and tuned group weights as scaleFarmers.ts.
const W = { box: 3, body: 1, three: 1, minutes: 1, rates: 0.5, quality: 1, usage: 1 };
const FEATURES: { name: string; w: number; get: (s: PlayerSpan) => number | null }[] = [
  ...(['ppg', 'rpg', 'apg'] as const).map((k) => ({ name: k, w: W.box, get: (s: PlayerSpan) => s.box[k] })),
  // Steals and blocks were not counted before 1973-74: missing, not zero.
  { name: 'spg', w: W.box, get: (s) => (midYear(s) >= 1974 ? s.box.spg : null) },
  { name: 'bpg', w: W.box, get: (s) => (midYear(s) >= 1974 ? s.box.bpg : null) },
  { name: 'fga', w: W.box, get: (s) => s.fga },
  { name: 'fgPct', w: W.box, get: (s) => s.box.fgPct },
  { name: 'ftPct', w: W.box, get: (s) => s.box.ftPct },
  { name: 'tsPct', w: W.box, get: (s) => s.box.tsPct },
  { name: 'height', w: W.body, get: (s) => getHeightInches(s.playerName) ?? null },
  { name: 'weight', w: W.body, get: (s) => getBodyWeightLbs(s.playerName) ?? null },
  { name: 'position', w: W.body, get: (s) => POS.indexOf(s.primaryPosition) },
  // No three-point line before 1979-80: missing, not zero.
  { name: 'threePA', w: W.three, get: (s) => (midYear(s) >= 1980 ? s.box.threePA : null) },
  { name: 'threePct', w: W.three, get: (s) => (midYear(s) >= 1980 && s.box.threePA >= 0.5 ? s.box.threePct : null) },
  { name: 'mpg', w: W.minutes, get: adv('mpg') },
  ...['ast_pct', 'orb_pct', 'drb_pct', 'tov_pct', 'stl_pct', 'blk_pct'].map((f) => ({ name: f, w: W.rates, get: adv(f) })),
  ...['ws_per_48', 'obpm', 'dbpm', 'per'].map((f) => ({ name: f, w: W.quality, get: adv(f) })),
  { name: 'usg_pct', w: W.usage, get: adv('usg_pct') },
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
const FW = Float64Array.from(FEATURES, (f) => f.w);

function neighbours(s: PlayerSpan): { d: number; span: PlayerSpan }[] {
  const v = VEC.get(s.id)!, me = NAMEOF(s);
  const all: { d: number; span: PlayerSpan }[] = [];
  for (const o of draftPool) {
    if (NAMEOF(o) === me) continue;
    const u = VEC.get(o.id)!;
    let sum = 0, wsum = 0;
    for (let i = 0; i < v.length; i++) {
      if (Number.isNaN(v[i]) || Number.isNaN(u[i])) continue;
      sum += FW[i] * (v[i] - u[i]) ** 2; wsum += FW[i];
    }
    if (wsum > 0) all.push({ d: Math.sqrt(sum / wsum), span: o });
  }
  all.sort((a, b) => a.d - b.d);
  const out: { d: number; span: PlayerSpan }[] = [];
  const seen = new Set<string>();
  for (const n of all) {
    if (seen.has(NAMEOF(n.span))) continue;
    seen.add(NAMEOF(n.span)); out.push(n);
    if (out.length === K) break;
  }
  return out;
}

// Each player's peak card.
const peak = new Map<string, { span: PlayerSpan; tal: number }>();
for (const s of draftPool) {
  const t = tal(s), p = peak.get(NAMEOF(s));
  if (!p || t > p.tal) peak.set(NAMEOF(s), { span: s, tal: t });
}
type Row = { span: PlayerSpan; tal: number; tier: string; twins: number; gap: number; near: { d: number; span: PlayerSpan }[] };
const rows: Row[] = [];
for (const { span, tal: own } of peak.values()) {
  if (own < MIN) continue;
  const near = neighbours(span);
  let num = 0, den = 0;
  for (const n of near) { const w = 1 / (0.1 + n.d); num += w * tal(n.span); den += w; }
  const twins = num / den;
  rows.push({ span, tal: own, tier: overallTierForSpan(tierContextWithSixthMan(span)), twins, gap: own - twins, near });
}

const line = (r: Row) => `${(r.gap >= 0 ? '+' : '') + r.gap.toFixed(1)}`.padStart(6) + `  ${r.span.playerName} ${r.span.spanLabel}`.padEnd(38) + `TAL ${Math.round(r.tal)} (${r.tier}) vs twins ${r.twins.toFixed(0)}` + `\n          twins: ${r.near.slice(0, 5).map((n) => `${n.span.playerName} ${n.span.spanLabel} ${Math.round(tal(n.span))}`).join(', ')}`;
console.log(`Peak cards with TAL >= ${MIN}: ${rows.length}; k ${K}\n`);
console.log(`ABOVE their statistical twins (engine rates them higher than players who look like them):`);
for (const r of [...rows].sort((a, b) => b.gap - a.gap).slice(0, TOP)) console.log(line(r));
console.log(`\nBELOW their statistical twins (engine rates them lower):`);
for (const r of [...rows].sort((a, b) => a.gap - b.gap).slice(0, TOP)) console.log(line(r));

console.log('\nMean gap by decade of the peak window (+ = the engine rates that decade above its twins):');
const byDec = new Map<number, number[]>();
for (const r of rows) { const d = Math.floor(midYear(r.span) / 10) * 10; byDec.set(d, [...(byDec.get(d) ?? []), r.gap]); }
for (const [d, gs] of [...byDec].sort((a, b) => a[0] - b[0])) console.log(`  ${d}s  n ${String(gs.length).padStart(3)}  mean gap ${(gs.reduce((a, b) => a + b, 0) / gs.length).toFixed(1).padStart(5)}`);

const csv = ['player,span,tal,tier,twins,gap,twin1,twin2,twin3,twin4,twin5', ...rows.sort((a, b) => b.gap - a.gap).map((r) => [r.span.playerName, r.span.spanLabel, r.tal.toFixed(1), r.tier, r.twins.toFixed(1), r.gap.toFixed(1), ...r.near.slice(0, 5).map((n) => `${n.span.playerName} ${n.span.spanLabel} (${Math.round(tal(n.span))})`)].map((x) => `"${x}"`).join(','))];
if (args.csv) { writeFileSync(args.csv, csv.join('\n')); console.log(`\nwrote ${args.csv}`); }

// --player="John Havlicek": every window of one player with its ten twins.
if (args.player) {
  for (const s of draftPool.filter((x) => x.playerName === args.player).sort((a, b) => a.spanLabel.localeCompare(b.spanLabel))) {
    const near = neighbours(s);
    let num = 0, den = 0;
    for (const n of near) { const w = 1 / (0.1 + n.d); num += w * tal(n.span); den += w; }
    console.log(`\n${s.playerName} ${s.spanLabel}  TAL ${Math.round(tal(s))}  vs twins ${(num / den).toFixed(0)}  (${s.box.ppg.toFixed(1)} pts, ${s.box.rpg.toFixed(1)} reb, ${s.box.apg.toFixed(1)} ast, TS ${(s.box.tsPct * 100).toFixed(0)}%)`);
    console.log('  ' + near.map((n) => `${n.span.playerName} ${n.span.spanLabel} ${Math.round(tal(n.span))}`).join(' · '));
  }
}

// 2026-11-11 (the user: "inny bliźniak od PTS, REB, AST... albo podział na ofensywę i defensywę"):
// --split with --player — offensive twins on offensive features only, compared on O-TAL; defensive
// twins on defensive features only (size, rebounding, stocks, DBPM, defensive win shares), on D-TAL.
if (args.player && args.split) {
  const OFF = new Set(['ppg', 'apg', 'fga', 'fgPct', 'ftPct', 'tsPct', 'threePA', 'threePct', 'ast_pct', 'tov_pct', 'obpm', 'usg_pct', 'per', 'mpg', 'position']);
  const DEF = new Set(['rpg', 'spg', 'bpg', 'height', 'weight', 'position', 'orb_pct', 'drb_pct', 'stl_pct', 'blk_pct', 'dbpm', 'mpg']);
  const twinsOn = (s: PlayerSpan, keep: Set<string>) => {
    const v = VEC.get(s.id)!, me = NAMEOF(s);
    const all: { d: number; span: PlayerSpan }[] = [];
    for (const o of draftPool) {
      if (NAMEOF(o) === me) continue;
      const u = VEC.get(o.id)!;
      let sum = 0, wsum = 0;
      FEATURES.forEach((f, i) => {
        if (!keep.has(f.name) || Number.isNaN(v[i]) || Number.isNaN(u[i])) return;
        sum += (v[i] - u[i]) ** 2; wsum += 1;
      });
      if (wsum >= 3) all.push({ d: Math.sqrt(sum / wsum), span: o });
    }
    all.sort((a, b) => a.d - b.d);
    const out: { d: number; span: PlayerSpan }[] = [];
    const seen = new Set<string>();
    for (const n of all) { if (seen.has(NAMEOF(n.span))) continue; seen.add(NAMEOF(n.span)); out.push(n); if (out.length === K) break; }
    return out;
  };
  const wavg = (ns: { d: number; span: PlayerSpan }[], f: (s: PlayerSpan) => number) => { let a = 0, b = 0; for (const n of ns) { const w = 1 / (0.1 + n.d); a += w * f(n.span); b += w; } return a / b; };
  console.log(`\n=== ${args.player}: offensive vs defensive twins ===`);
  for (const s of draftPool.filter((x) => x.playerName === args.player).sort((a, b) => a.spanLabel.localeCompare(b.spanLabel))) {
    const o = twinsOn(s, OFF), d = twinsOn(s, DEF);
    console.log(`\n${s.spanLabel}  O-TAL ${Math.round(computeOffensiveTalent(s))} vs O-twins ${wavg(o, computeOffensiveTalent).toFixed(0)}   D-TAL ${computeDefensiveTalent(s)} vs D-twins ${wavg(d, computeDefensiveTalent).toFixed(0)}`);
    console.log('  O: ' + o.slice(0, 6).map((n) => `${n.span.playerName} ${n.span.spanLabel}`).join(' · '));
    console.log('  D: ' + d.slice(0, 6).map((n) => `${n.span.playerName} ${n.span.spanLabel}`).join(' · '));
  }
}
