/**
 * "Skalowanie farmerów" (TODO.md, 2026-11-06), step 5: the honesty test. Can the data older players
 * lack (usage, assisted share, shot distance, movement, cutting) be read off similar players who
 * have it?
 *
 * Every pool window becomes a vector of features, each a z-score inside its own era (5-year bins of
 * the window's middle year): box line, shots, size, three-point shooting, and (2026-11-11, the user:
 * "win shares itd") basketball-reference's advanced rates and quality measures. A target is predicted
 * for a window from its k nearest windows of OTHER players that have the target (leave-one-player-out),
 * weighted by closeness. Distance runs only over features both windows have, so a pre-1974 window
 * (no steals, blocks, split rebounds) is compared on what it has instead of on zeros.
 *
 * Feature groups carry weights tuned by coordinate search on the mean variance recovered over the
 * targets we intend to use. That is tuned on the same leave-one-player-out score it reports, so the
 * tuned numbers flatter slightly; the cross-era check at the end (real 1974-1995 usage the donors
 * never saw) is the clean test.
 *
 *   npx tsx scripts/scaleFarmers.ts [--k=10] [--tune=0] [--show="Reggie Miller,Larry Bird"]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { getBodyWeightLbs, getHeightInches } from '../src/data/heightLookup';
import { normalizePlayerName, type PlayerSpan } from '../src/data/schema';
import { spanEndYears } from '../src/engine/era';
import { cutMeasured, cutShare, movementMeasured, movementShare } from '../src/engine/offBallProfile';
import { usageForSpan } from '../src/engine/usageLookup';
import bbrefDeep from '../src/data/bbrefDeep.json';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')) as [string, string][]);
const K = Number(args.k ?? 10);
const TUNE = args.tune !== '0';
const SHOW = (args.show ?? 'Reggie Miller,Larry Bird,Jerry West,Michael Jordan,Magic Johnson,Kareem Abdul-Jabbar,Bill Russell,Oscar Robertson').split(',');

const SHOOTING = (bbrefDeep as { shooting: Record<string, number[]> }).shooting;
const USAGE_BB = (bbrefDeep as { usage: Record<string, number> }).usage;
// scripts/data/bbrefAdvanced.json: bbref's advanced table, 1950-2026, keyed name|season-end.
const ADV = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/bbrefAdvanced.json'), 'utf8')) as { fields: string[]; rows: Record<string, (number | null)[]> };
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
const midYear = (s: PlayerSpan) => { const ys = spanEndYears(s.spanLabel); return ys[Math.floor(ys.length / 2)]; };
const NAMEOF = (s: PlayerSpan) => normalizePlayerName(s.playerName);
const avgYears = (s: PlayerSpan, pick: (key: string) => number | null): number | null => {
  const vals = spanEndYears(s.spanLabel).map((y) => pick(`${NAMEOF(s)}|${y}`)).filter((v): v is number => v !== null && Number.isFinite(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const shootingField = (s: PlayerSpan, i: number) => avgYears(s, (k) => { const r = SHOOTING[k]; return r && r[i] !== -1 ? r[i] : null; });
const advField = (name: string) => { const i = ADV.fields.indexOf(name); return (s: PlayerSpan) => avgYears(s, (k) => ADV.rows[k]?.[i] ?? null); };

type Feature = { name: string; group: string; get: (s: PlayerSpan) => number | null };
const FEATURES: Feature[] = [
  ...(['ppg', 'rpg', 'apg', 'spg', 'bpg'] as const).map((k) => ({ name: k, group: 'box', get: (s: PlayerSpan) => s.box[k] })),
  { name: 'fga', group: 'box', get: (s) => s.fga },
  { name: 'fgPct', group: 'box', get: (s) => s.box.fgPct },
  { name: 'ftPct', group: 'box', get: (s) => s.box.ftPct },
  { name: 'tsPct', group: 'box', get: (s) => s.box.tsPct },
  { name: 'height', group: 'body', get: (s) => getHeightInches(s.playerName) ?? null },
  { name: 'weight', group: 'body', get: (s) => getBodyWeightLbs(s.playerName) ?? null },
  { name: 'position', group: 'body', get: (s) => POS.indexOf(s.primaryPosition) },
  { name: 'threePA', group: 'three', get: (s) => s.box.threePA },
  { name: 'threePct', group: 'three', get: (s) => (s.box.threePA >= 0.5 ? s.box.threePct : null) },
  // 2026-11-11: share of his shots that were threes — a low-usage player taking mostly threes is the
  // spot-up (corner) shooter; the same 3PA beside many twos is more often a pull-up above the break.
  { name: 'threeRate', group: 'three', get: (s) => (s.fga > 0 && s.box.threePA >= 0.5 ? s.box.threePA / s.fga : null) },
  { name: 'mpg', group: 'minutes', get: advField('mpg') },
  ...['ast_pct', 'orb_pct', 'drb_pct', 'tov_pct', 'stl_pct', 'blk_pct'].map((f) => ({ name: f, group: 'rates', get: advField(f) })),
  ...['ws_per_48', 'obpm', 'dbpm', 'per'].map((f) => ({ name: f, group: 'quality', get: advField(f) })),
  { name: 'usg_pct', group: 'usage', get: advField('usg_pct') },
];
const GROUPS = [...new Set(FEATURES.map((f) => f.group))];

type Target = { label: string; get: (s: PlayerSpan) => number | null; trusted: boolean; excludes?: string[] };
const TARGETS: Target[] = [
  { label: 'usage', get: (s) => usageForSpan(s)?.usgPct ?? null, trusted: true, excludes: ['usage'] },
  { label: 'assisted share (all FG)', get: (s) => usageForSpan(s)?.assistedFgPct ?? null, trusted: true },
  { label: 'assisted share (threes)', get: (s) => (s.box.threePA >= 1 ? shootingField(s, 1) : null), trusted: true },
  { label: 'avg shot distance', get: (s) => shootingField(s, 2), trusted: true },
  { label: 'corner-three share', get: (s) => (s.box.threePA >= 1 ? shootingField(s, 4) : null), trusted: false },
  { label: 'movement share (measured)', get: (s) => (movementMeasured(s) ? movementShare(s) : null), trusted: false },
  { label: 'cut share (measured)', get: (s) => (cutMeasured(s) ? cutShare(s) : null), trusted: true },
];

// Era z-scores (5-year bins of the middle year); a missing value stays missing (NaN).
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

type Weights = Record<string, number>;
const featureWeights = (w: Weights, excludes: string[] = []) => Float64Array.from(FEATURES, (f) => (excludes.includes(f.group) ? 0 : w[f.group] ?? 0));

function neighbours(s: PlayerSpan, donors: PlayerSpan[], fw: Float64Array): { d: number; span: PlayerSpan }[] {
  const v = VEC.get(s.id)!, me = NAMEOF(s);
  const out: { d: number; span: PlayerSpan }[] = [];
  for (const o of donors) {
    if (NAMEOF(o) === me) continue;
    const u = VEC.get(o.id)!;
    let sum = 0, wsum = 0;
    for (let i = 0; i < v.length; i++) {
      const w = fw[i];
      if (w === 0 || Number.isNaN(v[i]) || Number.isNaN(u[i])) continue;
      sum += w * (v[i] - u[i]) ** 2; wsum += w;
    }
    if (wsum > 0) out.push({ d: Math.sqrt(sum / wsum), span: o });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, K);
}
const predict = (ns: { d: number; span: PlayerSpan }[], get: (s: PlayerSpan) => number | null): number => {
  let num = 0, den = 0;
  for (const n of ns) { const w = 1 / (0.1 + n.d); num += w * get(n.span)!; den += w; }
  return num / den;
};
const corr = (xs: number[], ys: number[]) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let a = 0, b = 0, c = 0;
  xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; c += (ys[i] - my) ** 2; });
  return a / Math.sqrt(b * c);
};

// One window per player and target (his middle one), so a star's ten windows are not ten samples.
const SAMPLES = new Map<string, PlayerSpan[]>();
for (const t of TARGETS) {
  const byPlayer = new Map<string, PlayerSpan[]>();
  for (const s of draftPool) if (t.get(s) !== null) byPlayer.set(NAMEOF(s), [...(byPlayer.get(NAMEOF(s)) ?? []), s]);
  SAMPLES.set(t.label, [...byPlayer.values()].map((ws) => ws.sort((a, b) => midYear(a) - midYear(b))[Math.floor(ws.length / 2)]));
}
function score(t: Target, w: Weights): { r: number; rec: number } {
  const sample = SAMPLES.get(t.label)!, fw = featureWeights(w, t.excludes);
  const truth = sample.map((s) => t.get(s)!);
  const pred = sample.map((s) => predict(neighbours(s, sample, fw), t.get));
  const mean = truth.reduce((a, b) => a + b, 0) / truth.length;
  const variance = truth.reduce((a, b) => a + (b - mean) ** 2, 0) / truth.length;
  const mse = pred.reduce((a, p, i) => a + (p - truth[i]) ** 2, 0) / pred.length;
  return { r: corr(pred, truth), rec: 1 - mse / variance };
}
const objective = (w: Weights) => { const ts = TARGETS.filter((t) => t.trusted); return ts.reduce((a, t) => a + score(t, w).rec, 0) / ts.length; };

const BASE: Weights = { box: 1, body: 1, three: 1, minutes: 0, rates: 0, quality: 0, usage: 0 };
const ALL_EQUAL: Weights = { box: 1, body: 1, three: 1, minutes: 1, rates: 1, quality: 1, usage: 1 };
let tuned: Weights = { ...ALL_EQUAL };
if (TUNE) {
  let best = objective(tuned);
  for (let pass = 0; pass < 2; pass++) {
    for (const g of GROUPS) {
      for (const v of [0, 0.5, 1, 2, 3]) {
        if (v === tuned[g]) continue;
        const trial = { ...tuned, [g]: v };
        const sc = objective(trial);
        if (sc > best + 0.002) { best = sc; tuned = trial; }
      }
    }
  }
  console.log(`tuned group weights: ${GROUPS.map((g) => `${g} ${tuned[g]}`).join(', ')} (mean recovered over trusted targets ${(best * 100).toFixed(1)}%)\n`);
}
// What a pre-1974 window can have: no steals, blocks, split rebounds, turnovers, BPM, usage, threes.
const PRE74_MISSING = new Set(['spg', 'bpg', 'orb_pct', 'drb_pct', 'tov_pct', 'stl_pct', 'blk_pct', 'obpm', 'dbpm', 'usg_pct', 'threePA', 'threePct', 'threeRate']);
function scorePre74(t: Target, w: Weights): number {
  const sample = SAMPLES.get(t.label)!;
  const fw = featureWeights(w, t.excludes).map((x, i) => (PRE74_MISSING.has(FEATURES[i].name) ? 0 : x));
  const truth = sample.map((s) => t.get(s)!);
  const pred = sample.map((s) => predict(neighbours(s, sample, fw), t.get));
  const mean = truth.reduce((a, b) => a + b, 0) / truth.length;
  const variance = truth.reduce((a, b) => a + (b - mean) ** 2, 0) / truth.length;
  return 1 - pred.reduce((a, p, i) => a + (p - truth[i]) ** 2, 0) / pred.length / variance;
}

console.log(`k ${K}; leave-one-player-out; one window a player. Share of variance recovered:`);
console.log('target                         n    | box+body+3pt | + advanced, equal | + advanced, tuned | tuned, pre-1974 features | position mean');
for (const t of TARGETS) {
  const sample = SAMPLES.get(t.label)!;
  const truth = sample.map((s) => t.get(s)!);
  const mean = truth.reduce((a, b) => a + b, 0) / truth.length;
  const variance = truth.reduce((a, b) => a + (b - mean) ** 2, 0) / truth.length;
  const posMean = new Map(POS.map((p) => { const vs = sample.filter((s) => s.primaryPosition === p).map((s) => t.get(s)!); return [p, vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : mean]; }));
  const base = sample.reduce((a, s, i) => a + (posMean.get(s.primaryPosition)! - truth[i]) ** 2, 0) / sample.length;
  const pct = (x: number) => `${(x * 100).toFixed(0).padStart(3)}%`;
  console.log(`${(t.label + (t.trusted ? '' : ' *')).padEnd(30)} ${String(sample.length).padStart(4)} |     ${pct(score(t, BASE).rec)}     |       ${pct(score(t, ALL_EQUAL).rec)}       |       ${pct(score(t, tuned).rec)}       |          ${pct(scorePre74(t, tuned))}           |    ${pct(1 - base / variance)}`);
}
console.log('* not used for the tuning objective (shown to be unrecoverable in the first pass)');

// Imputed for windows without their own data.
console.log('\nImputed for windows without their own data (tuned weights, features that window has):');
for (const name of SHOW) {
  const s = draftPool.filter((x) => x.playerName === name.trim()).sort((a, b) => b.box.ppg - a.box.ppg)[0];
  if (!s) continue;
  const parts: string[] = [];
  for (const t of TARGETS.filter((x) => x.trusted)) {
    if (t.get(s) !== null) { parts.push(`${t.label} ${t.get(s)!.toFixed(2)} (own)`); continue; }
    parts.push(`${t.label} ${predict(neighbours(s, SAMPLES.get(t.label)!, featureWeights(tuned, t.excludes)), t.get).toFixed(2)}`);
  }
  const near = neighbours(s, SAMPLES.get('assisted share (all FG)')!, featureWeights(tuned)).slice(0, 5).map((n) => `${n.span.playerName} ${n.span.spanLabel}`);
  console.log(`\n${s.playerName} ${s.spanLabel}\n  closest: ${near.join(', ')}\n  ${parts.join(' · ')}`);
}

// The user's question (2026-11-06): does the box score tell Klay from Danny Green?
console.log('\nMovement share, truth vs predicted (tuned weights):');
const mv = TARGETS.find((t) => t.label.startsWith('movement'))!;
for (const name of ['Klay Thompson', 'Danny Green', 'Kyle Korver', 'JJ Redick', 'Stephen Curry', 'P.J. Tucker']) {
  const s = SAMPLES.get(mv.label)!.find((x) => x.playerName === name);
  if (s) console.log(`  ${name.padEnd(16)} truth ${mv.get(s)!.toFixed(2)}  predicted ${predict(neighbours(s, SAMPLES.get(mv.label)!, featureWeights(tuned)), mv.get).toFixed(2)}`);
}

// The clean test: real 1974-1995 usage (bbref) that the donors (1996-97 on) never saw.
{
  const usage = TARGETS[0];
  const real = (s: PlayerSpan) => avgYears(s, (k) => (USAGE_BB[k] !== undefined ? USAGE_BB[k] / 100 : null));
  const byPlayer = new Map<string, PlayerSpan[]>();
  for (const s of draftPool) if (usage.get(s) === null && midYear(s) <= 1995 && real(s) !== null) byPlayer.set(NAMEOF(s), [...(byPlayer.get(NAMEOF(s)) ?? []), s]);
  const old = [...byPlayer.values()].map((ws) => ws.sort((a, b) => midYear(a) - midYear(b))[Math.floor(ws.length / 2)]);
  console.log("\nAcross eras: 1974-1995 usage predicted from modern donors vs bbref's real figure (usage feature excluded)");
  for (const [label, w] of [['box+body+3pt', BASE], ['tuned', tuned]] as [string, Weights][]) {
    for (const [era, from, to] of [['1974-1979', 1974, 1979], ['1980-1989', 1980, 1989], ['1990-1995', 1990, 1995]] as [string, number, number][]) {
      const set = old.filter((s) => midYear(s) >= from && midYear(s) <= to);
      if (set.length < 10) continue;
      const truth = set.map((s) => real(s)!);
      const pred = set.map((s) => predict(neighbours(s, SAMPLES.get(usage.label)!, featureWeights(w, usage.excludes)), usage.get));
      const mean = truth.reduce((a, b) => a + b, 0) / truth.length;
      const variance = truth.reduce((a, b) => a + (b - mean) ** 2, 0) / truth.length;
      const mse = pred.reduce((a, p, i) => a + (p - truth[i]) ** 2, 0) / pred.length;
      const bias = pred.reduce((a, p, i) => a + (p - truth[i]), 0) / pred.length;
      console.log(`  ${label.padEnd(13)} ${era}: n ${String(set.length).padStart(3)}  r ${corr(pred, truth).toFixed(2)}  recovered ${(100 * (1 - mse / variance)).toFixed(0)}%  mean error ${(bias * 100).toFixed(1)} pts`);
    }
  }
}

// 2026-11-11 (the user: "jak to wykorzystać do estymacji TAL"): the TAL inputs a pre-1974 window
// lacks — steals, blocks, their rates, BPM — predicted from ONLY what such a window has. Truth: the
// 1974+ windows, leave-one-player-out. Says whether old-timers' D-TAL can rest on estimated stocks
// instead of hand floors (Russell 99, Wilt 84) and the "thin read, no cut" exemption.
{
  const PRE74 = Float64Array.from(FEATURES, (f) => (PRE74_MISSING.has(f.name) ? 0 : tuned[f.group] ?? 0));
  const stockTargets: [string, (s: PlayerSpan) => number | null][] = [
    ['steals per game', (s) => (midYear(s) >= 1975 ? s.box.spg : null)],
    ['blocks per game', (s) => (midYear(s) >= 1975 ? s.box.bpg : null)],
    ['STL%', advField('stl_pct')],
    ['BLK%', advField('blk_pct')],
    ['DBPM', advField('dbpm')],
    ['OBPM', advField('obpm')],
    ['DRB%', advField('drb_pct')],
  ];
  console.log('\nPre-1974 TAL inputs predicted from pre-1974 features only (truth = 1974+ windows):');
  for (const [label, get] of stockTargets) {
    const byPlayer = new Map<string, PlayerSpan[]>();
    for (const s of draftPool) if (get(s) !== null && midYear(s) >= 1975) byPlayer.set(NAMEOF(s), [...(byPlayer.get(NAMEOF(s)) ?? []), s]);
    const sample = [...byPlayer.values()].map((ws) => ws.sort((a, b) => midYear(a) - midYear(b))[Math.floor(ws.length / 2)]);
    const truth = sample.map((s) => get(s)!);
    const pred = sample.map((s) => predict(neighbours(s, sample, PRE74), get));
    const mean = truth.reduce((a, b) => a + b, 0) / truth.length;
    const variance = truth.reduce((a, b) => a + (b - mean) ** 2, 0) / truth.length;
    const mse = pred.reduce((a, p, i) => a + (p - truth[i]) ** 2, 0) / pred.length;
    console.log(`  ${label.padEnd(16)} n ${String(sample.length).padStart(4)}  r ${corr(pred, truth).toFixed(2)}  recovered ${(100 * (1 - mse / variance)).toFixed(0)}%`);
  }
  for (const name of ['Bill Russell', 'Wilt Chamberlain', 'Jerry West', 'Oscar Robertson', 'Elgin Baylor', 'Walt Frazier', 'Nate Thurmond']) {
    const s = draftPool.filter((x) => x.playerName === name).sort((a, b) => b.box.ppg - a.box.ppg)[0];
    if (!s || midYear(s) >= 1974) continue;
    const parts = stockTargets.slice(0, 5).map(([label, get]) => {
      const donors = draftPool.filter((x) => get(x) !== null && midYear(x) >= 1975);
      return `${label} ${predict(neighbours(s, donors, PRE74), get).toFixed(2)}`;
    });
    console.log(`  ${name.padEnd(17)} ${s.spanLabel}: ${parts.join(' · ')}`);
  }
}
